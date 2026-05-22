import { Agent } from "../src/index.js";
import { Effect } from "effect";

// Simple calculator tool definition
const calculator = {
  name: "calculator",
  description: "A tool to evaluate simple math expressions. Example: input '42 * 2' returns 84.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      expression: {
        type: "string",
        description: "The mathematical expression to evaluate (e.g. '2 + 2' or '10 * 5').",
      },
    },
    required: ["expression"],
  },
  run: (args: { expression: string }) => {
    try {
      // Basic safe-ish evaluation for simple arithmetic
      const cleanExpr = args.expression.replace(/[^0-9+\-*/().\s]/g, "");
      // Evaluate
      const result = Function(`"use strict"; return (${cleanExpr})`)();
      return { result };
    } catch (err: any) {
      return { error: `Failed to evaluate expression: ${err.message}` };
    }
  },
};

const main = Effect.gen(function* () {
  console.log("Initializing Antigravity TS SDK Agent...");

  const agent = new Agent({
    systemInstructions: "You are a helpful mathematical assistant. Use the calculator tool for any math questions.",
    tools: [calculator],
    geminiConfig: {
      modelName: "gemini-2.5-flash",
    },
  });

  console.log("Starting agent...");
  yield* agent.start();

  console.log("Sending chat prompt to Agent...");
  const response = yield* agent.chat("What is 12345 * 6789? Please use your calculator tool.");

  console.log("\n--- Agent Response ---");
  console.log(response.text);
  console.log("----------------------\n");

  console.log("Stopping agent...");
  yield* agent.stop();
});

Effect.runPromise(main).catch((err) => {
  console.error("Execution failed:", err);
});
