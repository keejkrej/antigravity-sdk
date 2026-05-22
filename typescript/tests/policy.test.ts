import { expect, test, describe } from "bun:test";
import { Decision, allow, deny, ask_user, allow_all, deny_all, safe_defaults, confirm_run_command, isPathInWorkspace, workspace_only, enforce } from "../src/hooks/policy.ts";
import { HookRunner } from "../src/hooks/hook_runner.ts";
import { SessionContext, TurnContext } from "../src/hooks/hooks.ts";
import { BuiltinTools, ToolCall } from "../src/types.ts";
import { Effect } from "effect";
import * as path from "node:path";
import * as fs from "node:fs";

describe("Policy Decision Priority", () => {
  test("Specific Deny should take precedence over Specific Allow", async () => {
    // Specific Deny vs Specific Allow on same tool
    const p1 = allow(BuiltinTools.RUN_COMMAND);
    const p2 = deny(BuiltinTools.RUN_COMMAND);
    const hook = enforce([p1, p2]);

    const runner = new HookRunner([hook]);
    const tc: ToolCall = { name: BuiltinTools.RUN_COMMAND, id: "1" };
    const session = new SessionContext();
    const turn = new TurnContext(session);

    const [res] = await Effect.runPromise(runner.dispatchPreToolCall(turn, tc));
    expect(res.allow).toBe(false);
    expect(res.message).toContain("Denied by policy");
  });

  test("Specific Ask should take precedence over Specific Allow", async () => {
    let asked = false;
    const p1 = allow(BuiltinTools.RUN_COMMAND);
    const p2 = ask_user(BuiltinTools.RUN_COMMAND, () => {
      asked = true;
      return true;
    });
    const hook = enforce([p1, p2]);

    const runner = new HookRunner([hook]);
    const tc: ToolCall = { name: BuiltinTools.RUN_COMMAND, id: "1" };
    const session = new SessionContext();
    const turn = new TurnContext(session);

    const [res] = await Effect.runPromise(runner.dispatchPreToolCall(turn, tc));
    expect(res.allow).toBe(true);
    expect(asked).toBe(true);
  });

  test("Specific Allow should take precedence over Wildcard Deny", async () => {
    const p1 = allow(BuiltinTools.RUN_COMMAND);
    const p2 = deny_all();
    const hook = enforce([p1, p2]);

    const runner = new HookRunner([hook]);
    const tc: ToolCall = { name: BuiltinTools.RUN_COMMAND, id: "1" };
    const session = new SessionContext();
    const turn = new TurnContext(session);

    const [res] = await Effect.runPromise(runner.dispatchPreToolCall(turn, tc));
    expect(res.allow).toBe(true);
  });

  test("when clause should condition policy evaluation", async () => {
    const p1 = deny(BuiltinTools.RUN_COMMAND, (args) => args.cmd === "rm -rf");
    const hook = enforce([p1, allow_all()]);

    const runner = new HookRunner([hook]);
    const session = new SessionContext();
    const turn = new TurnContext(session);

    const tcSafe: ToolCall = { name: BuiltinTools.RUN_COMMAND, id: "1", args: { cmd: "ls" } };
    const [resSafe] = await Effect.runPromise(runner.dispatchPreToolCall(turn, tcSafe));
    expect(resSafe.allow).toBe(true);

    const tcUnsafe: ToolCall = { name: BuiltinTools.RUN_COMMAND, id: "2", args: { cmd: "rm -rf" } };
    const [resUnsafe] = await Effect.runPromise(runner.dispatchPreToolCall(turn, tcUnsafe));
    expect(resUnsafe.allow).toBe(false);
  });
});

describe("isPathInWorkspace & workspace_only", () => {
  test("isPathInWorkspace checks relative/absolute bounds and normalization", () => {
    const workspace = "/home/user/project";
    expect(isPathInWorkspace("/home/user/project/src/index.ts", workspace)).toBe(true);
    expect(isPathInWorkspace("/home/user/project/../outside/file.ts", workspace)).toBe(false);
    expect(isPathInWorkspace("/home/user/project", workspace)).toBe(true);
    expect(isPathInWorkspace("/home/user", workspace)).toBe(false);
  });

  test("workspace_only policy denies paths outside workspace", async () => {
    const ws = ["/workspace"];
    const policies = workspace_only(ws);
    // Add allow_all() to let other tools/calls pass if not matching the deny criteria
    const hook = enforce([...policies, allow_all()]);

    const runner = new HookRunner([hook]);
    const session = new SessionContext();
    const turn = new TurnContext(session);

    // Call inside workspace
    const insideCall: ToolCall = {
      name: BuiltinTools.VIEW_FILE,
      id: "1",
      canonicalPath: "/workspace/src/index.ts",
      args: { path: "/workspace/src/index.ts" }
    };
    const [resInside] = await Effect.runPromise(runner.dispatchPreToolCall(turn, insideCall));
    expect(resInside.allow).toBe(true);

    // Call outside workspace
    const outsideCall: ToolCall = {
      name: BuiltinTools.VIEW_FILE,
      id: "2",
      canonicalPath: "/etc/passwd",
      args: { path: "/etc/passwd" }
    };
    const [resOutside] = await Effect.runPromise(runner.dispatchPreToolCall(turn, outsideCall));
    expect(resOutside.allow).toBe(false);
    expect(resOutside.message).toContain("Denied by policy");
  });
});
