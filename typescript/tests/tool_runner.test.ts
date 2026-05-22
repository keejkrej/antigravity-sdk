import { expect, test, describe } from "bun:test";
import { ToolRunner } from "../src/tools/tool_runner.ts";
import { ToolContext } from "../src/tools/tool_context.ts";
import { Connection } from "../src/connection.ts";
import { Effect } from "effect";

class MockConnection implements Connection {
  isIdle() { return true; }
  conversationId() { return "test-conv"; }
  send() { return Effect.void; }
  receiveSteps(): any { return null; }
  sendToolResults() { return Effect.void; }
  sendQuestionResponse() { return Effect.void; }
  sendToolConfirmation() { return Effect.void; }
  sendTriggerNotification(content: string) { return Effect.void; }
  cancel() { return Effect.void; }
  disconnect() { return Effect.void; }
  delete() { return Effect.void; }
  signalIdle() { return Effect.void; }
  waitForIdle() { return Effect.void; }
  waitForWakeup(timeoutMs: number) { return Effect.succeed(true); }
}

describe("ToolRunner", () => {
  test("register and execute simple tool", async () => {
    const runner = new ToolRunner();
    runner.register(function add({ a, b }: { a: number; b: number }) {
      return a + b;
    });

    expect(runner.toolNames).toEqual(["add"]);
    const res = await runner.execute("add", { a: 2, b: 3 });
    expect(res).toBe(5);
  });

  test("inject context as first parameter", async () => {
    const runner = new ToolRunner();
    const conn = new MockConnection();
    const ctx = new ToolContext(conn);
    runner.setContext(ctx);

    runner.register(function getConv(ctx: any, args: any) {
      return ctx.conversationId;
    });

    const res = await runner.execute("getConv", {});
    expect(res).toBe("test-conv");
  });

  test("inject context as second parameter", async () => {
    const runner = new ToolRunner();
    const conn = new MockConnection();
    const ctx = new ToolContext(conn);
    runner.setContext(ctx);

    runner.register(function greet(args: { name: string }, context: any) {
      return `Hello ${args.name} in ${context.conversationId}`;
    });

    const res = await runner.execute("greet", { name: "Alice" });
    expect(res).toBe("Hello Alice in test-conv");
  });

  test("inject context as destructured object field", async () => {
    const runner = new ToolRunner();
    const conn = new MockConnection();
    const ctx = new ToolContext(conn);
    runner.setContext(ctx);

    // We must define function with destructured param in first position
    const testDestruct = function ({ ctx, val }: { ctx?: any; val: number }) {
      return (ctx?.conversationId || "") + ":" + val;
    };

    runner.register(testDestruct, "testDestruct");

    const res = await runner.execute("testDestruct", { val: 42 });
    expect(res).toBe("test-conv:42");
  });

  test("execute tool yielding Effect-TS", async () => {
    const runner = new ToolRunner();
    runner.register(function effTool() {
      return Effect.succeed("effect-value");
    });

    const res = await runner.execute("effTool", {});
    expect(res).toBe("effect-value");
  });

  test("process multiple tool calls", async () => {
    const runner = new ToolRunner();
    runner.register(function double({ x }: { x: number }) {
      return x * 2;
    });

    const calls = [
      { id: "c1", name: "double", args: { x: 5 } },
      { id: "c2", name: "double", args: { x: 10 } },
      { id: "c3", name: "unknown_tool", args: {} }
    ];

    const results = await Effect.runPromise(runner.processToolCalls(calls));
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ id: "c1", name: "double", result: 10 });
    expect(results[1]).toEqual({ id: "c2", name: "double", result: 20 });
    expect(results[2].error).toBeDefined();
  });
});
