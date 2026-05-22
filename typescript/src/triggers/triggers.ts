import { Connection } from "../connection.ts";
import { Effect } from "effect";

export class TriggerContext {
  constructor(readonly connection: Connection) {}

  send(content: string): Effect.Effect<void, Error> {
    return this.connection.sendTriggerNotification(content);
  }
}

export type Trigger = (ctx: TriggerContext) => Effect.Effect<void, Error, any> | Promise<void> | void;

export function trigger(fn: any) {
  if (typeof fn !== "function") {
    throw new Error("Trigger must be a function");
  }
  fn.__is_trigger__ = true;
  return fn;
}
