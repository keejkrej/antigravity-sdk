import { Effect, Queue, Stream, Schedule } from "effect";
import * as Types from "./types.ts";
import { Connection, ConnectionStrategy } from "./connection.ts";
import { encodeInputConfig, decodeOutputConfig } from "./protobuf.ts";
import { spawn, ChildProcess } from "node:child_process";
import { Readable } from "node:stream";
import WebSocket from "ws";
import * as path from "node:path";
import { HookRunner } from "./hooks/hook_runner.ts";
import { TurnContext, OperationContext } from "./hooks/hooks.ts";
import { ToolRunner } from "./tools/tool_runner.ts";

const IDLE_SENTINEL = Symbol("IDLE_SENTINEL");

class StepTracker {
  state: Types.StepState = Types.StepState.STATE_UNSPECIFIED;
  handledRequests = new Set<string>();

  updateState(newState: Types.StepState): void {
    if (
      this.state === Types.StepState.STATE_WAITING_FOR_USER &&
      newState !== Types.StepState.STATE_WAITING_FOR_USER
    ) {
      this.handledRequests.clear();
    }
    this.state = newState;
  }

  markHandled(requestType: string): boolean {
    if (this.handledRequests.has(requestType)) {
      return false;
    }
    this.handledRequests.add(requestType);
    return true;
  }
}

export function normalizeWirePath(p: string): string {
  try {
    if (p.startsWith("file://")) {
      const url = new URL(p);
      return decodeURIComponent(url.pathname);
    }
  } catch (_) {}
  return p;
}

const BUILTIN_TOOL_PROTO_FIELDS: Record<string, string> = {
  [Types.BuiltinTools.CREATE_FILE]: "create_file",
  [Types.BuiltinTools.EDIT_FILE]: "edit_file",
  [Types.BuiltinTools.FIND_FILE]: "find_file",
  [Types.BuiltinTools.LIST_DIR]: "list_directory",
  [Types.BuiltinTools.RUN_COMMAND]: "run_command",
  [Types.BuiltinTools.SEARCH_DIR]: "search_directory",
  [Types.BuiltinTools.VIEW_FILE]: "view_file",
  [Types.BuiltinTools.START_SUBAGENT]: "invoke_subagent",
  [Types.BuiltinTools.GENERATE_IMAGE]: "generate_image",
  [Types.BuiltinTools.FINISH]: "finish",
};

const DEFAULT_HOST_TOOL_NAME = "pre_request_host_tool_request";

const SOURCE_MAP: Record<string, Types.StepSource> = {
  "SOURCE_SYSTEM": Types.StepSource.SYSTEM,
  "SOURCE_USER": Types.StepSource.USER,
  "SOURCE_MODEL": Types.StepSource.MODEL,
  "SYSTEM": Types.StepSource.SYSTEM,
  "USER": Types.StepSource.USER,
  "MODEL": Types.StepSource.MODEL,
};

const STATUS_MAP: Record<string, Types.StepStatus> = {
  "STATE_ACTIVE": Types.StepStatus.ACTIVE,
  "STATE_DONE": Types.StepStatus.DONE,
  "STATE_WAITING_FOR_USER": Types.StepStatus.WAITING_FOR_USER,
  "STATE_ERROR": Types.StepStatus.ERROR,
  "ACTIVE": Types.StepStatus.ACTIVE,
  "DONE": Types.StepStatus.DONE,
  "WAITING_FOR_USER": Types.StepStatus.WAITING_FOR_USER,
  "ERROR": Types.StepStatus.ERROR,
};

const TARGET_MAP: Record<string | number, Types.StepTarget> = {
  "TARGET_UNSPECIFIED": Types.StepTarget.UNSPECIFIED,
  "TARGET_USER": Types.StepTarget.USER,
  "TARGET_MODEL": Types.StepTarget.UNKNOWN,
  "TARGET_ENVIRONMENT": Types.StepTarget.ENVIRONMENT,
  "UNSPECIFIED": Types.StepTarget.UNSPECIFIED,
  "USER": Types.StepTarget.USER,
  "ENVIRONMENT": Types.StepTarget.ENVIRONMENT,
  "UNKNOWN": Types.StepTarget.UNKNOWN,
  0: Types.StepTarget.UNSPECIFIED,
  1: Types.StepTarget.USER,
  2: Types.StepTarget.UNKNOWN,
  3: Types.StepTarget.ENVIRONMENT,
};

