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
 * Simple hello world example for Google Antigravity SDK.
 *
 * This example demonstrates the simplest way to interact with an agent:
 * - Creating an agent with configuration (explicitly selecting a model).
 * - Initializing the agent session with .start().
 * - Sending a simple prompt and awaiting the full text response.
 * - Stopping the agent session with .stop().
 *
 * To run:
 *   bun typescript/examples/hello_world.ts
 *
 * Criteria for correct script performance:
 *   1. The script exits cleanly with return code 0 (no unhandled exceptions).
 *   2. The agent produces a non-empty text response.
 *   3. The response contains "Hello World" or a close greeting variant.
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

  const prompt = "Say 'Hello World!'";
  console.log(`  User: ${prompt}`);

  const response = await agent.chat(prompt);

  // Await the full aggregated text response.
  const responseText = await response.text();
  console.log(`  Agent: ${responseText}`);

  console.log("Stopping agent...");
  await agent.stop();
}

main().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});
