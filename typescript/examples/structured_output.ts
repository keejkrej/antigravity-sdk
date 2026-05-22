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
 * Example demonstrating native structured output from an agent.
 *
 * This example shows how to configure the agent to return a strongly-typed,
 * validated JSON payload (modeled via plain JSON schema) instead of raw, unstructured
 * conversational text.
 *
 * When and Why to Use Structured Output:
 * - Programmatic Downstream Consumption: When the output of the agent needs
 *   to be ingested directly by downstream databases, APIs, or workflows (e.g.,
 *   populating a task manager, booking calendar slots, or feeding microservices).
 * - Strict Schema Validation: To ensure type safety, required fields, and strict
 *   data constraints on model outputs, mitigating fragile parsing/regex matching.
 * - Native Guidance: Fulfilling a configured `responseSchema` natively guides the
 *   underlying model's reasoning loop and final output to match the schema
 *   perfectly.
 *
 * In this example, the agent uses a custom mock tool to retrieve raw unstructured
 * meeting notes and distills them into a structured action item list containing
 * assignee, task, and deadline fields.
 *
 * To run:
 *   bun typescript/examples/structured_output.ts
 *
 * Criteria for correct script performance:
 *   1. The script exits cleanly with return code 0 (no unhandled exceptions).
 *   2. The agent calls the fetch_unstructured_meeting_notes tool to retrieve
 *      meeting data.
 *   3. The structured output contains action items with assignees and tasks
 *      derived from the meeting notes.
 *   4. Each action item includes assignee, task, and deadline fields.
 */

import { Agent, policy } from "../src/index.js";

// Define the response schema using standard JSON Schema
const MeetingSummarySchema = {
  type: "object",
  properties: {
    action_items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          assignee: { type: "string" },
          task: { type: "string" },
          deadline: { type: "string" },
        },
        required: ["assignee", "task", "deadline"],
      },
    },
  },
  required: ["action_items"],
};

// A custom mock tool that retrieves unstructured text data
const fetch_unstructured_meeting_notes = {
  name: "fetch_unstructured_meeting_notes",
  description: "Retrieves the raw unstructured notes for a given meeting ID.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      meeting_id: { type: "string", description: "The ID of the meeting." },
    },
    required: ["meeting_id"],
  },
  run: ({ meeting_id }: { meeting_id: string }) => {
    if (meeting_id === "meeting-2026-05") {
      return (
        "Discussed launch timeline for project X. Alice agreed to update" +
        " the textproto tests by Monday. Bob mentioned he will run the final" +
        " E2E benchmarks tomorrow. I will push the release build once the" +
        " tests are green."
      );
    }
    return "Error: Meeting notes not found.";
  },
};

async function main() {
  console.log("  --- Starting main ---");
  const agent = new Agent({
    tools: [fetch_unstructured_meeting_notes],
    responseSchema: MeetingSummarySchema,
    policies: [policy.allow_all()],
  });

  console.log("Starting agent...");
  await agent.start();

  const prompt =
    "Use the fetch_unstructured_meeting_notes tool to retrieve notes for" +
    " 'meeting-2026-05' and return the meeting summary with the appropriate" +
    " action item list. Ensure each action item includes 'assignee'," +
    " 'task', and 'deadline'.";

  console.log("\n  Sending prompt to agent...");
  const response = await agent.chat(prompt);

  console.log("\n  Extracting structured meeting action items...");

  const data = await response.structuredOutput();
  if (!data) {
    console.log("\n  Failed to extract structured summary natively.");
    console.log(`  Final Text Response: ${await response.text()}`);
    await agent.stop();
    return;
  }

  console.log("\n  === Structured Meeting Action Items ===");
  const items = data.action_items || [];
  for (const item of items) {
    console.log(`  - Assignee: ${item.assignee}`);
    console.log(`    Task:     ${item.task}`);
    console.log(`    Deadline: ${item.deadline}\n`);
  }

  console.log("Stopping agent...");
  await agent.stop();
}

main().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});
