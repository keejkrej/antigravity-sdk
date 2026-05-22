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
 * Example demonstrating streaming responses and thoughts in Google Antigravity SDK.
 *
 * To run:
 *   bun typescript/examples/streaming.ts
 *
 * Criteria for correct script performance:
 *   1. The script exits cleanly with return code 0 (no unhandled exceptions).
 *   2. The agent produces non-empty streamed thought/reasoning content.
 *   3. The agent produces a non-empty streamed final answer.
 *   4. The response correctly identifies the answer to the riddle (an echo).
 */

import { Agent, policy } from "../src/index.js";

async function main() {
  const agent = new Agent({
    policies: [policy.allow_all()],
    geminiConfig: {
      modelName: "gemini-3.5-flash",
    },
  });

  console.log("Starting agent...");
  await agent.start();

  const prompt =
    "Solve this riddle: I speak without a mouth and hear without ears. I " +
    "have no body, but I come alive with wind. What am I? Explain your " +
    "reasoning.";
  console.log(`  User: ${prompt}\n`);

  const response = await agent.chat(prompt);

  console.log("  Agent (Streaming thoughts):");
  console.log("  -------------------------------------------------------");
  for await (const thought of response.thoughts) {
    process.stdout.write(thought);
  }
  console.log("\n  -------------------------------------------------------\n");

  console.log("  Agent (Streaming final answer):");
  console.log("  -------------------------------------------------------");
  for await (const token of response) {
    process.stdout.write(token);
  }
  console.log("\n  -------------------------------------------------------\n");

  console.log("Stopping agent...");
  await agent.stop();
}

main().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});
