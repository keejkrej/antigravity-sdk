import { Effect, Fiber } from "effect";
import { Connection } from "../connection.ts";
import { Trigger, TriggerContext } from "./triggers.ts";

export class TriggerRunner {
  private _fibers: Fiber.RuntimeFiber<any, any>[] = [];

  constructor(
    private _triggers: Trigger[],
    private _connection: Connection
  ) {}

  start(): Effect.Effect<void, Error> {
    const self = this;
    return Effect.gen(function* () {
      if (self._fibers.length > 0) {
        return yield* Effect.fail(new Error("TriggerRunner is already started."));
      }

      for (const t of self._triggers) {
        const ctx = new TriggerContext(self._connection);
        const triggerEffect = Effect.suspend(() => {
          const res = t(ctx);
          if (Effect.isEffect(res)) {
            return res as any;
          } else if (res && typeof res.then === "function") {
            return Effect.promise(() => res);
          }
          return Effect.void;
        });

        const triggerWithName = Effect.catchAllCause(triggerEffect, (cause) => {
          console.error(`Trigger '${t.name || "unknown"}' failed with unhandled exception:`, cause);
          return Effect.void;
        }) as any;

        const fiber = yield* Effect.forkDaemon(triggerWithName);
        self._fibers.push(fiber);
      }
    }) as any;
  }

  stop(): Effect.Effect<void, Error> {
    const self = this;
    return Effect.gen(function* () {
      if (self._fibers.length === 0) {
        return;
      }
      for (const fiber of self._fibers) {
        yield* Fiber.interrupt(fiber);
      }
      self._fibers = [];
    });
  }

  get isRunning(): boolean {
    return this._fibers.length > 0;
  }
}

