import type { AssistantUserMessageBody } from '@campuspilot/db/schema/assistant';
import type { AttachmentMarker } from '../../transcript';
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

/** One part of a one-shot request's single user turn. */
export type TextPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data: Uint8Array };

/**
 * A one-shot plain text request with images in the input (question paper
 * generation: the answer is an HTML fragment). One request, no tools, no
 * structured-output mode, no streaming to a UI, no transcript: the caller owns
 * everything around it, including finding the fragment in the text.
 */
export type TextRequest = {
  system: string;
  /** The user turn, in order. */
  parts: readonly TextPart[];
  maxOutputTokens: number;
  signal?: AbortSignal;
};

export type TextResult = {
  /** The answer's text as returned, unparsed (it may sit inside a Markdown code fence). */
  text: string;
  /** The model that actually answered. */
  model: string;
  usage: ModelUsage;
  /** The provider declined to answer (safety or policy); `text` may be empty. */
  refusal: boolean;
  /** The answer stopped on the output-token limit, so `text` is cut off. */
  truncated: boolean;
};

/**
 * The bytes of an attached image as a model request will carry them, or why
 * they cannot be carried (the note then replaces the image; an image is never
 * silently dropped, decision D46).
 */
export type AttachmentFile =
  | { kind: 'image'; bytes: Uint8Array; mimeType: string }
  | { kind: 'unreadable' }
  | { kind: 'missing' }
  /** Left out so the request stays within the image budget. */
  | { kind: 'omitted' };

/** A tool result found in a stored entry, for pruning. */
export type ToolResultStubInput = { toolName: string; chars: number };

/**
 * How `buildModelContext` (runtime/context.ts) reads and rewrites this
 * provider's stored transcript. Everything format-specific lives here, so the
 * pruning algorithm itself is one function for every provider.
 */
export interface ContextAdapter {
  /** A user entry that carries the person's words or images, not just tool results. */
  isHumanTurn(entry: TranscriptEntry): boolean;
  /** Model-facing tool name by tool call id, for every call in the transcript. */
  toolNamesByUseId(entries: readonly TranscriptEntry[]): Map<string, string>;
  /**
   * The entry with every tool result of at least `minChars` characters
   * replaced by `stub`'s text. Only a result's content changes: the entry,
   * its ids and the calls they answer stay exactly as they were.
   */
  stubToolResults(
    entry: TranscriptEntry,
    toolNames: ReadonlyMap<string, string>,
    stub: (result: ToolResultStubInput) => string,
    minChars: number,
  ): TranscriptEntry;
  /** The parts that show an attachment to the model: a label, then the image or a note. */
  materializeAttachment(marker: AttachmentMarker, file: AttachmentFile): unknown[];
  /** The part that tells the model an older attachment is no longer shown. */
  stubAttachment(marker: AttachmentMarker): unknown[];
}

export interface ModelProvider {
  readonly id: ModelProviderId;
  /** Media types this provider can read as image input (D46: never silently dropped). */
  readonly imageMimeTypes: readonly string[];
  /** The largest single image the provider accepts, in bytes before base64; absent when only the request total is limited. */
  readonly maxImageBytes?: number;
  /**
   * The model this provider is configured to call now. A conversation stays
   * on its provider, not on a model: changing the configured model moves
   * every conversation of this provider to it from their next message.
   */
  readonly model: string;
  step(input: ModelStepInput): Promise<ModelStepResult>;
  /**
   * One plain text request (see {@link TextRequest}). Throws
   * like `step`: an error whose billed usage, when the provider reported any,
   * is attached with {@link withBilledUsage}, and which `failureKind` classifies.
   * It runs on `model`: a caller that wants another model for this kind of
   * request creates its own provider with it (see `question-paper-model.ts`).
   */
  generateText(input: TextRequest): Promise<TextResult>;
  /** Reads and rewrites this provider's transcript for each request (pruning, attachments). */
  readonly context: ContextAdapter;
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

/**
 * What a failed request had used, when the provider reported usage before it
 * failed (for example a Gemini response that ended in a malformed function
 * call, or a stream that broke after its first usage report). Such a request
 * is billed, so the loop saves it before the step is retried. `complete`
 * says whether this is the provider's final usage for the response or only
 * what it had reported so far; it is never inferred from the numbers.
 */
export type FailedRequestUsage = { usage: ModelUsage; complete: boolean; model: string | null };

const billedUsage = new WeakMap<object, FailedRequestUsage>();

/** Attaches a failed request's usage to the error the adapter throws. */
export function withBilledUsage<E extends object>(error: E, billed: FailedRequestUsage): E {
  billedUsage.set(error, billed);
  return error;
}

/** The usage attached to a failed request's error, or null when the provider reported none. */
export function billedUsageOf(error: unknown): FailedRequestUsage | null {
  return typeof error === 'object' && error !== null ? (billedUsage.get(error) ?? null) : null;
}
