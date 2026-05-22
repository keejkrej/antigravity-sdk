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
 * Multimodal example for Google Antigravity SDK.
 *
 * This example demonstrates:
 * - Multimodal input: Passing images and documents to the agent.
 * - Multimodal output: Enabling the agent to generate images.
 *
 * To run:
 *   bun typescript/examples/multimodal.ts
 *
 * Criteria for correct script performance:
 *   1. The script exits cleanly with return code 0 (no unhandled exceptions).
 *   2. The agent produces a non-empty description of the provided image.
 *   3. The agent produces a non-empty summary of the provided document.
 *   4. The agent attempts to generate an image when asked.
 */

import path from "path";
import { fileURLToPath } from "url";
import { Agent, BuiltinTools, fromFile, policy } from "../src/index.js";

// Setup paths to resources
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const resourcesDir = path.resolve(__dirname, "../resources");
const imagePath = path.join(resourcesDir, "example_image.png");
const docPath = path.join(resourcesDir, "sample_doc.txt");

async function main() {
  const config = {
    policies: [policy.allow_all()],
    geminiConfig: {
      modelName: "gemini-3.5-flash",
    },
  };

  // Multimodal Input: Image
  console.log("  --- Multimodal Input: Image ---");
  const imageAgent = new Agent(config);
  try {
    await imageAgent.start();
    const image = fromFile(imagePath);
    const prompt = ["What is in this image?", image];
    console.log(`  User: ${prompt[0]}`);
    const response = await imageAgent.chat(prompt);
    console.log(`  Agent: ${await response.text()}\n`);
  } finally {
    await imageAgent.stop();
  }

  // Multimodal Input: Document
  console.log("  --- Multimodal Input: Document ---");
  const docAgent = new Agent(config);
  try {
    await docAgent.start();
    const doc = fromFile(docPath);
    const prompt = ["Summarize this document", doc];
    console.log(`  User: ${prompt[0]}`);
    const response = await docAgent.chat(prompt);
    console.log(`  Agent: ${await response.text()}\n`);
  } finally {
    await docAgent.stop();
  }

  // Multimodal Output: Image Generation
  console.log("  --- Multimodal Output: Image Generation ---");
  const genConfig = {
    policies: [policy.allow_all()],
    capabilities: {
      enabledTools: [BuiltinTools.GENERATE_IMAGE],
    },
    geminiConfig: {
      modelName: "gemini-3.5-flash",
    },
  };

  const genAgent = new Agent(genConfig);
  try {
    await genAgent.start();
    const prompt =
      "Generate an image of a futuristic city, name it 'future_city'. " +
      "Please provide the file path to the generated image.";
    console.log(`  User: ${prompt}`);
    const response = await genAgent.chat(prompt);
    console.log(`  Agent: ${await response.text()}\n`);
  } finally {
    await genAgent.stop();
  }
}

main().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});
