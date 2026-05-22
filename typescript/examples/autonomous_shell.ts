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
 * Example demonstrating how to enable autonomous shell access.
 *
 * By default, Agent configuration uses policy.confirm_run_command() which
 * denies run_command or asks for interactive confirmation. For agents that need shell access —
 * such as coding assistants or system automation tools — you can opt in by passing
 * policies: [policy.allow_all()].
 *
 * Warning:
 *   allow_all() grants the agent unrestricted tool access, including
 *   arbitrary shell command execution. Only use this in trusted environments.
 *
 * To run:
 *   bun typescript/examples/autonomous_shell.ts
 *
 * Criteria for correct script performance:
 *   1. The script exits cleanly with return code 0 (no unhandled exceptions).
 *   2. The agent produces a non-empty text response.
 *   3. The response contains the output of the shell command.
 */

import { Agent, policy } from "../src/index.js";

async function main() {
  // allow_all() grants the agent full access to all tools, including
  // run_command (shell execution). This overrides the default
  // confirm_run_command() policy.
  const agent = new Agent({
    policies: [policy.allow_all()],
  });

  console.log("Starting agent...");
  await agent.start();

  const prompt = "Run 'echo Hello from the shell!' and show me the output.";
  console.log(`  User: ${prompt}`);

  const response = await agent.chat(prompt);
  const responseText = await response.text();
  console.log(`  Agent: ${responseText}`);

  console.log("Stopping agent...");
  await agent.stop();
}

main().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});
