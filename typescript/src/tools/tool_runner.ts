import { Effect } from "effect";
import * as Types from "../types.ts";
import { ToolContext } from "./tool_context.ts";

interface InjectInfo {
  isInjectable: boolean;
  position: "first" | "second" | "object_field" | "none";
  fieldName?: string;
}

function getFirstParamName(fn: Function): string {
  const str = fn.toString();
  const clean = str.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, "$1");
  const match = clean.match(/(?:function\s*\w*\s*|^\s*|^\s*\(\s*)\(([^)]*)\)/);
  if (!match) return "";
  const params = match[1].split(",").map((s: string) => s.trim());
  return params[0] || "";
}

function findContextParam(tool: any): InjectInfo {
  const fn = typeof tool === "function" ? tool : tool && typeof tool.run === "function" ? tool.run : null;
  if (!fn) {
    return { isInjectable: false, position: "none" };
  }

  if (tool.injectContext || tool.hasContext || fn.injectContext || fn.hasContext) {
    if (fn.length >= 2) {
      return { isInjectable: true, position: "second" };
    }
    return { isInjectable: true, position: "object_field", fieldName: "ctx" };
  }

  const str = fn.toString();
  const clean = str.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, "$1");
  const match = clean.match(/(?:function\s*\w*\s*|^\s*|^\s*\(\s*)\(([^)]*)\)/);
  if (match) {
    const paramsText = match[1].trim();
    if (paramsText.startsWith("{")) {
      const closingIndex = paramsText.indexOf("}");
      if (closingIndex !== -1) {
        const inner = paramsText.slice(1, closingIndex);
        const destructured = inner.split(",").map((s: string) => s.trim());
        if (destructured.includes("ctx") || destructured.includes("context")) {
          const fieldName = destructured.includes("ctx") ? "ctx" : "context";
          return { isInjectable: true, position: "object_field", fieldName };
        }
      }
    }
    const params = paramsText.split(",").map((s: string) => s.trim());
    if (params[0] === "ctx" || params[0] === "context") {
      return { isInjectable: true, position: "first" };
    }
    if (params[1] === "ctx" || params[1] === "context") {
      return { isInjectable: true, position: "second" };
    }
  }

  return { isInjectable: false, position: "none" };
}

export class ToolRunner {
  private _tools: Record<string, any> = {};
  private _context: ToolContext | null = null;
  private _contextParams: Record<string, InjectInfo> = {};

  constructor(tools: any[] = []) {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  setContext(ctx: ToolContext): void {
    this._context = ctx;
  }

  register(tool: any, name?: string): void {
    const toolName = name || tool.name || (typeof tool === "function" ? tool.name : null);
    if (!toolName) {
      throw new Error("Cannot register a tool without a name.");
    }
    if (this._tools[toolName]) {
      throw new Error(`Tool '${toolName}' is already registered.`);
    }
    this._tools[toolName] = tool;
    this._contextParams[toolName] = findContextParam(tool);
  }

  unregister(name: string): void {
    if (!this._tools[name]) {
      throw new Error(`Tool '${name}' is not registered.`);
    }
    delete this._tools[name];
    delete this._contextParams[name];
  }

  get toolNames(): string[] {
    return Object.keys(this._tools);
  }

  getPublicCallable(toolName: string): any {
    if (!this._tools[toolName]) {
      throw new Error(`Tool '${toolName}' is not registered.`);
    }
    return this._tools[toolName];
  }

  async execute(toolName: string, args: any): Promise<any> {
    const tool = this._tools[toolName];
    if (!tool) {
      throw new Error(`Tool '${toolName}' is not registered.`);
    }

    const fn = typeof tool === "function" ? tool : tool.run;
    if (!fn) {
      throw new Error(`Tool '${toolName}' does not have a run method or is not callable.`);
    }

    const info = this._contextParams[toolName] || { isInjectable: false, position: "none" };

    let resolvedArgs: any[] = [];
    if (info.isInjectable && this._context) {
      if (info.position === "first") {
        resolvedArgs = [this._context, args];
      } else if (info.position === "second") {
        resolvedArgs = [args, this._context];
      } else if (info.position === "object_field") {
        const field = info.fieldName || "ctx";
        resolvedArgs = [{ ...args, [field]: this._context }];
      }
    } else {
      resolvedArgs = [args];
    }

    const result = fn(...resolvedArgs);
    if (Effect.isEffect(result)) {
      return await Effect.runPromise(result as any);
    }
    if (result && typeof result.then === "function") {
      return await result;
    }
    return result;
  }

  processToolCalls(toolCalls: Types.ToolCall[]): Effect.Effect<Types.ToolResult[], Error> {
    return Effect.promise(async () => {
      const executeOne = async (tc: Types.ToolCall): Promise<Types.ToolResult> => {
        try {
          if (!this._tools[tc.name]) {
            return {
              name: tc.name,
              id: tc.id,
              error: `Unknown tool: '${tc.name}'`,
            };
          }
          const args = tc.args || (tc.argumentsJson ? JSON.parse(tc.argumentsJson) : {});
          const result = await this.execute(tc.name, args);
          return {
            name: tc.name,
            id: tc.id,
            result,
          };
        } catch (e: any) {
          return {
            name: tc.name,
            id: tc.id,
            error: e?.message || String(e),
            exception: e instanceof Error ? e : new Error(String(e)),
          };
        }
      };

      return Promise.all(toolCalls.map(executeOne));
    });
  }
}