function extractToolResult(stepUpdate: any): Types.ToolOutput | null {
  if (stepUpdate.run_command) {
    const rc = stepUpdate.run_command;
    if (rc.combined_output) {
      return new Types.RunCommandResult(rc.combined_output);
    }
  } else if (stepUpdate.list_directory) {
    const ld = stepUpdate.list_directory;
    if (ld.results) {
      const entries = ld.results.map((r: any) => ({
        name: r.name,
        isDirectory: !!r.is_directory,
        fileSize: r.file_size || 0,
      }));
      return new Types.ListDirectoryResult(entries);
    }
  } else if (stepUpdate.find_file) {
    const ff = stepUpdate.find_file;
    if (ff.output) {
      return new Types.FindFileResult(ff.output);
    }
  } else if (stepUpdate.search_directory) {
    const sd = stepUpdate.search_directory;
    if (sd.num_results) {
      return new Types.SearchDirectoryResult(sd.num_results);
    }
  } else if (stepUpdate.edit_file) {
    const ef = stepUpdate.edit_file;
    if (ef.diff_block) {
      return new Types.EditFileResult(stepUpdate.text || "");
    }
  } else if (stepUpdate.generate_image) {
    const gi = stepUpdate.generate_image;
    if (gi.image_name) {
      return new Types.GenerateImageResult(gi.image_name);
    }
  }
  return null;
}

function parseUsageMetadata(usage: any): Types.UsageMetadata | undefined {
  if (!usage) return undefined;
  return {
    promptTokenCount: usage.prompt_token_count || usage.promptTokenCount || 0,
    cachedContentTokenCount: usage.cached_content_token_count || usage.cachedContentTokenCount || 0,
    candidatesTokenCount: usage.candidates_token_count || usage.candidatesTokenCount || 0,
    thoughtsTokenCount: usage.thoughts_token_count || usage.thoughtsTokenCount || 0,
    totalTokenCount: usage.total_token_count || usage.totalTokenCount || 0,
  };
}

function parseStepUpdate(stepDict: any): Types.Step {
  const trajId = stepDict.trajectory_id || "";
  const stepIdx = stepDict.step_index || 0;
  const idStr = trajId ? `${trajId}:${stepIdx}` : String(stepIdx);

  const toolCalls: Types.ToolCall[] = [];

  // Find active tool
  let activeToolName: string | null = null;
  let activeToolArgs: any = {};
  for (const [toolEnum, protoField] of Object.entries(BUILTIN_TOOL_PROTO_FIELDS)) {
    if (stepDict[protoField] !== undefined && stepDict[protoField] !== null) {
      activeToolName = toolEnum;
      activeToolArgs = stepDict[protoField] || {};
      break;
    }
  }

  if (activeToolName) {
    let canonicalPath: string | undefined = undefined;
    for (const pathKey of ["path", "file_path", "TargetFile", "directory_path"]) {
      if (activeToolArgs[pathKey] && typeof activeToolArgs[pathKey] === "string") {
        const normalized = normalizeWirePath(activeToolArgs[pathKey]);
        activeToolArgs[pathKey] = normalized;
        canonicalPath = normalized;
      }
    }
    toolCalls.push({
      id: idStr,
      name: activeToolName,
      args: activeToolArgs,
      canonicalPath,
    });
  }

  let stepType = Types.StepType.UNKNOWN;
  if (stepDict.compaction !== undefined && stepDict.compaction !== null) {
    stepType = Types.StepType.COMPACTION;
  } else if (stepDict.finish !== undefined && stepDict.finish !== null) {
    stepType = Types.StepType.FINISH;
  } else if (activeToolName || Object.values(BUILTIN_TOOL_PROTO_FIELDS).some(k => stepDict[k] !== undefined && stepDict[k] !== null)) {
    stepType = Types.StepType.TOOL_CALL;
  } else if (stepDict.text) {
    stepType = Types.StepType.TEXT_RESPONSE;
  }

  const source = SOURCE_MAP[stepDict.source] || Types.StepSource.UNKNOWN;
  const status = STATUS_MAP[stepDict.state] || Types.StepStatus.UNKNOWN;

  const isFromModel = source === Types.StepSource.MODEL;
  const isDone = status === Types.StepStatus.DONE;
  const hasText = !!stepDict.text;
  const target = TARGET_MAP[stepDict.target ?? ""] || Types.StepTarget.UNKNOWN;
  const isTargetUser = target === Types.StepTarget.USER;
  const isCompleteResponse = isFromModel && isDone && hasText && isTargetUser;

  let structuredOutput: any = null;
  if (stepType === Types.StepType.FINISH) {
    const finish = stepDict.finish || {};
    const outputString = finish.output_string || finish.outputString;
    if (outputString) {
      try {
        structuredOutput = JSON.parse(outputString);
      } catch (_) {
        console.warn("Failed to parse structured output JSON.");
      }
    }
  }

  const errorField = stepDict.error || {};
  const errorMsg = stepDict.error_message || stepDict.errorMessage || errorField.error_message || errorField.errorMessage || "";
  const httpCode = errorField.http_code || errorField.httpCode || 0;

  return {
    id: idStr,
    stepIndex: stepIdx,
    type: stepType,
    source,
    target,
    status,
    content: stepDict.text || "",
    contentDelta: stepDict.text_delta || stepDict.textDelta || "",
    thinking: stepDict.thinking || "",
    thinkingDelta: stepDict.thinking_delta || stepDict.thinkingDelta || "",
    toolCalls,
    error: errorMsg,
    httpCode,
    isCompleteResponse,
    structuredOutput,
    cascadeId: stepDict.cascade_id || stepDict.cascadeId || "",
    trajectoryId: trajId,
  };
}

