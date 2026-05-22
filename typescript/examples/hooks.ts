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
 * Example demonstrating all supported lifecycle hooks in Google Antigravity SDK.
 *
 * This example shows how to use helper functions to register hooks for various
 * lifecycle events, including session, turn, tool, interaction, and compaction.
 *
 * To run:
 *   bun typescript/examples/hooks.ts
 *
 * Criteria for correct script performance:
 *   1. The script exits cleanly with return code 0 (no unhandled exceptions).
 *   2. Session lifecycle hooks (on_session_start, on_session_end) fire during
 *      the agent session.
 *   3. Turn hooks (pre_turn, post_turn) fire around agent chat calls.
 *   4. Tool hooks (pre_tool_call_decide, post_tool_call) fire when the agent
 *      uses the greet tool.
 *   5. The on_tool_error hook fires when the agent calls the broken_tool.
 */

import {
  Agent,
  policy,
  pre_turn,
  post_turn,
  pre_tool_call_decide,
  post_tool_call,
  on_tool_error,
  on_interaction,
  on_compaction,
  on_session_start,
  on_session_end,
} from "../src/index.js";

// -----------------------------------------------------------------------------
// Session Hooks
// -----------------------------------------------------------------------------

const onStart = on_session_start(() => {
  console.log("\n  [Hook] Session started");
});

const onEnd = on_session_end(() => {
  console.log("\n  [Hook] Session ended");
});

// -----------------------------------------------------------------------------
// Turn Hooks
// -----------------------------------------------------------------------------

const preTurn = pre_turn((data) => {
  const text = typeof data === "string" ? data : JSON.stringify(data);
  console.log(`\n  [Hook] Pre-turn: Intercepted prompt -> ${JSON.stringify(text)}`);
  return { allow: true };
});

const postTurn = post_turn((data) => {
  console.log(`\n  [Hook] Post-turn: Final response -> ${JSON.stringify(data)}`);
});

// -----------------------------------------------------------------------------
// Tool Hooks
// -----------------------------------------------------------------------------

const preTool = pre_tool_call_decide((data) => {
  console.log(`\n  [Hook] Pre-tool-call: Approving tool -> ${data.name}`);
  return { allow: true };
});

const postTool = post_tool_call((data) => {
  console.log(`\n  [Hook] Post-tool-call: Result -> ${JSON.stringify(data)}`);
});

const onError = on_tool_error((err: Error) => {
  console.log(`\n  [Hook] Tool error: ${err.message || err}`);
  return null; // Let the error propagate
});

// -----------------------------------------------------------------------------
// Interaction & Compaction Hooks
// -----------------------------------------------------------------------------

const onInteract = on_interaction((data) => {
  console.log(`\n  [Hook] Interaction requested: ${JSON.stringify(data.questions)}`);
  
  // Auto-select the first option if available, or provide a default answer.
  const responses = data.questions.map((q) => {
    if (q.options && q.options.length > 0) {
      return { selectedOptionIds: [q.options[0].id] };
    }
    return { freeformResponse: "Auto-response" };
  });

  return { responses };
});

const onCompact = on_compaction((data) => {
  console.log(`\n  [Hook] Context compaction occurred at step: ${JSON.stringify(data)}`);
});

// -----------------------------------------------------------------------------
// Helper Tools
// -----------------------------------------------------------------------------

const greet = {
  name: "greet",
  description: "Greets a person by name.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "The name of the person." },
    },
    required: ["name"],
  },
  run: ({ name }: { name: string }) => {
    return `Hello, ${name}!`;
  },
};

const broken_tool = {
  name: "broken_tool",
  description: "Fails always with a RuntimeError.",
  parametersJsonSchema: {
    type: "object",
    properties: {},
  },
  run: () => {
    throw new Error("This tool is intentionally broken!");
  },
};

// -----------------------------------------------------------------------------
// Main Execution
// -----------------------------------------------------------------------------

async function main() {
  const agent = new Agent({
    hooks: [
      onStart,
      onEnd,
      preTurn,
      postTurn,
      preTool,
      postTool,
      onError,
      onInteract,
      onCompact,
    ],
    tools: [greet, broken_tool],
    policies: [policy.allow_all()],
  });

  console.log("Starting agent session...");
  await agent.start();

  console.log("  --- Starting Interaction ---");

  // 1. Trigger Turn Hooks
  console.log("\n  --- Prompt 1: Simple Chat ---");
  let response = await agent.chat("Say 'Hello World!'");
  process.stdout.write("  Agent Response: ");
  for await (const chunk of response) {
    process.stdout.write(chunk);
  }
  console.log();

  // 2. Trigger Tool Hooks
  console.log("\n  --- Prompt 2: Tool Usage ---");
  response = await agent.chat("Please greet Alice using the greet tool.");
  process.stdout.write("  Agent Response: ");
  for await (const chunk of response) {
    process.stdout.write(chunk);
  }
  console.log();

  // 3. Trigger Tool Error Hook
  console.log("\n  --- Prompt 3: Tool Error ---");
  response = await agent.chat("Please call the broken_tool tool.");
  process.stdout.write("  Agent Response: ");
  for await (const chunk of response) {
    process.stdout.write(chunk);
  }
  console.log();

  // 4. Trigger Interaction Hook (Simulated by asking a question)
  console.log("\n  --- Prompt 4: Interaction ---");
  response = await agent.chat("Ask me a multiple-choice trivia question.");
  process.stdout.write("  Agent Response: ");
  for await (const chunk of response) {
    process.stdout.write(chunk);
  }
  console.log();

  console.log("\n  --- Finished Interaction ---");

  console.log("Stopping agent session...");
  await agent.stop();
}

main().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});
