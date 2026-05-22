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
 * Example demonstrating tool call policies in Google Antigravity SDK.
 *
 * This example shows how to secure an agent using declarative tool call policies.
 * Policies operate at the runtime decision layer: tools remain visible in the
 * agent's context, but calls that violate policies are denied with an explanation,
 * allowing the agent to understand why access was blocked and adapt its approach.
 *
 * Demonstrates:
 * 1. The recommended "Deny by Default" posture: blocking all tools by default,
 *    and explicitly allowing only what is necessary.
 * 2. Specific Denylist rules (e.g., blocking dangerous shell commands like `rm`).
 * 3. Specific Allowlist rules (e.g., allowing only specific safe commands).
 * 4. Interactive confirmation rules using `policy.ask_user()`.
 *
 * To run:
 *   bun typescript/examples/policies.ts
 *
 * Criteria for correct script performance:
 *   1. The script exits cleanly with return code 0 (no unhandled exceptions).
 *   2. The listing files prompt succeeds because list_directory is allowed.
 *   3. The rm -rf prompt is denied by the dangerous command policy.
 *   4. The production.key prompt triggers the ask_user policy and is denied.
 */

import { Agent, policy, BuiltinTools, ToolCall } from "../src/index.js";

function _block_rm_predicate(args: any): boolean {
  const cmd = args.command_line || args.commandLine || args.cmd || "";
  return cmd.includes("rm");
}

function _critical_file_predicate(args: any): boolean {
  const filePath = args.path || args.file_path || args.TargetFile || "";
  return filePath.endsWith(".key") || filePath.includes("production");
}

function programmaticApprovalHandler(toolCall: ToolCall): boolean {
  console.log(`\n  [ASK_USER Handler] Intercepted request for tool: ${toolCall.name}`);
  console.log(`  [ASK_USER Handler] Target arguments:`, toolCall.args);
  console.log("  [ASK_USER Handler] Simulating user review... Decision: DENY.");
  return false;
}

async function main() {
  console.log("  === Tool Call Policies Demo ===");

  // Configure policies using the recommended "Deny by Default" posture.
  // Priority order: Specific Deny > Specific Ask > Specific Allow > Wildcard Deny.
  const policies = [
    // 1. Deny everything by default
    policy.deny_all(),
    // 2. Allow reading directory contents
    policy.allow(BuiltinTools.LIST_DIR),
    // 3. Allow running commands, but block dangerous 'rm' commands
    policy.allow(BuiltinTools.RUN_COMMAND),
    policy.deny(
      BuiltinTools.RUN_COMMAND,
      _block_rm_predicate,
      "block-rm"
    ),
    // 4. Allow editing/creating files, but ask the user first if it's a critical file.
    policy.allow(BuiltinTools.EDIT_FILE),
    policy.allow(BuiltinTools.CREATE_FILE),
    policy.ask_user(
      BuiltinTools.EDIT_FILE,
      programmaticApprovalHandler,
      _critical_file_predicate,
      "ask-for-critical-edits"
    ),
    policy.ask_user(
      BuiltinTools.CREATE_FILE,
      programmaticApprovalHandler,
      _critical_file_predicate,
      "ask-for-critical-creates"
    ),
  ];

  const agent = new Agent({
    policies,
    geminiConfig: {
      modelName: "gemini-3.5-flash",
    },
  });

  console.log("Starting agent...");
  await agent.start();

  console.log("\n  Chatting with agent...");

  // Try a safe command (should be allowed)
  const prompt1 = "List the files in the current directory.";
  console.log(`\n  User: ${prompt1}`);
  const response1 = await agent.chat(prompt1);
  console.log(`  Agent: ${await response1.text()}`);

  // Try a dangerous command (should be denied by policy)
  const prompt2 = "Delete all files using rm -rf.";
  console.log(`\n  User: ${prompt2}`);
  const response2 = await agent.chat(prompt2);
  console.log(`  Agent: ${await response2.text()}`);

  // Try creating a critical file (triggers programmatic ask_user handler)
  const prompt3 = "Create a new configuration file named production.key with content 'debug=true'.";
  console.log(`\n  User: ${prompt3}`);
  const response3 = await agent.chat(prompt3);
  console.log(`  Agent: ${await response3.text()}`);

  console.log("Stopping agent...");
  await agent.stop();
}

main().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});
