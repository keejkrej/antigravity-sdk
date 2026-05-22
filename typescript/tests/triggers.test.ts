import { expect, test, describe } from "bun:test";
import { TriggerRunner } from "../src/triggers/trigger_runner.ts";
import { every, onFileChange } from "../src/triggers/helpers.ts";
import { TriggerContext } from "../src/triggers/triggers.ts";
import { Connection } from "../src/connection.ts";
import { Effect } from "effect";
import * as fs from "node:fs";
import * as path from "node:path";

class MockConnection implements Connection {
  public triggerNotifications: string[] = [];

  isIdle() { return true; }
  conversationId() { return "test-conv"; }
  send() { return Effect.void; }
  receiveSteps(): any { return null; }
  sendToolResults() { return Effect.void; }
  sendQuestionResponse() { return Effect.void; }
  sendToolConfirmation() { return Effect.void; }
  sendTriggerNotification(content: string) {
    this.triggerNotifications.push(content);
    return Effect.void;
  }
  cancel() { return Effect.void; }
  disconnect() { return Effect.void; }
  delete() { return Effect.void; }
  signalIdle() { return Effect.void; }
  waitForIdle() { return Effect.void; }
  waitForWakeup(timeoutMs: number) { return Effect.succeed(true); }
}

describe("Triggers", () => {
  test("every helper trigger fires and cancels cleanly", async () => {
    const conn = new MockConnection();
    let firedCount = 0;
    const trig = every(0.01, (ctx) => {
      firedCount++;
      return ctx.send(`fired_${firedCount}`);
    });

    const runner = new TriggerRunner([trig], conn);
    expect(runner.isRunning).toBe(false);

    // Start
    await Effect.runPromise(runner.start());
    expect(runner.isRunning).toBe(true);

    // Wait for at least two fires
    await new Promise(resolve => setTimeout(resolve, 50));

    // Stop
    await Effect.runPromise(runner.stop());
    expect(runner.isRunning).toBe(false);

    const countAfterStop = firedCount;
    expect(countAfterStop).toBeGreaterThanOrEqual(1);

    // Wait and ensure it doesn't fire anymore
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(firedCount).toBe(countAfterStop);
    expect(conn.triggerNotifications).toContain("fired_1");
  });

  test("onFileChange helper watcher fires and closes cleanly", async () => {
    const conn = new MockConnection();
    const tempDir = path.join(__dirname, "../test_watch_" + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });
    const tempFile = path.join(tempDir, "file.txt");
    fs.writeFileSync(tempFile, "initial");

    let changed = false;
    const trig = onFileChange(tempFile, (ctx, changes) => {
      changed = true;
    });

    const runner = new TriggerRunner([trig], conn);
    await Effect.runPromise(runner.start());

    // Modify the file
    fs.writeFileSync(tempFile, "changed");

    // Wait for watcher to trigger
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(changed).toBe(true);

    // Stop
    await Effect.runPromise(runner.stop());

    // Cleanup temp
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
