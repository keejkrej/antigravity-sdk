import { Effect, Stream } from "effect";
import * as Types from "../types.ts";
import { Connection, ConnectionStrategy } from "../connection.ts";

function zeroUsage(): Types.UsageMetadata {
  return {
    promptTokenCount: 0,
    cachedContentTokenCount: 0,
    candidatesTokenCount: 0,
    thoughtsTokenCount: 0,
    totalTokenCount: 0,
  };
}

function addUsage(target: Types.UsageMetadata, source: Types.UsageMetadata): void {
  target.promptTokenCount = (target.promptTokenCount ?? 0) + (source.promptTokenCount ?? 0);
  target.cachedContentTokenCount = (target.cachedContentTokenCount ?? 0) + (source.cachedContentTokenCount ?? 0);
  target.candidatesTokenCount = (target.candidatesTokenCount ?? 0) + (source.candidatesTokenCount ?? 0);
  target.thoughtsTokenCount = (target.thoughtsTokenCount ?? 0) + (source.thoughtsTokenCount ?? 0);
  target.totalTokenCount = (target.totalTokenCount ?? 0) + (source.totalTokenCount ?? 0);
}

function isThought(chunk: any): chunk is Types.Thought {
  return chunk && chunk.type === "thought";
}
function isText(chunk: any): chunk is Types.Text {
  return chunk && chunk.type === "text";
}
function isToolCall(chunk: any): chunk is Types.ToolCall {
  return chunk && !chunk.type && (chunk.name !== undefined || chunk.args !== undefined);
}

export class ChatResponse implements AsyncIterable<string> {
  private _bufferedChunks: (Types.Thought | Types.Text | Types.ToolCall)[] = [];
  private _isDone = false;
  private _streamError: any = null;
  private _pullLock = false;

  constructor(
    private _chunkStream: AsyncIterator<Types.Thought | Types.Text | Types.ToolCall>,
    readonly conversation: Conversation
  ) {}

  private async acquireLock(): Promise<void> {
    while (this._pullLock) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    this._pullLock = true;
  }

  private releaseLock(): void {
    this._pullLock = false;
  }

  get chunks(): AsyncIterableIterator<Types.Thought | Types.Text | Types.ToolCall> {
    const self = this;
    let pos = 0;
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next() {
        while (true) {
          if (pos < self._bufferedChunks.length) {
            const val = self._bufferedChunks[pos++];
            return { value: val, done: false };
          } else if (self._isDone) {
            if (self._streamError) {
              throw self._streamError;
            }
            return { value: undefined as any, done: true };
          } else {
            await self.acquireLock();
            // Re-check after acquiring
            if (pos < self._bufferedChunks.length || self._isDone) {
              self.releaseLock();
              continue;
            }
            try {
              const res = await self._chunkStream.next();
              if (res.done) {
                self._isDone = true;
              } else {
                self._bufferedChunks.push(res.value);
              }
            } catch (err) {
              self._isDone = true;
              self._streamError = err;
              self.releaseLock();
              throw err;
            }
            self.releaseLock();
          }
        }
      }
    };
  }

  async *[Symbol.asyncIterator](): AsyncIterator<string> {
    for await (const chunk of this.chunks) {
      if (isText(chunk)) {
        yield chunk.text;
      }
    }
  }

  get thoughts(): AsyncIterableIterator<string> {
    const iterator = this.chunks;
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next() {
        while (true) {
          const res = await iterator.next();
          if (res.done) {
            return { value: undefined as any, done: true };
          }
          if (isThought(res.value)) {
            return { value: res.value.text, done: false };
          }
        }
      }
    };
  }

  get toolCalls(): AsyncIterableIterator<Types.ToolCall> {
    const iterator = this.chunks;
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next() {
        while (true) {
          const res = await iterator.next();
          if (res.done) {
            return { value: undefined as any, done: true };
          }
          const val = res.value;
          if (isToolCall(val)) {
            return { value: val, done: false };
          }
        }
      }
    };
  }

  get tool_calls(): AsyncIterableIterator<Types.ToolCall> {
    return this.toolCalls;
  }

  async resolve(): Promise<(Types.Thought | Types.Text | Types.ToolCall)[]> {
    const list: (Types.Thought | Types.Text | Types.ToolCall)[] = [];
    for await (const chunk of this.chunks) {
      list.push(chunk);
    }
    return list;
  }

  async text(): Promise<string> {
    const chunks = await this.resolve();
    return chunks
      .filter(isText)
      .map(c => c.text)
      .join("");
  }

  async structuredOutput(): Promise<any | null> {
    if (!this._isDone) {
      await this.resolve();
    }
    return this.conversation.getLastStructuredOutput();
  }

  get usageMetadata(): Types.UsageMetadata | null {
    return this.conversation.lastTurnUsage;
  }
}

export class Conversation {
  private _steps: Types.Step[] = [];
  private _turnStartIndices: number[] = [];
  private _compactionIndices: number[] = [];
  private _maxHistorySize: number;
  private _cumulativeUsage = zeroUsage();
  private _turnUsage: Types.UsageMetadata | null = null;

  constructor(
    private _connection: Connection,
    options?: { maxHistorySize?: number }
  ) {
    this._maxHistorySize = options?.maxHistorySize ?? 10000;
  }

