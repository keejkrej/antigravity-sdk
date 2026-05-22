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
 * Example demonstrating skill loading for Google Antigravity SDK.
 *
 * This example demonstrates how to use `skillsPaths` in agent configuration
 * to point to a directory containing skills and how the agent can recognize them.
 *
 * To run:
 *   bun typescript/examples/agent_skills.ts
 *
 * Criteria for correct script performance:
 *   1. The script exits cleanly with return code 0 (no unhandled exceptions).
 *   2. "Loading skills from:" appears in the output, confirming the skill path
 *      was resolved.
 *   3. The agent produces a non-empty response when asked about its skills.
 *   4. The agent's response references at least one skill or capability by name.
 */

import * as path from "node:path";
import { Agent, policy } from "../src/index.js";

async function main() {
  // Let's get a little meta: We are loading the real 'google-antigravity-sdk' skill
  // that teaches this agent how to build with the very SDK it is running on! 🧠
  const scriptDir = import.meta.dirname;
  const skillPath = path.resolve(scriptDir, "../../skills/google-antigravity-sdk");

  console.log(`  Loading skills from: ${skillPath}`);

  // Configure the agent with the skills path and safety policies.
  const agent = new Agent({
    skillsPaths: [skillPath],
    policies: [policy.allow_all()],
  });

  console.log("Starting agent...");
  await agent.start();

  // Ask the agent what skills it has.
  const prompt = "What available skills do you have?";
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
