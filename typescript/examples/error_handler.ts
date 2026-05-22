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
 * Example of handling errors in Google Antigravity SDK.
 *
 * This example demonstrates:
 * 1. Using the `on_tool_error` hook to intercept tool errors and
 *    provide custom guidance to the model.
 * 2. Catching SDK exceptions in application code using standard try...catch
 *    blocks.
 *
 * To run:
 *   bun typescript/examples/error_handler.ts
 *
 * Criteria for correct script performance:
 *   1. The script exits cleanly with return code 0 (no unhandled exceptions).
 *   2. The agent calls the exploding_tool, which raises an Error.
 *   3. The on_tool_error hook intercepts the error and provides guidance.
 *   4. The agent recovers and produces a response after the error.
 */

import { Agent, on_tool_error, policy } from "../src/index.js";

// Define a tool that always fails.
// This simplifies the example by guaranteeing an error occurs when called.
const exploding_tool = {
  name: "exploding_tool",
  description: "A tool that always fails, regardless of input.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      input_data: { type: "string", description: "Any string input." },
    },
    required: ["input_data"],
  },
  run: ({ input_data }: { input_data: string }) => {
    console.log(`\n  🔧 [Tool] Exploding tool called with: ${input_data}, exploding...`);
    throw new Error("This tool is intentionally broken and always fails.");
  },
};

// 2. Define the error handler hook.
const tool_error_handler = on_tool_error((err: Error) => {
  console.log(`\n  🔧 [ErrorHandler] Caught exception: ${err.message || err}`);

  if (err.message && err.message.includes("intentionally broken")) {
    // Return a message that the model will see instead of the raw error.
    // This guides the model on how to respond or recover.
    return `[Tool Error: ${err.message} Please inform the user that the operation failed.]`;
  }

  // Return null to let the default error handling take over for other errors.
  return null;
});

async function main() {
  console.log("  🔌 Error Handling Example\n");

  // Create the agent configuration with the tool and hook.
  const agent = new Agent({
    tools: [exploding_tool],
    hooks: [tool_error_handler],
    policies: [policy.allow_all()],
  });

  console.log("Starting agent...");
  await agent.start();

  // Ask the agent to use the tool that we know will fail.
  const prompt = "Use the exploding_tool with input 'test data'.";
  console.log(`  User: ${prompt}`);

  // Catch SDK exceptions in application code.
  try {
    const response = await agent.chat(prompt);
    const responseText = await response.text();
    console.log(`  Agent: ${responseText}`);
  } catch (err: any) {
    // Catch-all for unexpected errors.
    console.log(`\n  [App Error] Unexpected error: ${err.message || err}`);
  }

  console.log("Stopping agent...");
  await agent.stop();
}

main().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});
