import type { AssistantUserMessageBody } from '@campuspilot/db/schema/assistant';
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
  | {
      stopped: true;
      text: string;
      /**
       * The usage the provider had reported before the stop, or null when it
       * reported none. Never the final usage: the request was abandoned, so
       * what it is billed for may be more.
       */
      partialUsage: ModelUsage | null;
      /** The model that was answering, when the provider said so before the stop. */
      model: string | null;
    }
  | {
      stopped: false;
      text: string;
      /**
       * The provider declined to answer; that turn's tool calls must not run.
       * The loop enforces this for every provider: it drops the calls and
       * saves only the visible text, so adapters need not filter them.
       */
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

/**
 * How a failed model request should be treated. Each kind is its own fact
 * about the failure, read from the provider's error, never guessed from
 * another kind:
 * - `rejected`: the provider refused this request (malformed, too long).
 *   Sending the same request again cannot work.
 * - `unavailable`: the key, its permissions or the model id are wrong.
 *   Nothing works until an operator fixes the configuration.
 * - `busy`: rate limit, quota or overload. Worth a few retries; if they all
 *   fail the user is told to try later.
 * - `unknown`: anything else. Retried, then reported as a generic failure.
 */
export type ModelFailureKind = 'rejected' | 'unavailable' | 'busy' | 'unknown';

export interface ModelProvider {
  readonly id: ModelProviderId;
  /**
   * The model this provider is configured to call now. A conversation stays
   * on its provider, not on a model: changing the configured model moves
   * every conversation of this provider to it from their next message.
   */
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
  /** Classifies an error thrown by `step`, so the loop knows whether to retry. */
  failureKind(error: unknown): ModelFailureKind;
}
