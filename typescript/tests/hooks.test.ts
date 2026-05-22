import { expect, test, describe } from "bun:test";
import { HookContext, SessionContext, TurnContext, OperationContext, on_session_start, on_session_end, pre_turn, post_turn, pre_tool_call_decide, post_tool_call, on_tool_error } from "../src/hooks/hooks.ts";
import { HookRunner } from "../src/hooks/hook_runner.ts";
import { Effect } from "effect";

describe("HookContext hierarchy", () => {
  test("context values should resolve up the parent hierarchy", () => {
    const session = new SessionContext();
    session.set("key1", "val1");
    session.set("override", "session-val");

    const turn = new TurnContext(session);
    turn.set("key2", "val2");
    turn.set("override", "turn-val");

    const op = new OperationContext(turn);
    op.set("key3", "val3");

    expect(op.get("key3")).toBe("val3");
    expect(op.get("key2")).toBe("val2");
    expect(op.get("key1")).toBe("val1");
    expect(op.get("override")).toBe("turn-val");
    expect(op.get("missing", "default")).toBe("default");
  });
});

describe("HookRunner", () => {
  test("should register different types of hooks and check hasHooks", () => {
    const runner = new HookRunner();
    expect(runner.hasHooks).toBe(false);

    runner.registerHook(on_session_start(() => {}));
    expect(runner.hasHooks).toBe(true);
  });

  test("should dispatch session start/end hooks in registered order", async () => {
    const log: string[] = [];
    const runner = new HookRunner([
      on_session_start(() => { log.push("start1"); }),
      on_session_start(() => Effect.sync(() => { log.push("start2"); })),
      on_session_end(() => { log.push("end1"); }),
    ]);

    await Effect.runPromise(runner.dispatchSessionStart());
    expect(log).toEqual(["start1", "start2"]);

    await Effect.runPromise(runner.dispatchSessionEnd());
    expect(log).toEqual(["start1", "start2", "end1"]);
  });

  test("should dispatch pre_turn and stop if a hook denies", async () => {
    const log: string[] = [];
    const runner = new HookRunner([
      pre_turn((data) => {
        log.push("pre1:" + data);
        return { allow: true };
      }),
      pre_turn((data) => {
        log.push("pre2:" + data);
        return { allow: false, message: "denied-at-2" };
      }),
      pre_turn((data) => {
        log.push("pre3:" + data);
        return { allow: true };
      }),
    ]);

    const [res, turnCtx] = await Effect.runPromise(runner.dispatchPreTurn({ text: "hello" }));
    expect(res.allow).toBe(false);
    expect(res.message).toBe("denied-at-2");
    expect(log).toEqual(["pre1:[object Object]", "pre2:[object Object]"]);
    expect(turnCtx).toBeInstanceOf(TurnContext);
  });

  test("should dispatch post_turn hooks", async () => {
    const log: string[] = [];
    const runner = new HookRunner([
      post_turn((data) => { log.push("post:" + data); })
    ]);
    const session = new SessionContext();
    const turn = new TurnContext(session);
    await Effect.runPromise(runner.dispatchPostTurn(turn, "response text"));
    expect(log).toEqual(["post:response text"]);
  });

  test("should dispatch tool error recovery", async () => {
    const runner = new HookRunner([
      on_tool_error((err) => {
        if (err.message === "recoverable") {
          return "recovered-value";
        }
      }),
    ]);
    const session = new SessionContext();
    const turn = new TurnContext(session);
    const op = new OperationContext(turn);

    const [res1, val1] = await Effect.runPromise(runner.dispatchOnToolError(op, new Error("recoverable")));
    expect(res1.allow).toBe(true);
    expect(val1).toBe("recovered-value");

    const [res2, val2] = await Effect.runPromise(runner.dispatchOnToolError(op, new Error("fatal")));
    expect(res2.allow).toBe(false);
    expect(val2).toBeNull();
  });
});
