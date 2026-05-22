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
 * Example demonstrating subagents in Google Antigravity SDK.
 *
 * This example shows how an agent can spawn a subagent to delegate a specific
 * task, in this case, researching the examples directory to generate a lesson
 * plan.
 *
 * Subagents are valuable for scoping context usage. By delegating a heavy research
 * task to a subagent, the main agent avoids filling its own context window with
 * all the raw documents, receiving only the synthesized result.
 *
 * To run:
 *   bun typescript/examples/subagents.ts
 *
 * Criteria for correct script performance:
 *   1. The script exits cleanly with return code 0 (no unhandled exceptions).
 *   2. The agent spawns a subagent to research the examples directory.
 *   3. The subagent hook logs fire when the subagent is created and completes.
 *   4. The agent produces a non-empty lesson plan based on the subagent's findings.
 */

import { Agent, BuiltinTools, policy, pre_tool_call_decide, post_tool_call } from "../src/index.js";

let subagentActive = false;

const logPreTool = pre_tool_call_decide((data) => {
  if (data.name === BuiltinTools.START_SUBAGENT) {
    subagentActive = true;
    console.log("\n  --- 🤖 [Hook] Spawning Subagent ---");
    console.log(`  Arguments: ${JSON.stringify(data.args || data.argumentsJson)}\n`);
  } else {
    const indent = subagentActive ? "    " : "  ";
    console.log(`${indent}- [Start]: ${data.name} (ID: ${data.id})`);
  }
  return { allow: true };
});

const logPostTool = post_tool_call((data) => {
  if (data.name === BuiltinTools.START_SUBAGENT) {
    subagentActive = false;
    console.log("\n  --- 🤖 [Hook] Subagent Finished ---");
    console.log(`  Result: ${JSON.stringify(data.result)}\n`);
  } else {
    const indent = subagentActive ? "    " : "  ";
    console.log(`${indent}- [Done]: ${data.name} (ID: ${data.id}) ✅`);
  }
});

async function main() {
  // Enable subagents in the capabilities, define allow_all security policy, and add lifecycle hooks
  const agent = new Agent({
    capabilities: {
      enableSubagents: true,
    },
    policies: [policy.allow_all()],
    hooks: [logPreTool, logPostTool],
    geminiConfig: {
      modelName: "gemini-3.5-flash",
    },
  });

  console.log("Starting agent...");
  await agent.start();

  // Prompt the agent to use a subagent to research and generate a lesson plan.
  const prompt =
    "Use a subagent to research the Google Antigravity SDK examples in the " +
    "parent directory. Delegate the task of listing and reading the files to the " +
    "subagent, and then generate a lesson plan for me to learn more based " +
    "on its findings.";
  console.log(`  User: ${prompt}`);

  const response = await agent.chat(prompt);

  // Await the full aggregated text response. This includes both the
  // subagent's output and the main agent's regular response text.
  const responseText = await response.text();
  console.log(`\n  Agent:\n${responseText}`);

  console.log("Stopping agent...");
  await agent.stop();
}

main().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});
