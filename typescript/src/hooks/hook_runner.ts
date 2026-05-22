import { Effect } from "effect";
import * as Types from "../types.ts";
import {
  HookContext,
  SessionContext,
  TurnContext,
  OperationContext,
  OnSessionStartHook,
  OnSessionEndHook,
  PreTurnHook,
  PostTurnHook,
  PreToolCallDecideHook,
  PostToolCallHook,
  OnToolErrorHook,
  OnInteractionHook,
  OnCompactionHook,
  resolveHookValue,
} from "./hooks.ts";

export class HookRunner {
  readonly onSessionStartHooks: OnSessionStartHook[] = [];
  readonly onSessionEndHooks: OnSessionEndHook[] = [];
  readonly preTurnHooks: PreTurnHook[] = [];
  readonly postTurnHooks: PostTurnHook[] = [];
  readonly preToolCallDecideHooks: PreToolCallDecideHook[] = [];
  readonly postToolCallHooks: PostToolCallHook[] = [];
  readonly onToolErrorHooks: OnToolErrorHook[] = [];
  readonly onInteractionHooks: OnInteractionHook[] = [];
  readonly onCompactionHooks: OnCompactionHook[] = [];

  readonly sessionContext = new SessionContext();

  constructor(hooksList: any[] = []) {
    for (const h of hooksList) {
      this.registerHook(h);
    }
  }

  get hasHooks(): boolean {
    return (
      this.onSessionStartHooks.length > 0 ||
      this.onSessionEndHooks.length > 0 ||
      this.preTurnHooks.length > 0 ||
      this.postTurnHooks.length > 0 ||
      this.preToolCallDecideHooks.length > 0 ||
      this.postToolCallHooks.length > 0 ||
      this.onToolErrorHooks.length > 0 ||
      this.onInteractionHooks.length > 0 ||
      this.onCompactionHooks.length > 0
    );
  }

  registerHook(hook: any): void {
    if (!hook || typeof hook.hookType !== "string") {
      throw new Error(`Invalid hook registered: ${hook}`);
    }
    switch (hook.hookType) {
      case "on_session_start":
        this.onSessionStartHooks.push(hook);
        break;
      case "on_session_end":
        this.onSessionEndHooks.push(hook);
        break;
      case "pre_turn":
        this.preTurnHooks.push(hook);
        break;
      case "post_turn":
        this.postTurnHooks.push(hook);
        break;
      case "pre_tool_call_decide":
        this.preToolCallDecideHooks.push(hook);
        break;
      case "post_tool_call":
        this.postToolCallHooks.push(hook);
        break;
      case "on_tool_error":
        this.onToolErrorHooks.push(hook);
        break;
      case "on_interaction":
        this.onInteractionHooks.push(hook);
        break;
      case "on_compaction":
        this.onCompactionHooks.push(hook);
        break;
      default:
        throw new Error(`Unknown hook type: ${hook.hookType}`);
    }
  }

  dispatchSessionStart(): Effect.Effect<void, Error> {
    return Effect.promise(async () => {
      for (const hook of this.onSessionStartHooks) {
        await resolveHookValue(hook.run(this.sessionContext));
      }
    });
  }

  dispatchSessionEnd(): Effect.Effect<void, Error> {
    return Effect.promise(async () => {
      for (const hook of this.onSessionEndHooks) {
        await resolveHookValue(hook.run(this.sessionContext));
      }
    });
  }

  dispatchPreTurn(
    prompt: Types.Content | null
  ): Effect.Effect<[Types.HookResult, TurnContext], Error> {
    return Effect.promise(async () => {
      const dataPrompt = prompt || "";
      const turnContext = new TurnContext(this.sessionContext);
      for (const hook of this.preTurnHooks) {
        const res = await resolveHookValue<Types.HookResult>(
          hook.run(turnContext, dataPrompt)
        );
        if (!res.allow) {
          return [res, turnContext];
        }
      }
      return [{ allow: true }, turnContext];
    });
  }

  dispatchPostTurn(
    turnContext: TurnContext,
    response: string
  ): Effect.Effect<void, Error> {
    return Effect.promise(async () => {
      for (const hook of this.postTurnHooks) {
        await resolveHookValue(hook.run(turnContext, response));
      }
    });
  }

  dispatchPreToolCall(
    turnContext: TurnContext,
    toolCall: Types.ToolCall
  ): Effect.Effect<[Types.HookResult, Types.ToolCall, OperationContext], Error> {
    return Effect.promise(async () => {
      const opContext = new OperationContext(turnContext);
      for (const hook of this.preToolCallDecideHooks) {
        const res = await resolveHookValue<Types.HookResult>(
          hook.run(opContext, toolCall)
        );
        if (!res.allow) {
          return [res, toolCall, opContext];
        }
      }
      return [{ allow: true }, toolCall, opContext];
    });
  }

  dispatchPostToolCall(
    opContext: OperationContext,
    result: any
  ): Effect.Effect<void, Error> {
    return Effect.promise(async () => {
      for (const hook of this.postToolCallHooks) {
        await resolveHookValue(hook.run(opContext, result));
      }
    });
  }

  dispatchOnToolError(
    opContext: OperationContext,
    error: Error
  ): Effect.Effect<[Types.HookResult, any], Error> {
    return Effect.promise(async () => {
      for (const hook of this.onToolErrorHooks) {
        try {
          const res = await resolveHookValue<any>(hook.run(opContext, error));
          if (res !== undefined && res !== null) {
            return [{ allow: true }, res];
          }
        } catch (e: any) {
          return [
            {
              allow: false,
              message: `Error recovery failed: ${e?.message || e}`,
            },
            null,
          ];
        }
      }
      return [{ allow: false }, null];
    });
  }

  dispatchInteraction(
    turnContext: TurnContext,
    interactionSpec: Types.AskQuestionInteractionSpec
  ): Effect.Effect<[Types.HookResult, Types.QuestionHookResult | null, OperationContext], Error> {
    return Effect.promise(async () => {
      const opContext = new OperationContext(turnContext);
      for (const hook of this.onInteractionHooks) {
        const res = await resolveHookValue<Types.QuestionHookResult | null>(
          hook.run(opContext, interactionSpec)
        );
        if (res !== undefined && res !== null) {
          return [{ allow: true }, res, opContext];
        }
      }
      return [
        {
          allow: false,
          message: "No interaction hook handled the request",
        },
        null,
        opContext,
      ];
    });
  }

  dispatchCompaction(
    turnContext: TurnContext,
    data: any
  ): Effect.Effect<void, Error> {
    return Effect.promise(async () => {
      const opContext = new OperationContext(turnContext);
      for (const hook of this.onCompactionHooks) {
        await resolveHookValue(hook.run(opContext, data));
      }
    });
  }
}