  static create(
    strategy: ConnectionStrategy,
    options?: { maxHistorySize?: number }
  ): Effect.Effect<Conversation, Error> {
    return Effect.map(strategy.connect(), (conn) => new Conversation(conn, options));
  }

  get history(): Types.Step[] {
    return [...this._steps];
  }

  get lastResponse(): string {
    for (let i = this._steps.length - 1; i >= 0; i--) {
      const step = this._steps[i];
      if (step.isCompleteResponse) {
        return step.content;
      }
    }
    return "";
  }

  get turnCount(): number {
    return this._turnStartIndices.length;
  }

  get compactionIndices(): number[] {
    return [...this._compactionIndices];
  }

  get connection(): Connection {
    return this._connection;
  }

  get isIdle(): boolean {
    return this._connection.isIdle();
  }

  get conversationId(): string {
    return this._connection.conversationId();
  }

  get totalUsage(): Types.UsageMetadata {
    return { ...this._cumulativeUsage };
  }

  get lastTurnUsage(): Types.UsageMetadata | null {
    return this._turnUsage ? { ...this._turnUsage } : null;
  }

  clearHistory(): void {
    this._steps = [];
    this._turnStartIndices = [];
    this._compactionIndices = [];
    this._cumulativeUsage = zeroUsage();
    this._turnUsage = null;
  }

  private _enforceMaxHistory(): void {
    if (this._maxHistorySize > 0 && this._steps.length > this._maxHistorySize) {
      const overflow = this._steps.length - this._maxHistorySize;
      this._steps = this._steps.slice(overflow);
      this._turnStartIndices = this._turnStartIndices
        .map(i => i - overflow)
        .filter(i => i >= 0);
      this._compactionIndices = this._compactionIndices
        .map(i => i - overflow)
        .filter(i => i >= 0);
    }
  }

  private _accumulateUsage(usage: Types.UsageMetadata): void {
    addUsage(this._cumulativeUsage, usage);
    if (!this._turnUsage) {
      this._turnUsage = zeroUsage();
    }
    addUsage(this._turnUsage, usage);
  }

  async send(prompt: Types.Content | null): Promise<void> {
    if (!this._connection.isIdle()) {
      await Effect.runPromise(this._connection.waitForIdle());
    }
    this._turnStartIndices.push(this._steps.length);
    this._turnUsage = null;
    await Effect.runPromise(this._connection.send(prompt));
  }

  receiveSteps(): Stream.Stream<Types.Step, Error> {
    const self = this;
    const rawStream = this._connection.receiveSteps();
    return Stream.map(rawStream, (step) => {
      self._steps.push(step);
      if (step.type === Types.StepType.COMPACTION) {
        self._compactionIndices.push(self._steps.length - 1);
      }
      if (step.usageMetadata) {
        self._accumulateUsage(step.usageMetadata);
      }
      self._enforceMaxHistory();
      return step;
    });
  }

  async *receiveChunks(): AsyncGenerator<Types.Thought | Types.Text | Types.ToolCall, void, unknown> {
    const stream = this.receiveSteps();
    const iterable = Stream.toAsyncIterable(stream);
    const seenToolIds = new Set<string>();

    for await (const step of iterable) {
      const isModel = step.source === Types.StepSource.MODEL;
      const isTargetUser = step.target === Types.StepTarget.USER;

      if (isModel && isTargetUser) {
        if (step.thinkingDelta) {
          yield {
            type: "thought",
            text: step.thinkingDelta,
            stepIndex: step.stepIndex,
          } as Types.Thought;
        }
        if (step.contentDelta) {
          yield {
            type: "text",
            text: step.contentDelta,
            stepIndex: step.stepIndex,
          } as Types.Text;
        }
      }

      if (step.toolCalls) {
        for (const call of step.toolCalls) {
          if (!call.id || !seenToolIds.has(call.id)) {
            if (call.id) {
              seenToolIds.add(call.id);
            }
            yield call;
          }
        }
      }
    }
  }

  getLastStructuredOutput(): any | null {
    for (let i = this._steps.length - 1; i >= 0; i--) {
      const step = this._steps[i];
      if (step.type === Types.StepType.FINISH) {
        return step.structuredOutput;
      }
    }
    return null;
  }

  async chat(prompt: Types.Content | null): Promise<ChatResponse> {
    await this.send(prompt);
    const chunks = this.receiveChunks();
    return new ChatResponse(chunks, this);
  }

  async cancel(): Promise<void> {
    await Effect.runPromise(this._connection.cancel());
  }

  async delete(): Promise<void> {
    await Effect.runPromise(this._connection.delete());
  }

  async signalIdle(): Promise<void> {
    await Effect.runPromise(this._connection.signalIdle());
  }

  async waitForIdle(): Promise<void> {
    await Effect.runPromise(this._connection.waitForIdle());
  }

  async waitForWakeup(timeoutMs = 300000): Promise<boolean> {
    return await Effect.runPromise(this._connection.waitForWakeup(timeoutMs));
  }

  async disconnect(): Promise<void> {
    await Effect.runPromise(this._connection.disconnect());
  }
}
