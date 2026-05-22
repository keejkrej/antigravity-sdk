import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Stream } from "effect";
import { Agent } from "../agent.ts";
import {
  PreToolCallDecideHook,
  HookContext,
  OnInteractionHook,
} from "../hooks/hooks.ts";
import * as Types from "../types.ts";
import * as Policy from "../hooks/policy.ts";

export async function askQuestionStdin(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(prompt);
    return answer;
  } finally {
    rl.close();
  }
}

export class ToolConfirmationHook extends PreToolCallDecideHook {
  constructor() {
    super(async (context, data) => {
      console.log(`\nTool execution requested: ${data.name}`);
      if (data.args && Object.keys(data.args).length > 0) {
        console.log(`Arguments:`, data.args);
      }
      try {
        const ans = await askQuestionStdin("Allow execution? (y/n) [n]: ");
        if (ans.trim().toLowerCase() === "y" || ans.trim().toLowerCase() === "yes") {
          return { allow: true };
        }
      } catch (_) {}
      return { allow: false, message: "User denied tool call." };
    });
  }
}

export async function askUserHandler(tc: Types.ToolCall): Promise<boolean> {
  console.log(`\nPolicy check: Tool execution requested: ${tc.name}`);
  if (tc.args && Object.keys(tc.args).length > 0) {
    console.log(`Arguments:`, tc.args);
  }
  try {
    const ans = await askQuestionStdin("Allow execution? (y/n) [n]: ");
    return ans.trim().toLowerCase() === "y" || ans.trim().toLowerCase() === "yes";
  } catch (_) {
    return false;
  }
}

export class AskQuestionHook extends OnInteractionHook {
  constructor() {
    super(async (context, data) => {
      const questions = data.questions || [];
      const responses: Types.QuestionResponse[] = [];
      let cancelled = false;

      try {
        for (const q of questions) {
          console.log(`\nQuestion: ${q.question}`);
          const options = q.options || [];
          for (let idx = 0; idx < options.length; idx++) {
            console.log(`  ${idx + 1}. ${options[idx].text}`);
          }

          const ans = await askQuestionStdin("Response: ");
          const trimmed = ans.trim();
          if (!trimmed) {
            responses.push({ skipped: true });
            continue;
          }

          let matchedId: string | undefined = undefined;
          if (options.length > 0) {
            // Try to match by option number
            try {
              const selectedIdx = parseInt(trimmed, 10) - 1;
              if (selectedIdx >= 0 && selectedIdx < options.length) {
                matchedId = options[selectedIdx].id;
              }
            } catch (_) {}

            // Try to match by exact option text or ID
            if (!matchedId) {
              for (const opt of options) {
                if (
                  trimmed.toLowerCase() === opt.text.toLowerCase() ||
                  trimmed.toLowerCase() === opt.id.toLowerCase()
                ) {
                  matchedId = opt.id;
                  break;
                }
              }
            }
          }

          if (matchedId) {
            responses.push({ selectedOptionIds: [matchedId] });
          } else {
            responses.push({ freeformResponse: trimmed });
          }
        }
      } catch (err) {
        cancelled = true;
      }

      return { responses, cancelled };
    });
  }
}

export function _upgradeToInteractiveConfirmation(agent: Agent): void {
  const agAny = agent as any;
  const config = agAny.config;
  if (!config || !config.policies) {
    return;
  }

  const upgraded: Policy.Policy[] = [];
  for (const p of config.policies) {
    if (
      p.tool === Types.BuiltinTools.RUN_COMMAND &&
      p.decision === Policy.Decision.DENY &&
      !p.when
    ) {
      upgraded.push(
        Policy.ask_user(
          Types.BuiltinTools.RUN_COMMAND,
          askUserHandler,
          undefined,
          p.name || "interactive_confirm"
        )
      );
    } else {
      upgraded.push(p);
    }
  }

  config.policies = upgraded;

  const newHook = Policy.enforce(upgraded);
  const runner = agAny.hookRunner;
  if (!runner) {
    throw new Error("Agent must be started before upgrading policies.");
  }

  const hooksList = runner.preToolCallDecideHooks;
  for (let i = 0; i < hooksList.length; i++) {
    if (hooksList[i] && hooksList[i].constructor.name === "PolicyDecideHook") {
      hooksList[i] = newHook;
      return;
    }
  }
  hooksList.push(newHook);
}

export async function runInteractiveLoop(agent: Agent): Promise<void> {
  if (!agent.isStarted) {
    throw new Error("Agent session not started. Call start() or start the agent context.");
  }

  agent.registerHook(new AskQuestionHook());
  _upgradeToInteractiveConfirmation(agent);

  console.log("Starting interactive loop. Type 'exit' or 'quit' to end.");
  while (true) {
    try {
      const userInput = await askQuestionStdin("User: ");
      const trimmed = userInput.trim();
      if (!trimmed) {
        continue;
      }
      if (trimmed.toLowerCase() === "exit" || trimmed.toLowerCase() === "quit") {
        console.log("Goodbye!");
        break;
      }

      await agent.conversation.send(trimmed);

      const stepsStream = agent.conversation.receiveSteps();
      for await (const step of Stream.toAsyncIterable(stepsStream)) {
        if (step.isCompleteResponse) {
          console.log(`Agent: ${step.content}`);
        }
      }
    } catch (err: any) {
      console.log("\nGoodbye!");
      break;
    }
  }
}
