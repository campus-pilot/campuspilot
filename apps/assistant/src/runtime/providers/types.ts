import type { AssistantUserMessageBody } from '../../db/schema';
import type { AssistantPrompt } from '../prompt';
import type { AssistantTool } from '../tools';

/**
 * The seam between the agent loop and a model provider (after T3 Code's
 * provider adapters). The loop only sees neutral results: visible text, tool
 * calls and usage. Everything provider-specific stays inside the adapter:
 * request shape, native features (tool search, caching, effort, fallbacks,
 * thought signatures), and the transcript format. Nothing is reduced to a
 * common subset, so each provider runs as well as it would on its own.
 */

/** Providers the assistant can run on. Each conversation records its own. */
export const MODEL_PROVIDER_IDS = ['anthropic', 'gemini'] as const;
export type ModelProviderId = (typeof MODEL_PROVIDER_IDS)[number];

/** One transcript entry in the provider's own content format. */
export type TranscriptEntry = { role: 'user' | 'assistant'; content: unknown[] };

export type ModelToolUse = { id: string; name: string; input: unknown };

export type ModelToolResult = {
  toolUseId: string;
  /** The model-facing tool name the call used. */
  toolName: string;
  content: string;
  isError: boolean;
};

/**
 * Token usage in one shape for every provider, so school limits and the
 * benchmark compare like with like. `inputTokens` excludes cache reads, as
 * the Claude API reports it; adapters normalise to that.
 */
export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
};

export type ModelStepInput = {
  prompt: AssistantPrompt;
  /** Every tool the assistant may use, in the API's stable order. */
  tools: readonly AssistantTool[];
  /** The conversation so far, in this provider's format. */
  transcript: readonly TranscriptEntry[];
  /** Receives the accumulated visible text, coalesced. */
  onText: (text: string) => void;
  isStopRequested: () => Promise<boolean>;
};

export type ModelStepResult =
  | { stopped: true; text: string }
  | {
      stopped: false;
      text: string;
      /** The provider declined to answer; that turn's tool calls must not run. */
      refusal: boolean;
      /** The provider paused a server-side loop and expects to be resumed. */
      paused: boolean;
      toolUses: ModelToolUse[];
      /** The response, in this provider's format, to append to the transcript. */
      content: unknown[];
      /** The model that actually served the response. */
      model: string;
      usage: ModelUsage;
    };

export interface ModelProvider {
  readonly id: ModelProviderId;
  /** The model this provider is configured to call. */
  readonly model: string;
  step(input: ModelStepInput): Promise<ModelStepResult>;
  /** A user message as transcript content. */
  userContent(body: AssistantUserMessageBody): unknown[];
  /** Partial text kept after a stop, as assistant transcript content. */
  assistantTextContent(text: string): unknown[];
  /** Tool results as the user turn that answers them. */
  toolResultsContent(results: readonly ModelToolResult[]): unknown[];
  /** Tool calls inside a saved response, for a step replayed after a crash. */
  toolUsesOf(content: readonly unknown[]): ModelToolUse[];
  /** Errors no retry can fix, such as a rejected request or a bad key. */
  isPermanentError(error: unknown): boolean;
}
