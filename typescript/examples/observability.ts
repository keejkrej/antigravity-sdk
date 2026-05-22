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
 * Example demonstrating observability features in Google Antigravity SDK.
 *
 * This example shows how to:
 * - Use hooks to create a basic audit log of tool calls.
 * - Access token usage metadata, including thinking tokens.
 *
 * To run:
 *   bun typescript/examples/observability.ts
 *
 * Criteria for correct script performance:
 *   1. The script exits cleanly with return code 0 (no unhandled exceptions).
 *   2. The agent calls the get_weather tool and returns weather information.
 *   3. The audit log hook fires and logs the tool call.
 *   4. Token usage metadata is printed, showing prompt, output, thinking, and total
 *      token counts.
 */

import { Agent, post_tool_call, policy } from "../src/index.js";

// A simple tool to demonstrate tool call hooks
const get_weather = {
  name: "get_weather",
  description: "Gets the weather for a location.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      location: { type: "string", description: "The city and state, e.g. Seattle, WA" },
    },
    required: ["location"],
  },
  run: ({ location }: { location: string }) => {
    return `The weather in ${location} is sunny.`;
  },
};

// Use a hook to create a simple audit log for tool calls
const auditLogToolCall = post_tool_call((data) => {
  console.log(`\n  [AUDIT] Tool execution completed. Result: ${JSON.stringify(data)}`);
});

async function main() {
  const agent = new Agent({
    tools: [get_weather],
    hooks: [auditLogToolCall],
    policies: [policy.allow_all()],
  });

  console.log("Starting agent...");
  await agent.start();

  const prompt = "What is the weather in Seattle?";
  console.log(`  User: ${prompt}`);

  const response = await agent.chat(prompt);

  // Stream the response to stdout
  process.stdout.write("  Agent: ");
  for await (const chunk of response) {
    process.stdout.write(chunk);
  }
  console.log();

  // Access token usage
  const usage = agent.conversation.totalUsage;
  console.log("\n  --- Token Usage ---");
  console.log(`  Prompt tokens: ${usage.promptTokenCount}`);
  console.log(`  Output tokens: ${usage.candidatesTokenCount}`);
  console.log(`  Thinking tokens: ${usage.thoughtsTokenCount}`);
  console.log(`  Total tokens: ${usage.totalTokenCount}`);

  console.log("\nStopping agent...");
  await agent.stop();
}

main().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});
