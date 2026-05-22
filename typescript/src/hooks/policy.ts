import { Effect } from "effect";
import * as Types from "../types.ts";
import { PreToolCallDecideHook, resolveHookValue } from "./hooks.ts";
import { BuiltinToolsHelpers } from "../types.ts";
import * as path from "node:path";
import * as fs from "node:fs";

export enum Decision {
  APPROVE = "APPROVE",
  DENY = "DENY",
  ASK_USER = "ASK_USER",
}

export interface Policy {
  tool: string;
  decision: Decision;
  when?: (args: any) => any;
  askUser?: (toolCall: Types.ToolCall) => any;
  name?: string;
}

const WILDCARD = "*";

const LEVEL_SPECIFIC_DENY = 0;
const LEVEL_SPECIFIC_ASK = 1;
const LEVEL_SPECIFIC_ALLOW = 2;
const LEVEL_WILDCARD_DENY = 3;
const LEVEL_WILDCARD_ASK = 4;
const LEVEL_WILDCARD_ALLOW = 5;
const NUM_LEVELS = 6;

const DECISION_TO_SPECIFIC_LEVEL = {
  [Decision.DENY]: LEVEL_SPECIFIC_DENY,
  [Decision.ASK_USER]: LEVEL_SPECIFIC_ASK,
  [Decision.APPROVE]: LEVEL_SPECIFIC_ALLOW,
};

const DECISION_TO_WILDCARD_LEVEL = {
  [Decision.DENY]: LEVEL_WILDCARD_DENY,
  [Decision.ASK_USER]: LEVEL_WILDCARD_ASK,
  [Decision.APPROVE]: LEVEL_WILDCARD_ALLOW,
};

function bucketIndex(p: Policy): number {
  if (p.tool === WILDCARD) {
    return DECISION_TO_WILDCARD_LEVEL[p.decision];
  }
  return DECISION_TO_SPECIFIC_LEVEL[p.decision];
}

function getFirstParamName(fn: Function): string {
  const str = fn.toString();
  const clean = str.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, "$1");
  const match = clean.match(/(?:function\s*\w*\s*|^\s*|^\s*\(\s*)\(([^)]*)\)/);
  if (!match) return "";
  const params = match[1].split(",").map((s: string) => s.trim());
  return params[0] || "";
}

class PolicyDecideHook extends PreToolCallDecideHook {
  constructor(private buckets: Policy[][]) {
    super(async (context, toolCall) => {
      try {
        for (const bucket of this.buckets) {
          for (const p of bucket) {
            const result = await this.evaluatePolicy(p, toolCall);
            if (result !== null) {
              return result;
            }
          }
        }
      } catch (e: any) {
        return {
          allow: false,
          message: `Internal policy error: ${e?.message || e}`,
        };
      }
      return { allow: true };
    });
  }

  private async evaluatePolicy(p: Policy, toolCall: Types.ToolCall): Promise<Types.HookResult | null> {
    if (p.tool !== WILDCARD && p.tool !== toolCall.name) {
      return null;
    }

    try {
      if (p.when) {
        const paramName = getFirstParamName(p.when);
        const wantsToolCall =
          /^(tc|toolCall|tool_call|call|tool)$/i.test(paramName) || (p.when as any).wantsToolCall;
        const arg = wantsToolCall
          ? toolCall
          : toolCall.args || (toolCall.argumentsJson ? JSON.parse(toolCall.argumentsJson) : {});
        const matched = await resolveHookValue<boolean>(p.when(arg));
        if (!matched) {
          return null;
        }
      }

      return await this.apply(p, toolCall);
    } catch (e: any) {
      return {
        allow: false,
        message: `Policy evaluation failed for policy '${p.name || p.tool}': ${e?.message || e}`,
      };
    }
  }

  private async apply(p: Policy, toolCall: Types.ToolCall): Promise<Types.HookResult> {
    const label = p.name || p.tool;
    if (p.decision === Decision.DENY) {
      return {
        allow: false,
        message: `Denied by policy '${label}'.`,
      };
    }
    if (p.decision === Decision.APPROVE) {
      return { allow: true };
    }

    // ASK_USER
    if (!p.askUser) {
      return {
        allow: false,
        message: `Policy '${label}' decision is ASK_USER but no handler is provided.`,
      };
    }
    const approved = await resolveHookValue<boolean>(p.askUser(toolCall));
    if (approved) {
      return { allow: true };
    }
    return {
      allow: false,
      message: `User denied tool '${toolCall.name}' (policy '${label}').`,
    };
  }
}

export function allow(tool: string, when?: (args: any) => any, name = ""): Policy {
  return { tool, decision: Decision.APPROVE, when, name };
}

export function deny(tool: string, when?: (args: any) => any, name = ""): Policy {
  return { tool, decision: Decision.DENY, when, name };
}

export function ask_user(
  tool: string,
  handler: (toolCall: Types.ToolCall) => any,
  when?: (args: any) => any,
  name = ""
): Policy {
  return { tool, decision: Decision.ASK_USER, askUser: handler, when, name };
}

