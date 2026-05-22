import { Context, Effect, Stream } from "effect";
import * as Types from "./types.ts";

/**
 * Interface representing an active session with the agent execution engine.
 */
export interface Connection {
  readonly isIdle: () => boolean;
  readonly conversationId: () => string;
  readonly send: (prompt: Types.Content | null) => Effect.Effect<void, Error>;
  readonly receiveSteps: () => Stream.Stream<Types.Step, Error>;
  readonly sendToolResults: (results: Types.ToolResponse[]) => Effect.Effect<void, Error>;
  readonly sendQuestionResponse: (response: Types.UserQuestionsResponse) => Effect.Effect<void, Error>;
  readonly sendToolConfirmation: (confirmation: Types.ToolConfirmation) => Effect.Effect<void, Error>;
  readonly sendTriggerNotification: (content: string) => Effect.Effect<void, Error>;
  readonly cancel: () => Effect.Effect<void, Error>;
  readonly disconnect: () => Effect.Effect<void, Error>;
  readonly delete: () => Effect.Effect<void, Error>;
  readonly signalIdle: () => Effect.Effect<void, Error>;
  readonly waitForIdle: () => Effect.Effect<void, Error>;
  readonly waitForWakeup: (timeoutMs: number) => Effect.Effect<boolean, Error>;
}

/**
 * Service Tag for dependency injection of the Connection service.
 */
export const Connection = Context.GenericTag<Connection>("antigravity/Connection");

/**
 * Strategy for establishing a Connection to a backend.
 */
export interface ConnectionStrategy {
  readonly connect: () => Effect.Effect<Connection, Error>;
}

/**
 * Configuration options for initializing an Antigravity Agent.
 */
export interface AgentConfig {
  systemInstructions?: string | Types.SystemInstructions;
  capabilities?: Types.CapabilitiesConfig;
  tools?: any[]; // custom JS/TS tool definitions
  policies?: any[];
  hooks?: any[];
  triggers?: any[];
  workspaces?: string[];
  conversationId?: string;
  saveDir?: string;
  appDataDir?: string;
  skillsPaths?: string[];
  geminiConfig?: Types.GeminiConfig;
  responseSchema?: any;
  mcpServers?: Types.McpServerConfig[];
}
export const AgentConfig = Context.GenericTag<AgentConfig>("antigravity/AgentConfig");
