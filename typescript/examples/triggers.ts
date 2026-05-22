// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * Example demonstrating background triggers in Google Antigravity SDK.
 *
 * Triggers are long-lived async functions that run in the background alongside
 * an active agent session. They react to external events (such as timers, file
 * changes, or webhooks) and push automated trigger notifications back to the
 * agent connection.
 *
 * This example demonstrates:
 * 1. Periodic Triggers (using the `every` helper) - Simulating SRE Ticket Queues.
 * 2. Custom Triggers (using the `trigger` helper) - Simulating CI/CD Webhook listeners.
 *
 * To run:
 *   bun typescript/examples/triggers.ts
 *
 * Criteria for correct script performance:
 *   1. The script exits cleanly with return code 0 (no unhandled exceptions).
 *   2. The periodic trigger fires and sends a system alert to the agent.
 *   3. The custom CI/CD trigger fires and sends a build failure alert.
 *   4. The agent acknowledges the trigger notifications in its responses.
 */

import { Effect } from "effect";
import { Agent, every, trigger, TriggerContext, policy } from "../src/index.js";

// ==============================================================================
// 1. PERIODIC TRIGGER EXAMPLE: Customer Support Ticket Queue
// ==============================================================================

// Stateful checks to simulate background ticket arrivals.
let ticketCounter = 0;
let standbyActive = false;

// Define a callback function for the periodic trigger.
async function pollQueueCallback(ctx: TriggerContext): Promise<void> {
  // Avoid polling before Turn 1 completes to prevent latency race conditions.
  if (!standbyActive) {
    return;
  }

  ticketCounter++;

  // On the second tick after standby starts (2 seconds in), simulate arrival.
  if (ticketCounter === 2) {
    console.log("\n  [TRIGGER EVENT] Alert! New ticket detected in the queue...");

    // ctx.send pushes an automated trigger notification into the connection.
    // The agent's model will see this message in its conversation history.
    await Effect.runPromise(
      ctx.send(
        "[SYSTEM ALERT] New critical ticket assigned: b/98765. Title: " +
        "Database Connection Leak in Prod."
      )
    );
  }
}

async function runPeriodicTriggerExample() {
  console.log("  === Support Queue Trigger Demo ===");
  console.log("  Creating agent and starting session...");

  ticketCounter = 0;
  standbyActive = false;

  // Configure a trigger that checks every 1 second for demonstration.
  const myTrigger = every(1, pollQueueCallback);

  const agent = new Agent({
    systemInstructions:
      "You are a system operations and support assistant. You monitor a " +
      "queue of incoming support tickets. When the user asks for updates, " +
      "you must check and report any tickets that came in from the " +
      "background system alert trigger.",
    triggers: [myTrigger],
    policies: [policy.allow_all()],
  });

  // Triggers are active only while inside the active session block.
  await agent.start();

  // Turn 1: Instruct the agent to watch.
  const prompt1 =
    "Your task will be to standby and simply let me know if there are any " +
    "critical tickets received.";
  console.log(`\n  User: ${prompt1}`);
  const response1 = await agent.chat(prompt1);
  console.log(`  Agent: ${await response1.text()}`);

  // Turn 1 is resolved. We now enable the standby trigger.
  standbyActive = true;

  // Sleep to let the background task execute.
  console.log("\n  Sleeping for 5 seconds. A new ticket will be simulated in the background...");
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Turn 2: Ask for updates.
  const prompt2 = "I'm back. Did anything critical come in while I was working?";
  console.log(`\n  User: ${prompt2}`);
  const response2 = await agent.chat(prompt2);
  console.log(`  Agent: ${await response2.text()}`);

  console.log("\n  Ending session. Background triggers will stop automatically.");
  await agent.stop();
}

// ==============================================================================
// 2. CUSTOM TRIGGER EXAMPLE: CI/CD Webhook Alert Listener
// ==============================================================================

// Stateful checks to simulate background webhook notifications.
let webhookActive = false;

// A custom trigger is any async function wrapped with trigger()
// that accepts a single TriggerContext argument.
const webhookListener = trigger(async (ctx: TriggerContext) => {
  console.log("\n  [WEBHOOK TRIGGER] Custom Webhook listener started...");

  // The developer is responsible for their own loop and interval/compaction logic.
  let tick = 0;
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Poll simulated webhook port every 1s

    // Avoid processing before Turn 1 resolves.
    if (!webhookActive) {
      continue;
    }

    tick++;
    // On the third tick inside standby, push a simulated build failure alert.
    if (tick === 3) {
      console.log("\n  [TRIGGER EVENT] Custom Webhook event received: 'AppBuild-42' status FAILED.");
      await Effect.runPromise(
        ctx.send(
          "[WEBHOOK ALERT] CI/CD Build Pipeline 'AppBuild-42' FAILED on " +
          "branch 'main'. Reason: Lint errors in routes.py."
        )
      );
    }
  }
});

async function runCustomTriggerExample() {
  console.log("  === Custom Webhook Trigger Demo ===");
  console.log("  Creating agent and starting session...");

  webhookActive = false;

  const agent = new Agent({
    systemInstructions:
      "You are a CI/CD operations assistant. You monitor pipeline status " +
      "via an external webhook trigger. When the user asks for updates, " +
      "you must check and report any failures that came in from the " +
      "webhook alert trigger.",
    triggers: [webhookListener],
    policies: [policy.allow_all()],
  });

  await agent.start();

  // Turn 1: Set standby monitoring.
  const prompt1 =
    "Your task will be to standby and simply let me know if there are any " +
    "critical pipeline webhook alerts received.";
  console.log(`\n  User: ${prompt1}`);
  const response1 = await agent.chat(prompt1);
  console.log(`  Agent: ${await response1.text()}`);

  // Turn 1 is resolved. We now enable the webhook trigger.
  webhookActive = true;

  console.log("\n  Sleeping for 5 seconds. A pipeline failure will be simulated in the background...");
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Turn 2: Ask for updates.
  const prompt2 = "I'm back. Any updates on my builds?";
  console.log(`\n  User: ${prompt2}`);
  const response2 = await agent.chat(prompt2);
  console.log(`  Agent: ${await response2.text()}`);

  console.log("\n  Ending session. Background triggers will stop automatically.");
  await agent.stop();
}

// ==============================================================================
// 3. MAIN EXECUTION ENTRYPOINT
// ==============================================================================

async function main() {
  await runPeriodicTriggerExample();
  console.log("\n" + "=".repeat(60) + "\n");
  await runCustomTriggerExample();
}

main().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});
