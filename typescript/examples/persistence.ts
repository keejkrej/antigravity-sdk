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
 * Example demonstrating stateful session resumption in Google Antigravity SDK.
 *
 * This example shows how to persist conversation state across process restarts
 * using a conversation ID and a storage directory.
 *
 * Demonstrates:
 * 1. Running two independent agent sessions sharing the same `saveDir`.
 * 2. Session 1 establishing context ("my favorite color is blue"), retrieving
 *    its assigned `conversationId`, and shutting down.
 * 3. Session 2 resuming by providing the saved `conversationId` and verifying
 *    recall, confirming that the prior trajectory was restored.
 *
 * To run:
 *   bun typescript/examples/persistence.ts
 *
 * Criteria for correct script performance:
 *   1. The script exits cleanly with return code 0 (no unhandled exceptions).
 *   2. Session 1 establishes context and retrieves a conversationId.
 *   3. Session 2 resumes using the saved conversationId and saveDir.
 *   4. The agent in session 2 recalls information from session 1.
 */

import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { Agent, policy } from "../src/index.js";

async function main() {
  const saveDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent_session_"));
  console.log(`  Save directory: ${saveDir}`);

  console.log("\n  === Session 1: establishing context ===");

  // Specify `saveDir` to ensure conversation history and artifacts are
  // persisted to disk.
  const agent1 = new Agent({
    saveDir: saveDir,
    policies: [policy.allow_all()],
  });

  await agent1.start();

  const prompt1 = "Remember this: my favorite color is blue.";
  console.log(`  User: ${prompt1}`);
  const response1 = await agent1.chat(prompt1);
  console.log(`  Agent: ${await response1.text()}`);

  // Read back the conversationId assigned by the runtime.
  const conversationId = agent1.conversationId;
  console.log(`  Assigned conversation ID: ${conversationId}`);

  await agent1.stop();
  console.log("  Session 1 ended.\n");

  console.log("  === Session 2: resuming and verifying recall ===");

  // By providing the exact same `saveDir` and the prior `conversationId`,
  // the new agent instance automatically restores the previous conversation
  // history and context.
  const agent2 = new Agent({
    conversationId: conversationId,
    saveDir: saveDir,
    policies: [policy.allow_all()],
  });

  await agent2.start();

  const prompt2 = "What is my favorite color?";
  console.log(`  User: ${prompt2}`);
  const response2 = await agent2.chat(prompt2);
  console.log(`  Agent: ${await response2.text()}`);

  await agent2.stop();
  console.log("  Session 2 ended.");
}

main().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});
