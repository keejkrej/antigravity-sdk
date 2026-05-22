import * as path from "node:path";
import * as fs from "node:fs";

export interface GeminiConfig {
  apiKey?: string;
  baseUrl?: string;
  modelName?: string;
  thinkingLevel?: string;
  enableUrlContext?: boolean;
  enableGoogleSearch?: boolean;
}

export interface GemmaConfig {
  baseUrl?: string;
  modelName?: string;
}

export interface CustomSystemInstructions {
  part?: { text: string }[];
}

export interface AppendedSystemInstructions {
  customIdentity?: string;
  appendedSections?: { title: string; content: string }[];
}

export interface SystemInstructions {
  custom?: CustomSystemInstructions;
  appended?: AppendedSystemInstructions;
}

export interface Tool {
  name: string;
  description: string;
  parametersJsonSchema?: string;
  responseJsonSchema?: string;
}

export interface FindToolConfig {
  enabled?: boolean;
}

export interface RunCommandToolConfig {
  enabled?: boolean;
}

export interface SubagentsConfig {
  enabled?: boolean;
}

export interface UserQuestionsConfig {
  enabled?: boolean;
}

export interface FileEditToolConfig {
  enabled?: boolean;
}

export interface ViewFileToolConfig {
  enabled?: boolean;
}

export interface WriteToFileToolConfig {
  enabled?: boolean;
}

export interface GrepSearchToolConfig {
  enabled?: boolean;
}

export interface ListDirToolConfig {
  enabled?: boolean;
}

export interface PermissionsConfig {
  enforceWorkspaceValidation?: boolean;
}

export interface GenerateImageToolConfig {
  enabled?: boolean;
  modelName?: string;
}

export interface HarnessSideTools {
  find?: FindToolConfig;
  runCommand?: RunCommandToolConfig;
  subagents?: SubagentsConfig;
  userQuestions?: UserQuestionsConfig;
  fileEdit?: FileEditToolConfig;
  viewFile?: ViewFileToolConfig;
  writeToFile?: WriteToFileToolConfig;
  grepSearch?: GrepSearchToolConfig;
  listDir?: ListDirToolConfig;
  permissions?: PermissionsConfig;
  generateImage?: GenerateImageToolConfig;
}

export interface FilesystemWorkspace {
  directory: string;
}

export interface Workspace {
  filesystemWorkspace?: FilesystemWorkspace;
}

export interface HarnessConfig {
  cascadeId?: string;
  geminiConfig?: GeminiConfig;
  gemmaConfig?: GemmaConfig;
  systemInstructions?: SystemInstructions;
  tools?: Tool[];
  harnessSideTools?: HarnessSideTools;
  compactionThreshold?: number;
  workspaces?: Workspace[];
  skillsPaths?: string[];
  finishToolSchemaJson?: string;
  initialTrajectory?: string; // base64 bytes or hex
  appDataDir?: string;
}

export interface InitializeConversationEvent {
  config?: HarnessConfig;
}

export enum StepState {
  STATE_UNSPECIFIED = 0,
  STATE_ACTIVE = 1,
  STATE_DONE = 2,
  STATE_WAITING_FOR_USER = 3,
  STATE_ERROR = 4,
}

export enum ProtoStepSource {
  SOURCE_UNSPECIFIED = 0,
  SOURCE_SYSTEM = 1,
  SOURCE_USER = 2,
  SOURCE_MODEL = 3,
}

export enum ProtoStepTarget {
  TARGET_UNSPECIFIED = 0,
  TARGET_USER = 1,
  TARGET_MODEL = 2,
  TARGET_ENVIRONMENT = 3,
}

export interface ActionRunCommand {
  commandLine: string;
  workingDir?: string;
  exitCode?: number;
  combinedOutput?: string;
}

export interface ActionViewFile {
  filePath: string;
  startLine?: number;
  endLine?: number;
}

export interface ActionFinish {
  outputString?: string;
}

export interface MultipleChoice {
  question: string;
  choices: string[];
  isMultiSelect?: boolean;
}

export interface UserQuestion {
  multipleChoice?: MultipleChoice;
}

export interface UserQuestionsRequest {
  questions: UserQuestion[];
}

export interface ToolConfirmationRequest {
  // Can be empty or hold additional parameters
}

