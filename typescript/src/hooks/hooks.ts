import { Effect } from "effect";
import * as Types from "../types.ts";

export class HookContext {
  private store = new Map<string, any>();
  constructor(readonly parent?: HookContext) {}

  get(key: string, defaultValue?: any): any {
    if (this.store.has(key)) {
      return this.store.get(key);
    }
    if (this.parent) {
      return this.parent.get(key, defaultValue);
    }
    return defaultValue;
  }

  set(key: string, value: any): void {
    this.store.set(key, value);
  }
}

export class SessionContext extends HookContext {
  constructor() {
    super(undefined);
  }
}

export class TurnContext extends HookContext {
  constructor(readonly sessionContext: SessionContext) {
    super(sessionContext);
  }
}

export class OperationContext extends HookContext {
  constructor(readonly turnContext: TurnContext) {
    super(turnContext);
  }
}

export interface InspectHook<T> {
  readonly hookType: string;
  run(context: HookContext, data: T): any;
}

export interface DecideHook<T> {
  readonly hookType: string;
  run(context: HookContext, data: T): any;
}

export interface TransformHook<T, R> {
  readonly hookType: string;
  run(context: HookContext, data: T): any;
}

export class OnSessionStartHook implements InspectHook<void> {
  readonly hookType = "on_session_start";
  constructor(readonly runFn: (context: HookContext) => any) {}
  run(context: HookContext): any {
    return this.runFn(context);
  }
}

export class OnSessionEndHook implements InspectHook<void> {
  readonly hookType = "on_session_end";
  constructor(readonly runFn: (context: HookContext) => any) {}
  run(context: HookContext): any {
    return this.runFn(context);
  }
}

export class PreTurnHook implements DecideHook<Types.Content> {
  readonly hookType = "pre_turn";
  constructor(readonly runFn: (context: HookContext, data: Types.Content) => any) {}
  run(context: HookContext, data: Types.Content): any {
    return this.runFn(context, data);
  }
}

export class PostTurnHook implements InspectHook<string> {
  readonly hookType = "post_turn";
  constructor(readonly runFn: (context: HookContext, data: string) => any) {}
  run(context: HookContext, data: string): any {
    return this.runFn(context, data);
  }
}

export class PreToolCallDecideHook implements DecideHook<Types.ToolCall> {
  readonly hookType = "pre_tool_call_decide";
  constructor(readonly runFn: (context: HookContext, data: Types.ToolCall) => any) {}
  run(context: HookContext, data: Types.ToolCall): any {
    return this.runFn(context, data);
  }
}

export class PostToolCallHook implements InspectHook<Types.ToolResult> {
  readonly hookType = "post_tool_call";
  constructor(readonly runFn: (context: HookContext, data: Types.ToolResult) => any) {}
  run(context: HookContext, data: Types.ToolResult): any {
    return this.runFn(context, data);
  }
}

export class OnToolErrorHook implements TransformHook<Error, any> {
  readonly hookType = "on_tool_error";
  constructor(readonly runFn: (context: HookContext, data: Error) => any) {}
  run(context: HookContext, data: Error): any {
    return this.runFn(context, data);
  }
}

export class OnInteractionHook implements TransformHook<Types.AskQuestionInteractionSpec, Types.QuestionHookResult> {
  readonly hookType = "on_interaction";
  constructor(readonly runFn: (context: HookContext, data: Types.AskQuestionInteractionSpec) => any) {}
  run(context: HookContext, data: Types.AskQuestionInteractionSpec): any {
    return this.runFn(context, data);
  }
}

export class OnCompactionHook implements InspectHook<any> {
  readonly hookType = "on_compaction";
  constructor(readonly runFn: (context: HookContext, data: any) => any) {}
  run(context: HookContext, data: any): any {
    return this.runFn(context, data);
  }
}

export const pre_turn = (fn: (data: Types.Content) => any) =>
  new PreTurnHook((_, data) => fn(data));

export const pre_tool_call_decide = (fn: (data: Types.ToolCall) => any) =>
  new PreToolCallDecideHook((_, data) => fn(data));

export const on_interaction = (fn: (data: Types.AskQuestionInteractionSpec) => any) =>
  new OnInteractionHook((_, data) => fn(data));

export const on_compaction = (fn: (data: any) => any) =>
  new OnCompactionHook((_, data) => fn(data));

export const on_session_start = (fn: () => any) =>
  new OnSessionStartHook(() => fn());

export const on_session_end = (fn: () => any) =>
  new OnSessionEndHook(() => fn());

export const post_turn = (fn: (data: string) => any) =>
  new PostTurnHook((_, data) => fn(data));

export const post_tool_call = (fn: (data: Types.ToolResult) => any) =>
  new PostToolCallHook((_, data) => fn(data));

export const on_tool_error = (fn: (data: Error) => any) =>
  new OnToolErrorHook((_, data) => fn(data));

export async function resolveHookValue<A>(val: any): Promise<A> {
  if (Effect.isEffect(val)) {
    return Effect.runPromise(val as any);
  }
  return val;
}
