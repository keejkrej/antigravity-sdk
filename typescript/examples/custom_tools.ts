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
 * Example demonstrating custom tools and stateful tools with ToolContext.
 *
 * This example shows:
 * 1. How to define a simple custom tool with a strict parameters schema.
 * 2. How to define a stateful tool using ToolContext to maintain state
 *    across conversation turns.
 *
 * To run:
 *   bun typescript/examples/custom_tools.ts
 *
 * Criteria for correct script performance:
 *   1. The script exits cleanly with return code 0 (no unhandled exceptions).
 *   2. The agent calls the lookup_fruit_sku tool and returns an SKU value
 *      in its response.
 *   3. The agent calls the record_fruit tool across multiple turns,
 *      maintaining running totals.
 *   4. The agent produces meaningful text responses for each conversational
 *      turn.
 */

import { Agent, policy, ToolContext } from "../src/index.js";

// 1. Define a simple tool
const lookup_fruit_sku = {
  name: "lookup_fruit_sku",
  description: "Looks up the SKU for a given fruit.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      fruit_name: { type: "string", description: "The name of the fruit." },
    },
    required: ["fruit_name"],
  },
  run: ({ fruit_name }: { fruit_name: string }) => {
    const skus: Record<string, string> = {
      apple: "SKU-APP-123",
      banana: "SKU-BAN-456",
      orange: "SKU-ORA-789",
    };
    let name = fruit_name.toLowerCase();
    if (name.endsWith("s") && !skus[name]) {
      name = name.slice(0, -1);
    }
    const sku = skus[name] || "SKU-GEN-000";
    return `SKU for ${fruit_name} is ${sku}. Order ID for restocking: ORD-${sku}-NEW`;
  },
};

// 2. Define a stateful tool using ToolContext
const record_fruit = {
  name: "record_fruit",
  description: "Records the count of fruits by SKU.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      sku: { type: "string", description: "The SKU of the fruit." },
      count: { type: "integer", description: "The number of fruits to record." },
    },
    required: ["sku", "count"],
  },
  run: ({ sku, count, ctx }: { sku: string; count: number; ctx: ToolContext }) => {
    // Retrieve current state or initialize if not present
    const currentCounts = ctx.getState("fruit_counts", {}) as Record<string, number>;

    // Update state
    const currentCount = currentCounts[sku] || 0;
    currentCounts[sku] = currentCount + count;
    ctx.setState("fruit_counts", currentCounts);

    const total = currentCounts[sku];
    return `Recorded ${count} units for ${sku}. Total count is now ${total}.`;
  },
};

async function main() {
  // Configure the agent with both tools.
  const agent = new Agent({
    tools: [lookup_fruit_sku, record_fruit],
    systemInstructions:
      "You keep track of fruit inventory. To record fruits, you MUST" +
      " first look up the fruit's SKU using lookup_fruit_sku, and then" +
      " use that SKU with record_fruit.",
    policies: [
      // Deny everything by default so only the tools below are allowed
      policy.deny_all(),
      policy.allow("lookup_fruit_sku"),
      policy.allow("record_fruit"),
    ],
  });

  console.log("Starting agent...");
  await agent.start();

  console.log("  === Custom Tools Demo ===");

  // Test simple tool
  const prompt1 = "What is the SKU for apples? We need to order more.";
  console.log(`\n  User: ${prompt1}`);
  const response1 = await agent.chat(prompt1);
  console.log(`  Agent: ${await response1.text()}`);

  // Test stateful tool
  console.log("\n  === Stateful Tool (Fruit Counter) Demo ===");

  const turns = [
    "I have 5 apples.",
    "And I just got 3 bananas.",
    "Oh, and another 2 apples.",
  ];

  for (const userInput of turns) {
    console.log(`\n  User: ${userInput}`);
    const response = await agent.chat(userInput);
    console.log(`  Agent: ${await response.text()}`);
  }

  console.log("\nStopping agent...");
  await agent.stop();
}

main().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});