export interface StepUpdate {
  cascadeId?: string;
  trajectoryId?: string;
  stepIndex?: number;
  state?: StepState;
  source?: ProtoStepSource;
  target?: ProtoStepTarget;
  errorMessage?: string;
  thinking?: string;
  textDelta?: string;
  thinkingDelta?: string;
  text?: string;
  runCommand?: ActionRunCommand;
  viewFile?: ActionViewFile;
  questionsRequest?: UserQuestionsRequest;
  toolConfirmationRequest?: ToolConfirmationRequest;
  finish?: ActionFinish;
}

export enum TrajectoryState {
  STATE_UNSPECIFIED = 0,
  STATE_RUNNING = 1,
  STATE_IDLE = 2,
}

export interface TrajectoryStateUpdate {
  trajectoryId: string;
  state: TrajectoryState;
}

export interface ToolCall {
  id: string;
  name: string;
  argumentsJson?: string;
  canonicalPath?: string;
  args?: Record<string, any>;
}

export interface UsageMetadata {
  promptTokenCount?: number;
  cachedContentTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
}

export interface OutputEvent {
  seqNum?: number | string;
  timestampMicros?: number | string;
  stepUpdate?: StepUpdate;
  trajectoryStateUpdate?: TrajectoryStateUpdate;
  toolCall?: ToolCall;
  usageMetadata?: UsageMetadata;
}

export interface Media {
  mimeType: string;
  description?: string;
  data: string; // base64 encoded
}

export interface UserInputPart {
  text?: string;
  media?: Media;
}

export interface UserInput {
  parts: UserInputPart[];
}

export interface ToolConfirmation {
  trajectoryId: string;
  stepIndex: number;
  accepted: boolean;
}

export interface ToolResponse {
  id: string;
  responseJson: string;
}

export interface MultipleChoiceAnswer {
  selectedChoiceIndices: number[];
  freeformResponse?: string;
}

export interface UserQuestionAnswer {
  unanswered?: boolean;
  multipleChoiceAnswer?: MultipleChoiceAnswer;
}

export interface UserQuestionsResponse {
  trajectoryId: string;
  stepIndex: number;
  cancelled?: boolean;
  response?: {
    answers: UserQuestionAnswer[];
  };
}

export interface InputEvent {
  userInput?: string;
  complexUserInput?: UserInput;
  toolConfirmation?: ToolConfirmation;
  toolResponse?: ToolResponse;
  questionResponse?: UserQuestionsResponse;
  haltRequest?: boolean;
  automatedTrigger?: string;
}

export enum BuiltinTools {
  LIST_DIR = "list_directory",
  SEARCH_DIR = "search_directory",
  FIND_FILE = "find_file",
  VIEW_FILE = "view_file",
  CREATE_FILE = "create_file",
  EDIT_FILE = "edit_file",
  RUN_COMMAND = "run_command",
  ASK_QUESTION = "ask_question",
  START_SUBAGENT = "start_subagent",
  GENERATE_IMAGE = "generate_image",
  FINISH = "finish",
}

export const BuiltinToolsHelpers = {
  readOnly(): BuiltinTools[] {
    return [
      BuiltinTools.LIST_DIR,
      BuiltinTools.SEARCH_DIR,
      BuiltinTools.FIND_FILE,
      BuiltinTools.VIEW_FILE,
      BuiltinTools.FINISH,
    ];
  },
  nondestructive(): BuiltinTools[] {
    return [
      BuiltinTools.LIST_DIR,
      BuiltinTools.SEARCH_DIR,
      BuiltinTools.FIND_FILE,
      BuiltinTools.VIEW_FILE,
      BuiltinTools.CREATE_FILE,
      BuiltinTools.EDIT_FILE,
      BuiltinTools.ASK_QUESTION,
      BuiltinTools.START_SUBAGENT,
      BuiltinTools.GENERATE_IMAGE,
      BuiltinTools.FINISH,
    ];
  },
  allTools(): BuiltinTools[] {
    return Object.values(BuiltinTools);
  },
  fileTools(): BuiltinTools[] {
    return [
      BuiltinTools.VIEW_FILE,
      BuiltinTools.CREATE_FILE,
      BuiltinTools.EDIT_FILE,
    ];
  }
};

export interface CapabilitiesConfig {
  enableSubagents?: boolean;
  enabledTools?: BuiltinTools[];
  disabledTools?: BuiltinTools[];
  compactionThreshold?: number;
  imageModel?: string;
  finishToolSchemaJson?: string;
}

export interface McpStdioServer {
  type: "stdio";
  command: string;
  args?: string[];
}

export interface McpSseServer {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
}

export interface McpStreamableHttpServer {
  type: "http";
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
  sseReadTimeout?: number;
  terminateOnClose?: boolean;
}

