import { Connection } from "../connection.ts";
import { Effect } from "effect";

export class ToolContext {
  private state = new Map<string, any>();

  constructor(private connection: Connection) {}

  get conversationId(): string {
    return this.connection.conversationId();
  }

  get isIdle(): boolean {
    return this.connection.isIdle();
  }

  async send(message: string): Promise<void> {
    return Effect.runPromise(this.connection.sendTriggerNotification(message));
  }

  getState(key: string, defaultValue?: any): any {
    if (this.state.has(key)) {
      return this.state.get(key);
    }
    return defaultValue;
  }

  setState(key: string, value: any): void {
    this.state.set(key, value);
  }
}
