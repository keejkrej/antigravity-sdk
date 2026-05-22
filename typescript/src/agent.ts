import { Effect } from "effect";
import { AgentConfig } from "./connection.ts";
import { LocalConnectionStrategy } from "./local_connection.ts";
import * as Types from "./types.ts";
import * as path from "node:path";
import { HookRunner } from "./hooks/hook_runner.ts";
import { ToolRunner } from "./tools/tool_runner.ts";
import { Conversation, ChatResponse } from "./conversation/conversation.ts";

export class Agent {
  private _conversation: Conversation | null = null;
  private hookRunner: HookRunner | null = null;
  private toolRunner: ToolRunner | null = null;
  private triggerRunner: any = null;
  private pendingHooks: any[] = [];
  private pendingTriggers: any[] = [];

  constructor(readonly config: AgentConfig) {
    if (config.responseSchema) {
      if (!config.capabilities) {
        config.capabilities = {};
      }
      config.capabilities.finishToolSchemaJson =
        typeof config.responseSchema === "string"
          ? config.responseSchema
          : JSON.stringify(config.responseSchema);
    }
    this.pendingHooks = [...(config.hooks || [])];
    this.pendingTriggers = [...(config.triggers || [])];
  }

  registerHook(hook: any): void {
    if (!this.hookRunner) {
      this.pendingHooks.push(hook);
      return;
    }
    this.hookRunner.registerHook(hook);
  }

  registerTrigger(trigger: any): void {
    if (this.triggerRunner) {
      throw new Error("Cannot register triggers after the agent has started.");
    }
    this.pendingTriggers.push(trigger);
  }