export type McpServerConfig = McpStdioServer | McpSseServer | McpStreamableHttpServer;

export interface HookResult {
  allow: boolean;
  message?: string;
}

export interface QuestionResponse {
  selectedOptionIds?: string[];
  freeformResponse?: string;
  skipped?: boolean;
}

export interface QuestionHookResult {
  responses: QuestionResponse[];
  cancelled?: boolean;
}

export interface AskQuestionOption {
  id: string;
  text: string;
}

export interface AskQuestionEntry {
  question: string;
  options: AskQuestionOption[];
  isMultiSelect?: boolean;
}

export interface AskQuestionInteractionSpec {
  questions: AskQuestionEntry[];
}

export enum TriggerDelivery {
  SEND_IMMEDIATELY = "send_immediately",
  WAIT_IDLE = "wait_idle",
}

export enum FileChangeKind {
  ADDED = "added",
  MODIFIED = "modified",
  DELETED = "deleted",
}

export interface FileChange {
  kind: FileChangeKind;
  path: string;
}

export interface StreamChunk {
  stepIndex: number;
}

export interface Thought extends StreamChunk {
  type: "thought";
  text: string;
  signature?: string;
}

export interface Text extends StreamChunk {
  type: "text";
  text: string;
}

export interface ToolResult {
  name: BuiltinTools | string;
  id?: string;
  result?: any;
  error?: string;
  exception?: Error;
}

// Media attachment types and guesser

export const SUPPORTED_IMAGE_MIMES = new Set([
  "image/bmp",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const SUPPORTED_DOCUMENT_MIMES = new Set([
  "application/pdf",
  "application/json",
  "text/css",
  "text/csv",
  "text/html",
  "text/javascript",
  "text/plain",
  "text/rtf",
  "text/xml",
]);

export const SUPPORTED_AUDIO_MIMES = new Set([
  "audio/wav",
  "audio/mp3",
  "audio/aac",
  "audio/ogg",
  "audio/flac",
  "audio/opus",
  "audio/mpeg",
  "audio/m4a",
  "audio/l16",
]);

export const SUPPORTED_VIDEO_MIMES = new Set([
  "video/3gpp",
  "video/avi",
  "video/mp4",
  "video/mpeg",
  "video/mpg",
  "video/quicktime",
  "video/webm",
  "video/wmv",
  "video/x-flv",
]);

const EXTENSION_TO_MIME: Record<string, string> = {
  ".bmp": "image/bmp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".json": "application/json",
  ".css": "text/css",
  ".csv": "text/csv",
  ".html": "text/html",
  ".htm": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".ts": "text/plain",
  ".txt": "text/plain",
  ".text": "text/plain",
  ".md": "text/plain",
  ".rtf": "text/rtf",
  ".xml": "text/xml",
  ".wav": "audio/wav",
  ".mp3": "audio/mp3",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".opus": "audio/opus",
  ".m4a": "audio/m4a",
  ".3gp": "video/3gpp",
  ".avi": "video/avi",
  ".mp4": "video/mp4",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".wmv": "video/wmv",
  ".flv": "video/x-flv",
};

export function guessMimeType(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_TO_MIME[ext];
}

export class _BaseMedia implements Media {
  readonly mimeType: string;
  readonly description?: string;
  readonly data: string; // base64 encoded

  constructor(data: string, mimeType: string, description?: string) {
    this.data = data;
    this.mimeType = mimeType;
    this.description = description;
  }
}

export class Image extends _BaseMedia {
  constructor(data: string, mimeType: string, description?: string) {
    if (!SUPPORTED_IMAGE_MIMES.has(mimeType)) {
      throw new Error(`Unsupported Image MIME type: '${mimeType}'`);
    }
    super(data, mimeType, description);
  }
}

export class Document extends _BaseMedia {
  constructor(data: string, mimeType: string, description?: string) {
    if (!SUPPORTED_DOCUMENT_MIMES.has(mimeType)) {
      throw new Error(`Unsupported Document MIME type: '${mimeType}'`);
    }
    super(data, mimeType, description);
  }
}

export class Audio extends _BaseMedia {
  constructor(data: string, mimeType: string, description?: string) {
    if (!SUPPORTED_AUDIO_MIMES.has(mimeType)) {
      throw new Error(`Unsupported Audio MIME type: '${mimeType}'`);
    }
    super(data, mimeType, description);
  }
}

export class Video extends _BaseMedia {
  constructor(data: string, mimeType: string, description?: string) {
    if (!SUPPORTED_VIDEO_MIMES.has(mimeType)) {
      throw new Error(`Unsupported Video MIME type: '${mimeType}'`);
    }
    super(data, mimeType, description);
  }
}

export type ContentPrimitive = string | Image | Document | Audio | Video;
export type Content = ContentPrimitive | ContentPrimitive[];

export function fromFile(filePath: string, description?: string): Image | Document | Audio | Video {
  let buffer: Buffer;
  try {
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      throw new Error(`Path is a directory, not a file: '${filePath}'`);
    }
    buffer = fs.readFileSync(filePath);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw new Error(`File not found at path: '${filePath}'`);
    }
    if (err.code === 'EACCES') {
      throw new Error(`Permission denied when reading path: '${filePath}'`);
    }
    throw err;
  }

  const mimeType = guessMimeType(filePath);
  if (!mimeType) {
    throw new Error(`Could not infer a valid MIME type for extension: '${path.extname(filePath)}'`);
  }

  const dataStr = buffer.toString("base64");

  if (SUPPORTED_IMAGE_MIMES.has(mimeType)) {
    return new Image(dataStr, mimeType, description);
  }
  if (SUPPORTED_DOCUMENT_MIMES.has(mimeType)) {
    return new Document(dataStr, mimeType, description);
  }
  if (SUPPORTED_AUDIO_MIMES.has(mimeType)) {
    return new Audio(dataStr, mimeType, description);
  }
  if (SUPPORTED_VIDEO_MIMES.has(mimeType)) {
    return new Video(dataStr, mimeType, description);
  }

  throw new Error(`Unsupported MIME type: '${mimeType}'`);
}