export function allow_all(): Policy {
  return allow(WILDCARD, undefined, "allow_all");
}

export function deny_all(): Policy {
  return deny(WILDCARD, undefined, "deny_all");
}

export function safe_defaults(handler: (toolCall: Types.ToolCall) => any): Policy[] {
  return [
    ...BuiltinToolsHelpers.readOnly().map(t => allow(t)),
    ask_user(WILDCARD, handler, undefined, "safe_defaults_fallback"),
  ];
}

export function confirm_run_command(handler?: (toolCall: Types.ToolCall) => any): Policy[] {
  if (handler) {
    return [
      ask_user(Types.BuiltinTools.RUN_COMMAND, handler, undefined, "confirm_run_command"),
      allow(WILDCARD, undefined, "confirm_run_command"),
    ];
  }
  return [
    deny(Types.BuiltinTools.RUN_COMMAND, undefined, "confirm_run_command"),
    allow(WILDCARD, undefined, "confirm_run_command"),
  ];
}

const caseInsensitiveCache = new Map<string, boolean>();

function _isCaseInsensitive(p: string): boolean {
  const norm = path.resolve(p);
  if (caseInsensitiveCache.has(norm)) {
    return caseInsensitiveCache.get(norm)!;
  }

  if (!fs.existsSync(norm)) {
    const isCI = process.platform === "win32" || process.platform === "darwin";
    caseInsensitiveCache.set(norm, isCI);
    return isCI;
  }

  const parent = path.dirname(norm);
  const name = path.basename(norm);
  if (!name || parent === norm) {
    const isCI = process.platform === "win32" || process.platform === "darwin";
    caseInsensitiveCache.set(norm, isCI);
    return isCI;
  }

  const swappedName = name
    .split("")
    .map(c => {
      const u = c.toUpperCase();
      const l = c.toLowerCase();
      return c === u ? l : u;
    })
    .join("");

  if (swappedName === name) {
    const isCI = _isCaseInsensitive(parent);
    caseInsensitiveCache.set(norm, isCI);
    return isCI;
  }

  const swappedPath = path.join(parent, swappedName);
  try {
    const stat1 = fs.statSync(norm);
    const stat2 = fs.statSync(swappedPath);
    const isCI = stat1.dev === stat2.dev && stat1.ino === stat2.ino;
    caseInsensitiveCache.set(norm, isCI);
    return isCI;
  } catch (_) {
    caseInsensitiveCache.set(norm, false);
    return false;
  }
}

function _secureNormalizePath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch (err: any) {
    const absolutePath = path.resolve(p);
    let current = absolutePath;
    let suffix = "";
    while (current && current !== "/" && !fs.existsSync(current)) {
      suffix = path.join(path.basename(current), suffix);
      current = path.dirname(current);
    }
    if (current && current !== "/") {
      try {
        const resolvedParent = fs.realpathSync(current);
        return path.join(resolvedParent, suffix);
      } catch (_) {}
    }
    return absolutePath;
  }
}

export function isPathInWorkspace(targetPath: string, workspacePath: string): boolean {
  try {
    const normTarget = _secureNormalizePath(targetPath);
    const normWs = _secureNormalizePath(workspacePath);

    const isCI = _isCaseInsensitive(normWs);

    let targetParts = normTarget.split(path.sep).filter(Boolean);
    let wsParts = normWs.split(path.sep).filter(Boolean);

    if (isCI) {
      targetParts = targetParts.map(p => p.toLowerCase());
      wsParts = wsParts.map(p => p.toLowerCase());
    }

    if (targetParts.length < wsParts.length) {
      return false;
    }

    for (let i = 0; i < wsParts.length; i++) {
      if (targetParts[i] !== wsParts[i]) {
        return false;
      }
    }
    return true;
  } catch (_) {
    return false;
  }
}

export function workspace_only(workspaces: string[]): Policy[] {
  const fileTools = BuiltinToolsHelpers.fileTools();

  const fn = (tc: Types.ToolCall) => {
    const targetPath = tc.canonicalPath || "";
    if (!targetPath) return false;
    return !workspaces.some(ws => isPathInWorkspace(targetPath, ws));
  };
  (fn as any).wantsToolCall = true;

  return fileTools.map(tool => deny(tool, fn, "workspace_only"));
}

export function enforce(policies: Policy[]): PreToolCallDecideHook {
  for (const p of policies) {
    if (p.decision === Decision.ASK_USER && !p.askUser) {
      throw new Error(
        `ASK_USER policy '${p.name || p.tool}' is missing an ask_user handler. Provide one via policy.ask_user(tool, handler=...).`
      );
    }
  }

  const buckets: Policy[][] = Array.from({ length: NUM_LEVELS }, () => []);
  for (const p of policies) {
    buckets[bucketIndex(p)].push(p);
  }

  return new PolicyDecideHook(buckets);
}
