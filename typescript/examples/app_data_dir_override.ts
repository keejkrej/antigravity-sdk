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
 * Example demonstrating appDataDir override in Google Antigravity SDK.
 *
 * This example shows how to configure an agent with a custom application data
 * directory (`appDataDir`) to control where the agent stores artifacts, scratch
 * files, and uploaded media.
 *
 * To run:
 *   bun typescript/examples/app_data_dir_override.ts
 */

import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { Agent, policy } from "../src/index.js";

async function main() {
  // Create a temporary directory for the custom application data storage
  const customAppData = fs.mkdtempSync(path.join(os.tmpdir(), "agent_appdata_"));
  console.log(`  Custom App Data Dir: ${customAppData}\n`);

  // Initialize the agent config with our custom appDataDir override
  const agent = new Agent({
    appDataDir: customAppData,
    policies: [policy.allow_all()],
  });

  // Start the agent and ask it to create an artifact
  console.log("Starting agent...");
  await agent.start();

  console.log(`  Agent Session Started. Conversation ID: ${agent.conversationId}\n`);

  const prompt =
    "Please create an artifact file named 'typescript_best_practices.md'" +
    " summarizing TypeScript best practices.";
  console.log(`  User:  ${prompt}`);
  
  const response = await agent.chat(prompt);
  console.log(`  Agent: ${await response.text()}\n`);

  // Verify that the artifact was successfully stored in our custom appDataDir
  const conversationId = agent.conversationId;
  if (!conversationId) {
    throw new Error("Conversation ID is undefined!");
  }

  const expectedArtifactPath = path.join(
    customAppData,
    "brain",
    conversationId,
    "typescript_best_practices.md"
  );

  console.log(`  Checking artifact location: ${expectedArtifactPath}`);
  if (fs.existsSync(expectedArtifactPath)) {
    console.log("\n  SUCCESS: Verified artifact successfully stored in custom appDataDir!");
  } else {
    console.log("\n  WARNING: Artifact was not found in custom appDataDir.");
  }

  console.log("Stopping agent...");
  await agent.stop();
}

main().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});
