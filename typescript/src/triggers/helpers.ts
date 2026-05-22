import * as fs from "node:fs";
import * as path from "node:path";
import { Effect } from "effect";
import { Trigger, TriggerContext } from "./triggers.ts";
import * as Types from "../types.ts";

export function every(
  intervalSeconds: number,
  callback: (ctx: TriggerContext) => Effect.Effect<void, any, any> | Promise<void> | void
): Trigger {
  if (intervalSeconds <= 0) {
    throw new Error(`intervalSeconds must be positive, got ${intervalSeconds}`);
  }

  const triggerFn = (ctx: TriggerContext) => {
    return Effect.async<void, Error, never>((resume) => {
      const interval = setInterval(() => {
        try {
          const cbResult = callback(ctx);
          if (Effect.isEffect(cbResult)) {
            Effect.runFork(cbResult as any);
          } else if (cbResult && typeof (cbResult as any).then === "function") {
            (cbResult as Promise<void>).catch((err) =>
              console.error("Error in every callback:", err)
            );
          }
        } catch (err) {
          console.error("Error in every callback synchronous execution:", err);
        }
      }, intervalSeconds * 1000);

      return Effect.sync(() => {
        clearInterval(interval);
      });
    });
  };

  Object.defineProperty(triggerFn, "name", {
    value: `every_${intervalSeconds}s`,
    writable: true,
  });
  return triggerFn;
}

export function onFileChange(
  watchPath: string,
  callback: (
    ctx: TriggerContext,
    changes: Types.FileChange[]
  ) => Effect.Effect<void, any, any> | Promise<void> | void
): Trigger {
  const triggerFn = (ctx: TriggerContext) => {
    const absoluteWatchPath = path.resolve(watchPath);

    return Effect.async<void, Error, never>((resume) => {
      let watcher: fs.FSWatcher | null = null;
      try {
        const isDir = fs.existsSync(absoluteWatchPath) && fs.statSync(absoluteWatchPath).isDirectory();
        watcher = fs.watch(
          absoluteWatchPath,
          { recursive: isDir },
          (eventType, filename) => {
            if (!filename) return;
            const fullPath = isDir ? path.join(absoluteWatchPath, filename) : absoluteWatchPath;
            let kind = Types.FileChangeKind.MODIFIED;
            if (eventType === "rename") {
              if (fs.existsSync(fullPath)) {
                kind = Types.FileChangeKind.ADDED;
              } else {
                kind = Types.FileChangeKind.DELETED;
              }
            }
            const change: Types.FileChange = {
              kind,
              path: fullPath,
            };

            try {
              const cbResult = callback(ctx, [change]);
              if (Effect.isEffect(cbResult)) {
                Effect.runFork(cbResult as any);
              } else if (cbResult && typeof (cbResult as any).then === "function") {
                (cbResult as Promise<void>).catch((err) =>
                  console.error("Error in onFileChange callback:", err)
                );
              }
            } catch (err) {
              console.error("Error in onFileChange callback synchronous execution:", err);
            }
          }
        );
      } catch (err: any) {
        resume(Effect.fail(err));
        return;
      }

      return Effect.sync(() => {
        if (watcher) {
          watcher.close();
        }
      });
    });
  };

  const baseName = path.basename(watchPath);
  Object.defineProperty(triggerFn, "name", {
    value: `onFileChange_${baseName}`,
    writable: true,
  });
  return triggerFn;
}
