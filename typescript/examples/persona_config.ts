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
 * Example demonstrating system instructions in Google Antigravity SDK.
 *
 * This example shows how to configure the agent's system instructions using both
 * templated (appended) and custom approaches.
 *
 * Templated instructions are recommended for most users because they allow you to
 * leverage the default, highly-optimized system prompt provided by the SDK (which
 * includes critical rules for agent behavior) while still customizing the agent's
 * specific identity and adding application-specific guidelines. This ensures the
 * agent remains focused and organized without requiring you to recreate complex
 * infrastructure-level instructions from scratch.
 *
 * Custom instructions, on the other hand, are NOT recommended for most users
 * because they completely bypass the default SDK scaffolding and dynamic
 * environmental context (such as active workspaces, available skills, and subagent
 * coordination rules). This is a 'break glass' advanced feature where you must
 * take full responsibility for manually compiling all environment and dynamic
 * paths inside TypeScript/JavaScript if they are needed by your custom System Prompt.
 *
 * This example demonstrates:
 * 1. Using AppendedSystemInstructions to override identity and add sections.
 * 2. Using CustomSystemInstructions to provide a full structured system prompt
 *    when complete control is needed.
 *
 * To run:
 *   bun typescript/examples/persona_config.ts
 *
 * Criteria for correct script performance:
 *   1. The script exits cleanly with return code 0 (no unhandled exceptions).
 *   2. In the templated case, the agent reviews the code snippet and
 *      provides actionable feedback (e.g. about naming conventions).
 *   3. The agent uses the check_style_guide tool when reviewing code.
 *   4. In the custom case, the agent also produces a meaningful code review
 *      consistent with the custom reviewer persona.
 */

import * as os from "node:os";
import * as path from "node:path";
import { Agent, policy, SystemInstructions } from "../src/index.js";

const check_style_guide = {
  name: "check_style_guide",
  description: "Checks the style guide rules for a given language.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      language: { type: "string", description: "The programming language to verify." },
    },
    required: ["language"],
  },
  run: ({ language }: { language: string }) => {
    if (language.toLowerCase() === "python") {
      return "Use snake_case for functions and variables. Use CamelCase for classes.";
    }
    return "No specific rules found.";
  },
};

async function runTemplatedExample() {
  console.log("  === Templated System Instructions Example ===");

  // Override the Identity (Persona)
  const identity =
    "You are an expert Code Quality Reviewer.\nYour role is to review code" +
    " for readability, maintainability, and adherence to style guides.";

  // Add custom sections. These sections are passed to the local harness as
  // structured sections (with a title and content) and are appended to the
  // default system instructions. Using titles helps organize the prompt
  // and makes it easier for the model to follow specific guidelines.
  const reviewCriteria = {
    title: "review_criteria",
    content: "- Focus on readability and simplicity.\n" + "- Ensure meaningful variable and function names.",
  };

  // We explicitly reference the tool name `check_style_guide` here to guide the
  // model to use this specific tool when performing style reviews. This helps
  // ground the agent's behavior in the available toolset.
  const styleGuideInstructions = {
    title: "style_guide_instructions",
    content: "When reviewing Python code, use the `check_style_guide` tool to verify rules.",
  };

  const templatedSI: SystemInstructions = {
    appended: {
      customIdentity: identity,
      appendedSections: [reviewCriteria, styleGuideInstructions],
    },
  };

  const agent = new Agent({
    systemInstructions: templatedSI,
    tools: [check_style_guide],
    policies: [policy.allow_all()],
  });

  await agent.start();

  const prompt = "Review this Python code: `def MY_FUNCTION(X): return X*2`";
  console.log(`  User: ${prompt}`);
  const response = await agent.chat(prompt);
  console.log(`  Agent: ${await response.text()}\n`);

  await agent.stop();
}

function buildSkillsInstructions(skillsPaths: string[]): string {
  if (!skillsPaths || skillsPaths.length === 0) {
    return "";
  }

  let instructions = "\n<skills>\n";
  instructions +=
    "Skills enhance your abilities with specialized expertise and" +
    " repeatable workflows to help solve advanced workflows.\n";
  instructions +=
    "When a task matches an available skill's description, you must inspect" +
    " the complete SKILL.md with your 'view_file' tool in order to understand" +
    " its capabilities.\n\n";
  instructions += "Available skills:\n";
  for (const p of skillsPaths) {
    const skillName = path.basename(p);
    instructions +=
      `* **${skillName}** (located at \`${p}/SKILL.md\`) — Provides` +
      " guidelines for code readability, style compliance, and refactoring.\n";
  }
  instructions += "</skills>\n";
  return instructions;
}