  /**
   * Starts the agent session by performing the handshake and establishing the WebSocket connection.
   */
  async start(): Promise<Agent> {
    if (this._conversation) {
      return this;
    }

    this.hookRunner = new HookRunner();

    for (const hook of this.pendingHooks) {
      this.hookRunner.registerHook(hook);
    }
    this.pendingHooks = [];

    // Apply policies
    const activePolicies = [...(this.config.policies || [])];
    const cfg = this.config.capabilities || {};
    const readOnlyTools = new Set(Types.BuiltinToolsHelpers.readOnly());
    
    let activeTools: Set<Types.BuiltinTools>;
    if (cfg.enabledTools !== undefined) {
      activeTools = new Set(cfg.enabledTools);
    } else if (cfg.disabledTools !== undefined) {
      activeTools = new Set(
        Types.BuiltinToolsHelpers.allTools().filter(t => !cfg.disabledTools?.includes(t))
      );
    } else {
      activeTools = new Set(Types.BuiltinToolsHelpers.allTools());
    }

    let hasWriteTools = false;
    for (const t of activeTools) {
      if (!readOnlyTools.has(t)) {
        hasWriteTools = true;
        break;
      }
    }

    const hasMcpServers = !!(this.config.mcpServers && this.config.mcpServers.length > 0);
    const hasToolDecideHook = this.hookRunner.preToolCallDecideHooks.length > 0;

    if ((hasWriteTools || hasMcpServers) && activePolicies.length === 0 && !hasToolDecideHook) {
      throw new Error(
        "Write tools or MCP servers are enabled without a safety policy. " +
        "Add policies=[policy.allow_all()] to approve all tool calls, " +
        "or policies=[policy.deny_all(), policy.allow('tool_name')] " +
        "to selectively allow specific tools."
      );
    }

    if (activePolicies.length > 0) {
      const { enforce } = await import("./hooks/policy.ts");
      this.hookRunner.registerHook(enforce(activePolicies));
    }

    const allTools = [...(this.config.tools || [])];
    this.toolRunner = new ToolRunner(allTools);

    const harnessTools: Types.Tool[] = allTools.map((t) => {
      let schema = "";
      if (t.parametersJsonSchema) {
        schema =
          typeof t.parametersJsonSchema === "string"
            ? t.parametersJsonSchema
            : JSON.stringify(t.parametersJsonSchema);
      } else {
        schema = JSON.stringify({ type: "object", properties: {} });
      }
      return {
        name: t.name,
        description: t.description || "",
        parametersJsonSchema: schema,
      };
    });

    let systemInstructions: Types.SystemInstructions | undefined;
    if (this.config.systemInstructions) {
      if (typeof this.config.systemInstructions === "string") {
        systemInstructions = {
          custom: {
            part: [{ text: this.config.systemInstructions }],
          },
        };
      } else {
        systemInstructions = this.config.systemInstructions;
      }
    }

    const workspaces: Types.Workspace[] = (this.config.workspaces || []).map((dir) => ({
      filesystemWorkspace: {
        directory: path.resolve(dir),
      },
    }));

    const subagentEnabled = !!(cfg.enableSubagents && activeTools.has(Types.BuiltinTools.START_SUBAGENT));
    const harnessSideTools: Types.HarnessSideTools = {
      subagents: { enabled: subagentEnabled },
      find: { enabled: activeTools.has(Types.BuiltinTools.FIND_FILE) },
      userQuestions: { enabled: activeTools.has(Types.BuiltinTools.ASK_QUESTION) },
      runCommand: { enabled: activeTools.has(Types.BuiltinTools.RUN_COMMAND) },
      fileEdit: { enabled: activeTools.has(Types.BuiltinTools.EDIT_FILE) },
      viewFile: { enabled: activeTools.has(Types.BuiltinTools.VIEW_FILE) },
      writeTo: { enabled: activeTools.has(Types.BuiltinTools.CREATE_FILE) },
      grepSearch: { enabled: activeTools.has(Types.BuiltinTools.SEARCH_DIR) },
      listDir: { enabled: activeTools.has(Types.BuiltinTools.LIST_DIR) },
      generateImage: {
        enabled: activeTools.has(Types.BuiltinTools.GENERATE_IMAGE),
        modelName: cfg.imageModel,
      },
    };

    const harnessConfig: Types.HarnessConfig = {
      geminiConfig: this.config.geminiConfig,
      systemInstructions,
      tools: harnessTools,
      harnessSideTools,
      workspaces,
      skillsPaths: this.config.skillsPaths,
      appDataDir: this.config.appDataDir,
    };

    const strategy = new LocalConnectionStrategy(
      this.config.saveDir,
      harnessConfig,
      this.toolRunner,
      this.hookRunner
    );

    this._conversation = await Effect.runPromise(
      Conversation.create(strategy, { maxHistorySize: this.config.capabilities?.compactionThreshold })
    );

    if (this.pendingTriggers.length > 0) {
      const { TriggerRunner } = await import("./triggers/trigger_runner.ts");
      this.triggerRunner = new TriggerRunner(
        [...this.pendingTriggers],
        this._conversation.connection
      );
      await Effect.runPromise(this.triggerRunner.start());
      this.pendingTriggers = [];
    }

    const { ToolContext } = await import("./tools/tool_context.ts");
    const ctx = new ToolContext(this._conversation.connection);
    this.toolRunner.setContext(ctx);

    return this;
  }

  /**
   * Sends a prompt to the agent and executes the turn loop until completion.
   */
  async chat(prompt: Types.Content | null): Promise<ChatResponse> {
    return await this.conversation.chat(prompt);
  }

  /**
   * Stops the agent session and cleans up resources.
   */
  async stop(): Promise<void> {
    if (this.triggerRunner) {
      await Effect.runPromise(this.triggerRunner.stop());
      this.triggerRunner = null;
    }
    if (this._conversation) {
      await this._conversation.disconnect();
      this._conversation = null;
    }
  }

  get isStarted(): boolean {
    return this._conversation !== null;
  }

  get conversation(): Conversation {
    if (!this._conversation) {
      throw new Error("Agent session not started. Use start().");
    }
    return this._conversation;
  }

  get conversationId(): string | undefined {
    return this._conversation?.conversationId || undefined;
  }

  async [Symbol.for("Symbol.asyncDispose")](): Promise<void> {
    await this.stop();
  }
}
