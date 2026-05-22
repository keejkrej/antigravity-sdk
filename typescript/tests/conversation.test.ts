import { expect, test, describe } from "bun:test";
import { Conversation, ChatResponse } from "../src/conversation/conversation.ts";
import { Connection } from "../src/connection.ts";
import { Effect, Stream } from "effect";
import * as Types from "../src/types.ts";

class MockConnection implements Connection {
  public messagesSent: (Types.Content | null)[] = [];
  public stepsToEmit: Types.Step[] = [];

  isIdle() { return true; }
  conversationId() { return "test-conv"; }
  send(prompt: Types.Content | null) {
    this.messagesSent.push(prompt);
    return Effect.void;
  }
  receiveSteps() {
    return Stream.fromIterable(this.stepsToEmit);
  }
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

describe("Conversation and ChatResponse", () => {
  test("Conversation tracks history and enforces maxHistorySize", async () => {
    const conn = new MockConnection();
    const conv = new Conversation(conn, { maxHistorySize: 3 });

    const step1: Types.Step = {
      stepIndex: 1,
      type: Types.StepType.MODEL_TURN,
      source: Types.StepSource.MODEL,
      target: Types.StepTarget.USER,
      content: "one",
      isCompleteResponse: true
    };
    const step2: Types.Step = {
      stepIndex: 2,
      type: Types.StepType.MODEL_TURN,
      source: Types.StepSource.MODEL,
      target: Types.StepTarget.USER,
      content: "two",
      isCompleteResponse: true
    };
    const step3: Types.Step = {
      stepIndex: 3,
      type: Types.StepType.MODEL_TURN,
      source: Types.StepSource.MODEL,
      target: Types.StepTarget.USER,
      content: "three",
      isCompleteResponse: true
    };
    const step4: Types.Step = {
      stepIndex: 4,
      type: Types.StepType.MODEL_TURN,
      source: Types.StepSource.MODEL,
      target: Types.StepTarget.USER,
      content: "four",
      isCompleteResponse: true
    };

    conn.stepsToEmit = [step1, step2, step3, step4];

    // Read steps through stream
    const stepsReceived = await Effect.runPromise(Stream.runCollect(conv.receiveSteps()));
    expect(stepsReceived.length).toBe(4);

    // History size should be capped at 3
    expect(conv.history.length).toBe(3);
    expect(conv.history[0].content).toBe("two");
    expect(conv.history[1].content).toBe("three");
    expect(conv.history[2].content).toBe("four");
  });

  test("Conversation aggregates usage metadata", async () => {
    const conn = new MockConnection();
    const conv = new Conversation(conn);

    const step1: Types.Step = {
      stepIndex: 1,
      type: Types.StepType.MODEL_TURN,
      source: Types.StepSource.MODEL,
      target: Types.StepTarget.USER,
      content: "one",
      usageMetadata: { promptTokenCount: 10, totalTokenCount: 15 }
    };
    const step2: Types.Step = {
      stepIndex: 2,
      type: Types.StepType.MODEL_TURN,
      source: Types.StepSource.MODEL,
      target: Types.StepTarget.USER,
      content: "two",
      usageMetadata: { promptTokenCount: 5, totalTokenCount: 8 }
    };

    conn.stepsToEmit = [step1, step2];
    await Effect.runPromise(Stream.runCollect(conv.receiveSteps()));

    expect(conv.totalUsage.promptTokenCount).toBe(15);
    expect(conv.totalUsage.totalTokenCount).toBe(23);
  });

  test("ChatResponse supports multiple concurrent/independent stream cursors", async () => {
    const conn = new MockConnection();
    const conv = new Conversation(conn);

    conn.stepsToEmit = [
      {
        stepIndex: 1,
        type: Types.StepType.MODEL_TURN,
        source: Types.StepSource.MODEL,
        target: Types.StepTarget.USER,
        thinkingDelta: "Thinking...",
        contentDelta: "Hello ",
        isCompleteResponse: false
      },
      {
        stepIndex: 2,
        type: Types.StepType.MODEL_TURN,
        source: Types.StepSource.MODEL,
        target: Types.StepTarget.USER,
        contentDelta: "world!",
        isCompleteResponse: true,
        toolCalls: [{ id: "t1", name: "my_tool", args: {} }]
      }
    ];

    const response = await conv.chat("start prompt");
    expect(conn.messagesSent).toEqual(["start prompt"]);

    // Test text iterator
    const textChunks: string[] = [];
    for await (const chunk of response) {
      textChunks.push(chunk);
    }
    expect(textChunks.join("")).toBe("Hello world!");

    // Test thoughts iterator (independently, it should replay from buffer)
    const thoughts: string[] = [];
    for await (const thought of response.thoughts) {
      thoughts.push(thought);
    }
    expect(thoughts).toEqual(["Thinking..."]);

    // Test tool calls iterator
    const toolCalls: Types.ToolCall[] = [];
    for await (const tc of response.toolCalls) {
      toolCalls.push(tc);
    }
    expect(toolCalls).toEqual([{ id: "t1", name: "my_tool", args: {} }]);

    // Test full text resolver
    const fullText = await response.text();
    expect(fullText).toBe("Hello world!");
  });
});