export enum StepType {
  TEXT_RESPONSE = "TEXT_RESPONSE",
  TOOL_CALL = "TOOL_CALL",
  SYSTEM_MESSAGE = "SYSTEM_MESSAGE",
  COMPACTION = "COMPACTION",
  FINISH = "FINISH",
  UNKNOWN = "UNKNOWN",
}

export enum StepSource {
  SYSTEM = "SYSTEM",
  USER = "USER",
  MODEL = "MODEL",
  UNKNOWN = "UNKNOWN",
}

export enum StepTarget {
  USER = "TARGET_USER",
  ENVIRONMENT = "TARGET_ENVIRONMENT",
  UNSPECIFIED = "TARGET_UNSPECIFIED",
  UNKNOWN = "UNKNOWN",
}

export enum StepStatus {
  ACTIVE = "ACTIVE",
  DONE = "DONE",
  WAITING_FOR_USER = "WAITING_FOR_USER",
  ERROR = "ERROR",
  CANCELED = "CANCELED",
  UNKNOWN = "UNKNOWN",
}

export interface Step {
  id: string;
  stepIndex: number;
  type: StepType;
  source: StepSource;
  target: StepTarget;
  status: StepStatus;
  content: string;
  contentDelta: string;
  thinking: string;
  thinkingDelta: string;
  toolCalls: ToolCall[];
  error: string;
  isCompleteResponse: boolean | null;
  structuredOutput: any | null;
  usageMetadata?: UsageMetadata;
  cascadeId?: string;
  trajectoryId?: string;
  httpCode?: number;
}

export class RunCommandResult {
  constructor(readonly output: string = "") {}
  toString(): string {
    return this.output;
  }
}

export interface ListDirectoryEntry {
  name: string;
  isDirectory: boolean;
  fileSize: number;
}

export class ListDirectoryResult {
  constructor(readonly entries: ListDirectoryEntry[] = []) {}
  toString(): string {
    return this.entries
      .map(e => e.isDirectory ? `${e.name}/ (dir)` : `${e.name} (${e.fileSize} bytes)`)
      .join("\n");
  }
}

export class SearchDirectoryResult {
  constructor(readonly numResults: number = 0) {}
  toString(): string {
    return `${this.numResults} results`;
  }
}

export class FindFileResult {
  constructor(readonly output: string = "") {}
  toString(): string {
    return this.output;
  }
}

export class EditFileResult {
  constructor(readonly summary: string = "") {}
  toString(): string {
    return this.summary;
  }
}

export class GenerateImageResult {
  constructor(readonly imageName: string = "") {}
  toString(): string {
    return this.imageName;
  }
}

export class TextResult {
  constructor(readonly text: string = "") {}
  toString(): string {
    return this.text;
  }
}

export type ToolOutput =
  | RunCommandResult
  | ListDirectoryResult
  | SearchDirectoryResult
  | FindFileResult
  | EditFileResult
  | GenerateImageResult
  | TextResult;



