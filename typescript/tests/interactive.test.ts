import { expect, test, describe, mock } from "bun:test";
import { ToolConfirmationHook, AskQuestionHook, _upgradeToInteractiveConfirmation } from "../src/utils/interactive.ts";
import { HookContext } from "../src/hooks/hooks.ts";
import { Agent } from "../src/agent.ts";
import * as Policy from "../src/hooks/policy.ts";
import * as Types from "../src/types.ts";

let mockAnswers: string[] = [];

mock.module("node:readline/promises", () => {
  return {
    default: {
      createInterface: () => {
        return {
          question: async (prompt: string) => {
            return mockAnswers.shift() || "";
          },
          close: () => {}
        };
      }
    }
  };
});

describe("Interactive Hooks", () => {
  test("ToolConfirmationHook approves on 'y'/'yes' and denies on others", async () => {
    const hook = new ToolConfirmationHook();
    const ctx = new HookContext();
    const tc: Types.ToolCall = { name: "run_command", id: "1" };

    mockAnswers = ["y"];
    const res1 = await hook.run(ctx, tc);
    expect(res1.allow).toBe(true);

    mockAnswers = ["n"];
    const res2 = await hook.run(ctx, tc);
    expect(res2.allow).toBe(false);
    expect(res2.message).toBe("User denied tool call.");
  });

  test("AskQuestionHook processes questions and parses responses", async () => {
    const hook = new AskQuestionHook();
    const ctx = new HookContext();
    const spec: Types.AskQuestionInteractionSpec = {
      questions: [
        {
          id: "q1",
          question: "First choice?",
          options: [
            { id: "opt1", text: "Option A" },
            { id: "opt2", text: "Option B" }
          ]
        },
        {
          id: "q2",
          question: "Second choice?",
          options: [
            { id: "opt3", text: "Option C" }
          ]
        },
        {
          id: "q3",
          question: "Freeform response?"
        }
      ]
    };

    mockAnswers = ["1", "Option C", "custom text"];
    const res = await hook.run(ctx, spec);
    expect(res.cancelled).toBe(false);
    expect(res.responses).toEqual([
      { selectedOptionIds: ["opt1"] },
      { selectedOptionIds: ["opt3"] },
      { freeformResponse: "custom text" }
    ]);
  });
});

describe("_upgradeToInteractiveConfirmation", () => {
  test("upgrades deny RUN_COMMAND policies to interactive ask_user", () => {
    const agentConfig = {
      policies: [
        Policy.deny(Types.BuiltinTools.RUN_COMMAND, undefined, "deny_run"),
        Policy.allow(Types.BuiltinTools.VIEW_FILE)
      ],
      capabilities: {
        enabledTools: [Types.BuiltinTools.RUN_COMMAND, Types.BuiltinTools.VIEW_FILE]
      }
    };

    const agent = new Agent(agentConfig);
    // Mock hookRunner and start-like state minimally
    const mockPreToolCallHooks: any[] = [{ constructor: { name: "PolicyDecideHook" } }];
    (agent as any).hookRunner = {
      preToolCallDecideHooks: mockPreToolCallHooks,
      registerHook: (h: any) => mockPreToolCallHooks.push(h)
    };

    _upgradeToInteractiveConfirmation(agent);

    // After upgrade, policy list should contain an ASK_USER decision for RUN_COMMAND
    const updatedPolicies = agentConfig.policies;
    const runPolicy = updatedPolicies.find(p => p.tool === Types.BuiltinTools.RUN_COMMAND);
    expect(runPolicy).toBeDefined();
    expect(runPolicy?.decision).toBe(Policy.Decision.ASK_USER);
  });
});