async function runCustomExample() {
  console.log("  === Custom System Instructions Example ===");

  // Static Identity/Persona
  const identityText = `
<identity>
You are an expert Code Quality Reviewer agent. Your goal is to help developers maintain high standards of readability, maintainability, and correctness in their code. You will receive code snippets or descriptions of code changes and provide actionable feedback. You must always prioritize addressing the user's specific questions or concerns about the code.
</identity>
`;

  // Dynamically gather workspace and app data directory info.
  // Under a complete override, the SDK's default environmental context is
  // omitted, so we manually construct and inject this context string into the
  // custom prompt.
  const cwd = process.cwd();
  const appDataDir = path.join(os.homedir(), ".gemini/antigravity");
  const userInfo = `
<user_information>
Operating System: ${process.platform}
Active Workspace CWD: ${cwd}
Storage Directory (App Data): ${appDataDir}
</user_information>
`;

  // Configure the active skill folders.
  // By default in the SDK, configured skill paths are dynamically prepended to
  // the turns. Under a custom override, we manually compile and append them.
  const scriptDir = import.meta.dirname;
  const skillPath = path.resolve(scriptDir, "../../skills/google-antigravity-sdk");
  const skills = [skillPath];
  const skillsInstructions = buildSkillsInstructions(skills);

  // Standard structured guidelines & formatting rules text
  const guidelinesText = `
<review_guidelines>
### When to recommend refactoring:
- The code has high cyclomatic complexity (too many nested loops/conditionals).
- The code violates DRY (Don't Repeat Yourself) principles significantly.
- The code is difficult to unit test in its current form.

### Don't recommend refactoring for:
- Minor personal style preferences that don't impact readability.
- Micro-optimizations that make the code harder to understand.
</review_guidelines>

<task_management>
### When to suggest breaking up the review:
- If the provided code snippet is longer than 200 lines.
- If the user is asking for both a security audit and a performance review at the same time.
In these cases, suggest reviewing one specific aspect or file first.
</task_management>

<behavioral_principles>
1. **Acknowledge Ambiguity**: If a request is underspecified or could be interpreted in multiple ways, ask the user for clarification before proceeding.
2. **Precision**: When suggesting code changes, always specify the file path and, if applicable, the line range.
3. **Focus on Delta**: Do not restate full file contents or large blocks of code unless necessary. Focus only on what needs to change.
4. **Closure**: End every turn with a clear summary of what was accomplished and what the next steps are.
</behavioral_principles>

<review_artifact_format>
When generating a detailed review artifact in Markdown, use the following elements to ensure high quality and scannability:

### Alerts
Use GitHub-style alerts to highlight critical issues:
> [!IMPORTANT]
> Critical security or correctness issues that must be fixed.

> [!NOTE]
> General improvements or style suggestions.

### Code Diffs
When suggesting changes, use diff blocks to show exactly what to add or remove:
\`\`\`diff
-def old_func():
+def new_func():
\`\`\`

### Tables
Use tables to compare alternative approaches or list multiple findings:
| File | Line | Issue | Severity |
| :--- | :--- | :--- | :--- |
| main.py | 12 | Hardcoded API key | Critical |
</review_artifact_format>

<tool_usage>
You have access to the \`check_style_guide\` tool. When reviewing Python code, always use this tool to verify language-specific style rules before making recommendations.
</tool_usage>
`;

  // Assemble the finalized custom system prompt string,
  // placing all static persona instructions, skills, and guidelines at the
  // top, with the dynamic workspace environment (UserInfo) at the bottom.
  const finalSIPrompt = identityText + skillsInstructions + guidelinesText + userInfo;

  const customSI: SystemInstructions = {
    custom: {
      part: [{ text: finalSIPrompt }],
    },
  };

  const agent = new Agent({
    systemInstructions: customSI,
    tools: [check_style_guide],
    skillsPaths: skills,
    policies: [policy.allow_all()],
  });

  await agent.start();

  const prompt = "Review this Python code: `def foo(x): return x+1`";
  console.log(`  User: ${prompt}`);
  const response = await agent.chat(prompt);
  console.log(`  Agent: ${await response.text()}\n`);

  await agent.stop();
}

async function main() {
  await runTemplatedExample();
  console.log("\n" + "=".repeat(60) + "\n");
  await runCustomExample();
}

main().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});