function readBytes(stream: Readable, length: number): Effect.Effect<Buffer, Error> {
  return Effect.async<Buffer, Error>((resume) => {
    let buffer = Buffer.alloc(0);

    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length >= length) {
        cleanup();
        resume(Effect.succeed(buffer.subarray(0, length)));
      }
    };

    const onError = (err: Error) => {
      cleanup();
      resume(Effect.fail(err));
    };

    const onEnd = () => {
      cleanup();
      if (buffer.length < length) {
        resume(
          Effect.fail(
            new Error(`Stream ended prematurely. Expected ${length} bytes, but got ${buffer.length}`)
          )
        );
      }
    };

    const cleanup = () => {
      stream.off("data", onData);
      stream.off("error", onError);
      stream.off("end", onEnd);
    };

    stream.on("data", onData);
    stream.on("error", onError);
    stream.on("end", onEnd);
  });
}

function handshake(saveDir?: string): Effect.Effect<{ child: ChildProcess; port: number; apiKey: string }, Error> {
  return Effect.gen(function* () {
    const binaryPath =
      process.env.ANTIGRAVITY_HARNESS_PATH || "/home/jack/.gemini/antigravity-cli/bin/agentapi";

    const child = spawn(binaryPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    yield* Effect.async<void, Error>((resume) => {
      child.on("error", (err) => {
        resume(Effect.fail(new Error(`Failed to spawn local harness binary at ${binaryPath}: ${err.message}`)));
      });
      const timer = setTimeout(() => {
        resume(Effect.succeed(undefined));
      }, 50);
      child.on("exit", (code, signal) => {
        clearTimeout(timer);
        resume(
          Effect.fail(
            new Error(`Local harness exited prematurely with code ${code} and signal ${signal}`)
          )
        );
      });
    });

    const serializedConfig = encodeInputConfig(saveDir);
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(serializedConfig.length, 0);

    if (!child.stdin || !child.stdout || !child.stderr) {
      throw new Error("Process spawned with invalid stdin/stdout/stderr pipes");
    }

    child.stdin.write(lenBuf);
    child.stdin.write(serializedConfig);

    const lenResBuf = yield* readBytes(child.stdout, 4);
    const resLength = lenResBuf.readUInt32LE(0);
    const resBuf = yield* readBytes(child.stdout, resLength);
    const outputConfig = decodeOutputConfig(new Uint8Array(resBuf));

    return { child, port: outputConfig.port, apiKey: outputConfig.apiKey };
  });
}

function connectWs(port: number, apiKey: string): Effect.Effect<WebSocket, Error> {
  return Effect.async<WebSocket, Error>((resume) => {
    const wsUrl = `ws://localhost:${port}/`;
    const ws = new WebSocket(wsUrl, {
      headers: {
        "x-goog-api-key": apiKey,
      },
    });

    ws.on("open", () => {
      resume(Effect.succeed(ws));
    });

    ws.on("error", (err) => {
      resume(Effect.fail(new Error(`WebSocket connection error at ${wsUrl}: ${err.message}`)));
    });
  });
}

function toUserInputPart(content: Types.ContentPrimitive): Types.UserInputPart {
  if (typeof content === "string") {
    return { text: content };
  }
  if (
    content instanceof Types.Image ||
    content instanceof Types.Document ||
    content instanceof Types.Audio ||
    content instanceof Types.Video
  ) {
    return {
      media: {
        mimeType: content.mimeType,
        data: content.data,
        description: content.description,
      },
    };
  }
  throw new Error(`Unsupported content type: ${typeof content}`);
}

export class LocalConnection implements Connection {
  private isReceiving = false;
  private currentTurnContext: TurnContext | null = null;

  constructor(
    private child: ChildProcess,
    private ws: WebSocket,
    private queue: Queue.Queue<any>,
    private getIsIdle: () => boolean,
    private getConversationId: () => string,
    private resetIdleState: () => void,
    readonly toolRunner?: ToolRunner,
    readonly hookRunner?: HookRunner
  ) {}

  private getTurnContext(): TurnContext {
    if (!this.currentTurnContext) {
      if (!this.hookRunner) {
        throw new Error("HookRunner is not configured");
      }
      this.currentTurnContext = new TurnContext(this.hookRunner.sessionContext);
    }
    return this.currentTurnContext;
  }

  isIdle(): boolean {
    return this.getIsIdle();
  }

  conversationId(): string {
    return this.getConversationId();
  }

  send(prompt: Types.Content | null): Effect.Effect<void, Error> {
    return Effect.try({
      try: () => {
        this.resetIdleState();
        let event: Types.InputEvent;
        if (prompt === null) {
          event = { userInput: "" };
        } else if (typeof prompt === "string") {
          event = { userInput: prompt };
        } else {
          const contentList = Array.isArray(prompt) ? prompt : [prompt];
          const parts = contentList.map(toUserInputPart);
          event = { complexUserInput: { parts } };
        }
        this.ws.send(JSON.stringify(event));
      },
      catch: (e) => new Error(`Failed to send message: ${e}`),
    });
  }

  receiveSteps(): Stream.Stream<Types.Step, Error> {
    if (this.isReceiving) {
      return Stream.fail(new Error("Concurrent receiveSteps() calls are not supported on this connection."));
    }
    this.isReceiving = true;
    let currentTurnContent = "";

    return Stream.fromQueue(this.queue).pipe(
      Stream.takeWhile((item) => item !== null),
      Stream.filter((item): item is Types.Step => item !== IDLE_SENTINEL),
      Stream.mapEffect((step) => {
        const self = this;
        return Effect.gen(function* () {
          if (step.status === Types.StepStatus.ERROR && step.source === Types.StepSource.SYSTEM) {
            const code = step.httpCode || 0;
            if (code === 400 || code === 401 || code === 403) {
              return yield* Effect.fail(new Error(step.error || "System error occurred."));
            } else {
              console.warn(`System step error (HTTP ${code}): ${step.error}`);
            }
          }

          if (step.source === Types.StepSource.MODEL && step.target === Types.StepTarget.USER) {
            if (step.content) {
              currentTurnContent = step.content;
            } else if (step.contentDelta) {
              currentTurnContent += step.contentDelta;
            }
          }

          const isFromModel = step.source === Types.StepSource.MODEL;
          const isDone = step.status === Types.StepStatus.DONE;
          const isTerminal = isDone || step.status === Types.StepStatus.ERROR || step.status === Types.StepStatus.CANCELED;
          const isTargetUser = step.target === Types.StepTarget.USER;

          if (isTerminal && isTargetUser && isFromModel) {
            if (self.hookRunner && self.currentTurnContext) {
              yield* self.hookRunner.dispatchPostTurn(self.currentTurnContext, currentTurnContent);
              self.currentTurnContext = null;
            }
          }

          return step;
        });
      }),
      Stream.ensuring(Effect.sync(() => {
        this.isReceiving = false;
      }))
    );
  }

  sendToolResults(results: Types.ToolResponse[]): Effect.Effect<void, Error> {
    return Effect.try({
      try: () => {
        for (const res of results) {
          const event: Types.InputEvent = { toolResponse: res };
          this.ws.send(JSON.stringify(event));
        }
      },
      catch: (e) => new Error(`Failed to send tool results: ${e}`),
    });
  }

  sendQuestionResponse(response: Types.UserQuestionsResponse): Effect.Effect<void, Error> {
    return Effect.try({
      try: () => {
        const event: Types.InputEvent = { questionResponse: response };
        this.ws.send(JSON.stringify(event));
      },
      catch: (e) => new Error(`Failed to send question response: ${e}`),
    });
  }

  sendToolConfirmation(confirmation: Types.ToolConfirmation): Effect.Effect<void, Error> {
    return Effect.try({
      try: () => {
        const event: Types.InputEvent = { toolConfirmation: confirmation };
        this.ws.send(JSON.stringify(event));
      },
      catch: (e) => new Error(`Failed to send tool confirmation: ${e}`),
    });
  }

  sendTriggerNotification(content: string): Effect.Effect<void, Error> {
    return Effect.try({
      try: () => {
        const event: Types.InputEvent = { automatedTrigger: content };
        this.ws.send(JSON.stringify(event));
      },
      catch: (e) => new Error(`Failed to send trigger notification: ${e}`),
    });
  }

  cancel(): Effect.Effect<void, Error> {
    return Effect.try({
      try: () => {
        const event: Types.InputEvent = { haltRequest: true };
        this.ws.send(JSON.stringify(event));
      },
      catch: (e) => new Error(`Failed to cancel turn: ${e}`),
    });
  }

  disconnect(): Effect.Effect<void, Error> {
    return Effect.try({
      try: () => {
        (this as any)._disconnecting = true;
        try {
          this.ws.close();
        } catch (_) {}
        try {
          this.child.stdin?.end();
        } catch (_) {}
        try {
          this.child.kill();
        } catch (_) {}
      },
      catch: (e) => new Error(`Failed to disconnect: ${e}`),
    });
  }

  delete(): Effect.Effect<void, Error> {
    return Effect.void;
  }

  signalIdle(): Effect.Effect<void, Error> {
    return Effect.void;
  }

  waitForIdle(): Effect.Effect<void, Error> {
    const check: Effect.Effect<void, Error> = Effect.suspend(() => {
      if (this.isIdle()) {
        return Effect.void;
      }
      return Effect.delay(check, "100 millis");
    });
    return check;
  }

  waitForWakeup(timeoutMs: number): Effect.Effect<boolean, Error> {
    return Effect.succeed(false);
  }

  handleQuestionRequest(stepUpdate: Types.StepUpdate): Effect.Effect<void, Error> {
    return Effect.gen(this, function* () {
      try {
        const questionsList: Types.AskQuestionEntry[] = [];
        const indicesToHook: number[] = [];
        const rawQuestions = stepUpdate.questionsRequest?.questions || [];

        for (let i = 0; i < rawQuestions.length; i++) {
          const uq = rawQuestions[i];
          if (uq.multipleChoice) {
            const mc = uq.multipleChoice;
            const opts: Types.AskQuestionOption[] = mc.choices.map((choice, j) => ({
              id: String(j + 1),
              text: choice,
            }));
            questionsList.push({
              question: mc.question,
              options: opts,
              isMultiSelect: mc.isMultiSelect,
            });
            indicesToHook.push(i);
          }
        }

        const answers: Types.UserQuestionAnswer[] = rawQuestions.map(() => ({
          unanswered: true,
        }));

        if (this.hookRunner && questionsList.length > 0) {
          const ctx = this.getTurnContext();
          const [res, questionRes, _] = yield* this.hookRunner.dispatchInteraction(
            ctx,
            { questions: questionsList }
          );

          if (questionRes) {
            for (let k = 0; k < indicesToHook.length; k++) {
              const origIdx = indicesToHook[k];
              const r = questionRes.responses[k];
              if (!r) continue;

              const ans: Types.UserQuestionAnswer = {};
              if (r.skipped) {
                ans.unanswered = true;
              } else {
                const mcAns: Types.MultipleChoiceAnswer = {
                  selectedChoiceIndices: [],
                };
                if (r.selectedOptionIds) {
                  const indices: number[] = [];
                  for (const optId of r.selectedOptionIds) {
                    const parsed = parseInt(optId, 10);
                    if (!isNaN(parsed)) {
                      indices.push(parsed - 1);
                    }
                  }
                  mcAns.selectedChoiceIndices = indices;
                }
                if (r.freeformResponse !== undefined) {
                  mcAns.freeformResponse = r.freeformResponse;
                }
                ans.multipleChoiceAnswer = mcAns;
              }
              answers[origIdx] = ans;
            }
          }
        }

        const response: Types.UserQuestionsResponse = {
          trajectoryId: stepUpdate.trajectoryId || "",
          stepIndex: stepUpdate.stepIndex || 0,
          response: {
            answers,
          },
        };
        yield* this.sendQuestionResponse(response);
      } catch (err: any) {
        console.error("handleQuestionRequest failed; sending error response", err);
        const errorAnswer: Types.UserQuestionAnswer = {
          multipleChoiceAnswer: {
            selectedChoiceIndices: [],
            freeformResponse: `SDK error processing question: ${err?.message || String(err)}`,
          },
        };
        const response: Types.UserQuestionsResponse = {
          trajectoryId: stepUpdate.trajectoryId || "",
          stepIndex: stepUpdate.stepIndex || 0,
          response: {
            answers: [errorAnswer],
          },
        };
        yield* this.sendQuestionResponse(response);
      }
    });
  }

  handleToolConfirmationRequest(stepUpdate: Types.StepUpdate): Effect.Effect<void, Error> {
    const self = this;
    return Effect.gen(this, function* () {
      try {
        let actionStr = "unknown";
        let args: any = {};
        let foundAction = false;

        for (const [toolEnum, protoField] of Object.entries(BUILTIN_TOOL_PROTO_FIELDS)) {
          if ((stepUpdate as any)[protoField] !== undefined && (stepUpdate as any)[protoField] !== null) {
            actionStr = toolEnum;
            foundAction = true;
            args = { ...(stepUpdate as any)[protoField] };
            break;
          }
        }

        if (!foundAction) {
          actionStr = DEFAULT_HOST_TOOL_NAME;
        }

        const reqText = (stepUpdate as any).requestText || (stepUpdate as any).request_text;
        if (reqText) {
          args["request_text"] = reqText;
        }

        let canonicalPath: string | undefined = undefined;
        for (const pathKey of ["path", "file_path", "TargetFile", "directory_path"]) {
          if (args[pathKey] && typeof args[pathKey] === "string") {
            const normalized = normalizeWirePath(args[pathKey]);
            args[pathKey] = normalized;
            canonicalPath = normalized;
          }
        }

        const trajId = stepUpdate.trajectoryId || "";
        const stepIdx = stepUpdate.stepIndex || 0;
        const stepKey = `${trajId}:${stepIdx}`;

        const tc: Types.ToolCall = {
          id: stepKey,
          name: actionStr,
          args,
          canonicalPath,
        };

        let allow = true;
        let opCtx: OperationContext | undefined = undefined;

        if (tc.name === DEFAULT_HOST_TOOL_NAME) {
          allow = true;
        } else if (self.hookRunner) {
          const ctx = self.getTurnContext();
          const [res, _, outOpCtx] = yield* self.hookRunner.dispatchPreToolCall(ctx, tc);
          allow = res.allow;
          opCtx = outOpCtx;
        }

        if (allow && tc.name !== DEFAULT_HOST_TOOL_NAME && self.hookRunner) {
          if (!opCtx) {
            opCtx = new OperationContext(self.getTurnContext());
          }
          const pendingBuiltinToolCalls = (self as any).pendingBuiltinToolCalls as Map<string, { toolCall: Types.ToolCall; operationContext: OperationContext }>;
          if (pendingBuiltinToolCalls) {
            pendingBuiltinToolCalls.set(stepKey, {
              toolCall: tc,
              operationContext: opCtx,
            });
          }
        }

        const confirmation: Types.ToolConfirmation = {
          trajectoryId: trajId,
          stepIndex: stepIdx,
          accepted: allow,
        };
        yield* self.sendToolConfirmation(confirmation);
      } catch (err) {
        console.error("handleToolConfirmationRequest failed; rejecting", err);
        const confirmation: Types.ToolConfirmation = {
          trajectoryId: stepUpdate.trajectoryId || "",
          stepIndex: stepUpdate.stepIndex || 0,
          accepted: false,
        };
        yield* self.sendToolConfirmation(confirmation);
      }
    });
  }

  handleCustomToolCall(toolCall: Types.ToolCall): Effect.Effect<void, Error> {
    const self = this;
    return Effect.gen(this, function* () {
      try {
        const args = toolCall.argumentsJson ? JSON.parse(toolCall.argumentsJson) : (toolCall.args || {});
        const tc: Types.ToolCall = {
          id: toolCall.id,
          name: toolCall.name,
          args,
        };

        const simulatedStep: Types.Step = {
          id: toolCall.id,
          stepIndex: 1,
          type: Types.StepType.TOOL_CALL,
          source: Types.StepSource.MODEL,
          target: Types.StepTarget.ENVIRONMENT,
          status: Types.StepStatus.ACTIVE,
          content: "",
          contentDelta: "",
          thinking: "",
          thinkingDelta: "",
          toolCalls: [tc],
          error: "",
          isCompleteResponse: false,
          structuredOutput: null,
          trajectoryId: self.conversationId(),
        };

        yield* Queue.offer(self.queue, simulatedStep);

        let opCtx: OperationContext | undefined = undefined;

        if (self.hookRunner) {
          const ctx = self.getTurnContext();
          const [res, updatedTc, outOpCtx] = yield* self.hookRunner.dispatchPreToolCall(ctx, tc);
          opCtx = outOpCtx;

          if (!res.allow) {
            const reason = res.message || "No reason provided";
            const errMsg = `Tool execution denied by hook policy: ${reason}`;
            yield* self.sendToolResults([{
              id: toolCall.id,
              responseJson: JSON.stringify({ error: errMsg }),
            }]);
            return;
          }
        }

        if (self.toolRunner) {
          let toolError: Error | undefined = undefined;
          let result: Types.ToolResult;

          try {
            const results = yield* self.toolRunner.processToolCalls([tc]);
            result = results[0];
            result.id = toolCall.id;
            if (result.error) {
              toolError = result.exception || new Error(result.error);
            }
          } catch (e: any) {
            toolError = e instanceof Error ? e : new Error(String(e));
            result = {
              id: toolCall.id,
              name: tc.name,
              error: toolError.message,
              exception: toolError,
            };
          }

          if (toolError && self.hookRunner) {
            if (!opCtx) {
              opCtx = new OperationContext(self.getTurnContext());
            }
            const [recoveryRes, recoveryVal] = yield* self.hookRunner.dispatchOnToolError(opCtx, toolError);
            if (recoveryRes.allow && recoveryVal !== null && recoveryVal !== undefined) {
              result = {
                id: toolCall.id,
                name: tc.name,
                result: recoveryVal,
              };
            }
          } else if (!result.error && self.hookRunner) {
            if (!opCtx) {
              opCtx = new OperationContext(self.getTurnContext());
            }
            yield* self.hookRunner.dispatchPostToolCall(opCtx, result);
          }

          const responseJson = result.error
            ? JSON.stringify({ error: result.error })
            : typeof result.result === "string"
              ? result.result
              : JSON.stringify(result.result);

          yield* self.sendToolResults([{
            id: toolCall.id,
            responseJson,
          }]);
        } else {
          console.warn(`Received custom tool call ${toolCall.name} but no tool runner is configured.`);
        }
      } catch (err: any) {
        console.error("handleCustomToolCall failed; returning error to model", err);
        yield* self.sendToolResults([{
          id: toolCall.id,
          responseJson: JSON.stringify({ error: `Internal SDK error: ${err?.message || String(err)}` }),
        }]);
      }
    });
  }
}

export class LocalConnectionStrategy implements ConnectionStrategy {
  constructor(
    private saveDir?: string,
    private harnessConfig?: Types.HarnessConfig,
    readonly toolRunner?: ToolRunner,
    readonly hookRunner?: HookRunner
  ) {}

  connect(): Effect.Effect<Connection, Error> {
    return Effect.gen(this, function* () {
      const { child, port, apiKey } = yield* handshake(this.saveDir);

      const wsConnectionWithRetry = connectWs(port, apiKey).pipe(
        Effect.retry(
          Schedule.exponential(100).pipe(Schedule.compose(Schedule.recurs(5)))
        )
      );

      const ws = yield* wsConnectionWithRetry;

      if (this.harnessConfig) {
        const initEvent: Types.InitializeConversationEvent = {
          config: this.harnessConfig,
        };
        ws.send(JSON.stringify(initEvent));
      }

      const queue = yield* Queue.unbounded<any>();

      const stderrLines: string[] = [];
      if (child.stderr) {
        child.stderr.on("data", (chunk: Buffer) => {
          const text = chunk.toString("utf8");
          const lines = text.split("\n");
          for (const line of lines) {
            if (line.trim()) {
              stderrLines.push(line.trim());
              if (stderrLines.length > 100) {
                stderrLines.shift();
              }
              console.error(`[harness stderr] ${line.trim()}`);
            }
          }
        });
      }

      let parentIdle = true;
      const activeSubagents = new Set<string>();
      let isIdle = true;
      let conversationId = "";

      const getIsIdle = () => isIdle;
      const getConversationId = () => conversationId;
      const resetIdleState = () => {
        isIdle = false;
        parentIdle = false;
        activeSubagents.clear();
      };

      const stepTrackers = new Map<string, StepTracker>();
      const pendingBuiltinToolCalls = new Map<string, { toolCall: Types.ToolCall; operationContext: OperationContext }>();
      const subagentResponses = new Map<string, string>();

      const localConn = new LocalConnection(
        child,
        ws,
        queue,
        getIsIdle,
        getConversationId,
        resetIdleState,
        this.toolRunner,
        this.hookRunner
      );

      // Mutate to set properties on localConn for internal websocket access
      (localConn as any).pendingBuiltinToolCalls = pendingBuiltinToolCalls;

      yield* Effect.forkDaemon(
        Effect.async<void, Error>((resume) => {
          ws.on("message", (data) => {
            try {
              const event = JSON.parse(data.toString()) as Types.OutputEvent;

              if (event.stepUpdate) {
                const stepUpdate = event.stepUpdate;
                const trajId = stepUpdate.trajectoryId || "";
                const stepIdx = stepUpdate.stepIndex || 0;
                const stepKey = `${trajId}:${stepIdx}`;

                if (!stepTrackers.has(stepKey)) {
                  stepTrackers.set(stepKey, new StepTracker());
                }
                const tracker = stepTrackers.get(stepKey)!;
                tracker.updateState(stepUpdate.state || Types.StepState.STATE_UNSPECIFIED);

                const stepObj = parseStepUpdate(stepUpdate);
                if (event.usageMetadata) {
                  stepObj.usageMetadata = parseUsageMetadata(event.usageMetadata);
                }

                Effect.runFork(Queue.offer(queue, stepObj));

                if (stepUpdate.cascadeId && stepUpdate.cascadeId === stepUpdate.trajectoryId) {
                  conversationId = stepUpdate.cascadeId;
                }

                if (stepObj.type === Types.StepType.COMPACTION && localConn.hookRunner) {
                  Effect.runFork(localConn.hookRunner.dispatchCompaction(
                    (localConn as any).getTurnContext(),
                    stepObj
                  ));
                }

                const isSubagentStep = conversationId !== "" && stepObj.trajectoryId !== conversationId;
                if (isSubagentStep && stepObj.source === Types.StepSource.MODEL && stepObj.content) {
                  subagentResponses.set(stepObj.trajectoryId || "", stepObj.content);
                }

                // Dispatch post-tool-call or on-tool-error hooks for pending builtin tool calls
                if (pendingBuiltinToolCalls.has(stepKey) && stepUpdate.state === Types.StepState.STATE_DONE) {
                  const pending = pendingBuiltinToolCalls.get(stepKey)!;
                  pendingBuiltinToolCalls.delete(stepKey);
                  if (localConn.hookRunner) {
                    const extracted = extractToolResult(stepUpdate);
                    const result: Types.ToolResult = {
                      name: pending.toolCall.name,
                      id: pending.toolCall.id,
                      result: extracted || stepObj.content,
                    };
                    Effect.runFork(localConn.hookRunner.dispatchPostToolCall(pending.operationContext, result));
                  }
                } else if (pendingBuiltinToolCalls.has(stepKey) && stepUpdate.state === Types.StepState.STATE_ERROR) {
                  const pending = pendingBuiltinToolCalls.get(stepKey)!;
                  pendingBuiltinToolCalls.delete(stepKey);
                  if (localConn.hookRunner) {
                    const err = new Error(stepUpdate.errorMessage || stepObj.content || "Built-in tool failed");
                    Effect.runFork(Effect.map(
                      localConn.hookRunner.dispatchOnToolError(pending.operationContext, err),
                      () => {}
                    ));
                  }
                }

                // Debounce interaction/confirmations in WAITING_FOR_USER state
                if (stepUpdate.state === Types.StepState.STATE_WAITING_FOR_USER) {
                  if (stepUpdate.questionsRequest) {
                    if (tracker.markHandled("questions_request")) {
                      Effect.runFork((localConn as any).handleQuestionRequest(stepUpdate));
                    }
                  }
                  if (stepUpdate.toolConfirmationRequest) {
                    if (tracker.markHandled("tool_confirmation_request")) {
                      Effect.runFork((localConn as any).handleToolConfirmationRequest(stepUpdate));
                    }
                  }
                }
              }

              if (event.trajectoryStateUpdate) {
                const tsu = event.trajectoryStateUpdate;
                const isSubagent = conversationId !== "" && tsu.trajectoryId !== conversationId;

                if (tsu.state === Types.TrajectoryState.STATE_RUNNING) {
                  if (isSubagent) {
                    activeSubagents.add(tsu.trajectoryId);
                  }
                } else if (tsu.state === Types.TrajectoryState.STATE_IDLE) {
                  if (isSubagent) {
                    activeSubagents.delete(tsu.trajectoryId);
                    if (localConn.hookRunner) {
                      const turnCtx = (localConn as any).getTurnContext();
                      const opCtx = new OperationContext(turnCtx);
                      const response = subagentResponses.get(tsu.trajectoryId) || "";
                      subagentResponses.delete(tsu.trajectoryId);
                      const result: Types.ToolResult = {
                        name: Types.BuiltinTools.START_SUBAGENT,
                        result: response || tsu.trajectoryId,
                      };
                      Effect.runFork(localConn.hookRunner.dispatchPostToolCall(opCtx, result));
                    }
                  } else {
                    parentIdle = true;
                  }
                }

                const nextIdle = parentIdle && activeSubagents.size === 0;
                if (nextIdle && !isIdle) {
                  isIdle = true;
                  Effect.runFork(Queue.offer(queue, IDLE_SENTINEL));
                  Effect.runFork(Queue.offer(queue, null));
                } else {
                  isIdle = nextIdle;
                }
              }

              if (event.toolCall) {
                Effect.runFork((localConn as any).handleCustomToolCall(event.toolCall));
              }
            } catch (err) {
              console.error("Error parsing WebSocket message:", err);
            }
          });

          ws.on("error", (err) => {
            Effect.runFork(Queue.shutdown(queue));
            resume(Effect.fail(err));
          });

          ws.on("close", (code) => {
            Effect.runFork(Queue.shutdown(queue));
            if (!(localConn as any)._disconnecting) {
              const stderrTail = stderrLines.join("\n") || "(no stderr output)";
              const errorMsg = `Harness process exited unexpectedly (WS close code ${code}).\nHarness stderr:\n${stderrTail}`;
              console.error(errorMsg);
              resume(Effect.fail(new Error(errorMsg)));
            } else {
              resume(Effect.void);
            }
          });
        })
      );

      // Trigger OnSessionStartHook if present
      if (localConn.hookRunner && localConn.hookRunner.onSessionStartHooks.length > 0) {
        yield* localConn.hookRunner.dispatchSessionStart();
      }

      return localConn;
    });
  }
}
