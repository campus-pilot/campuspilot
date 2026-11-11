import Anthropic from '@anthropic-ai/sdk';

import type { AssistantUserMessageBody } from '@campuspilot/db/schema/assistant';
import { buildUserTranscriptContent } from '../../transcript';
import type { AssistantPrompt } from '../prompt';
import { modelToolDescription, type AssistantTool } from '../tools';
import type {
  ModelFailureKind,
  ModelProvider,
  ModelStepInput,
  ModelStepResult,
  ModelToolResult,
  ModelToolUse,
  ModelUsage,
} from './types';
import { withBilledUsage } from './types';

/**
 * Claude through the Anthropic API, with every feature the Claude-only build
 * uses: deferred advanced tools behind server-side tool search, automatic
 * prompt caching, explicit effort and server-side refusal fallback.
 */

/** The stable instructions, then the per-conversation facts, as system blocks. */
export function buildAnthropicSystem(
  prompt: AssistantPrompt,
): Anthropic.Beta.Messages.BetaTextBlockParam[] {
  return [
    { type: 'text', text: prompt.instructions },
    { type: 'text', text: prompt.facts },
  ];
}

/**
 * Tool definitions in the API's stable order: core tools loaded up front, the
 * rest deferred and found through BM25 tool search, which appends schemas
 * instead of changing the tool list so the prompt cache survives.
 */
export function buildAnthropicTools(
  tools: readonly AssistantTool[],
): Anthropic.Beta.Messages.BetaToolUnion[] {
  const definitions: Anthropic.Beta.Messages.BetaToolUnion[] = tools.map((tool) => ({
    name: tool.modelName,
    description: modelToolDescription(tool),
    input_schema: tool.inputSchema as Anthropic.Beta.Messages.BetaTool.InputSchema,
    ...(tool.exposure === 'core' ? {} : { defer_loading: true }),
  }));
  if (tools.some((tool) => tool.exposure !== 'core')) {
    definitions.push({ type: 'tool_search_tool_bm25_20251119', name: 'tool_search_tool_bm25' });
  }
  return definitions;
}

/** One model response, reduced to JSON that a Restate journal can hold. */
export type AssistantModelResponse = {
  content: Anthropic.Beta.Messages.BetaContentBlock[];
  stopReason: Anthropic.Beta.Messages.BetaStopReason | null;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
  };
};

export type StreamAssistantResponseInput = {
  client: Anthropic;
  model: string;
  system: Anthropic.Beta.Messages.BetaTextBlockParam[];
  tools: Anthropic.Beta.Messages.BetaToolUnion[];
  messages: Anthropic.Beta.Messages.BetaMessageParam[];
  /** Receives the accumulated visible text, at most every `flushIntervalMs`. */
  onText: (text: string) => void;
  isStopRequested: () => Promise<boolean>;
  flushIntervalMs?: number;
  stopPollIntervalMs?: number;
};

export type StreamAssistantResponseResult =
  | { stopped: false; response: AssistantModelResponse; text: string }
  | { stopped: true; text: string; partialUsage: ModelUsage | null; model: string | null };

/** Visible text of a response: its text blocks, separated by blank lines. */
export function responseText(content: Anthropic.Beta.Messages.BetaContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.Beta.Messages.BetaTextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n\n');
}

/**
 * Streams one model response. Text is coalesced before it is handed on, as
 * T3 Code coalesces provider deltas, so the browser receives at most one
 * frame per interval instead of one per token. A stop request aborts the
 * stream and returns the text produced so far.
 *
 * Request choices: Claude Opus 5.5 always thinks, so effort is the depth
 * control and is set explicitly (`medium`; its default changed between
 * models). Server-side refusal fallback is enabled with the `default` route.
 * Top-level automatic caching caches the growing conversation prefix.
 */
/**
 * The exact Claude API request for one step. Kept as a pure function so a
 * test pins it: the swappable build must send Claude precisely what the
 * Claude-only build sends.
 */
export function buildAnthropicRequest({
  model,
  system,
  tools,
  messages,
}: {
  model: string;
  system: Anthropic.Beta.Messages.BetaTextBlockParam[];
  tools: Anthropic.Beta.Messages.BetaToolUnion[];
  messages: Anthropic.Beta.Messages.BetaMessageParam[];
}): Parameters<Anthropic['beta']['messages']['stream']>[0] {
  return {
    model,
    max_tokens: 64_000,
    system,
    tools,
    messages,
    output_config: { effort: 'medium' },
    cache_control: { type: 'ephemeral' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  };
}

export async function streamAssistantResponse({
  client,
  model,
  system,
  tools,
  messages,
  onText,
  isStopRequested,
  flushIntervalMs = 60,
  stopPollIntervalMs = 750,
}: StreamAssistantResponseInput): Promise<StreamAssistantResponseResult> {
  const stream = client.beta.messages.stream(
    buildAnthropicRequest({ model, system, tools, messages }),
  );

  let text = '';
  let flushed = '';
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    flushTimer = null;
    if (text !== flushed) {
      flushed = text;
      onText(text);
    }
  };

  // Usage as the stream reports it (`message_start`, then `message_delta`),
  // so a stopped request still says what it had used.
  let partialUsage: ModelUsage | null = null;
  let answeringModel: string | null = null;
  stream.on('streamEvent', (event) => {
    if (event.type === 'message_start') {
      answeringModel = event.message.model;
      partialUsage = {
        inputTokens: event.message.usage.input_tokens,
        outputTokens: event.message.usage.output_tokens,
        cacheReadInputTokens: event.message.usage.cache_read_input_tokens ?? 0,
        cacheCreationInputTokens: event.message.usage.cache_creation_input_tokens ?? 0,
      };
    } else if (event.type === 'message_delta' && partialUsage) {
      partialUsage = { ...partialUsage, outputTokens: event.usage.output_tokens };
    }
    if (event.type === 'content_block_start' && event.content_block.type === 'text' && text) {
      text += '\n\n';
    } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      text += event.delta.text;
      flushTimer ??= setTimeout(flush, flushIntervalMs);
    }
  });

  let stopped = false;
  const stopPoll = setInterval(() => {
    void isStopRequested().then((requested) => {
      if (requested && !stopped) {
        stopped = true;
        stream.abort();
      }
    });
  }, stopPollIntervalMs);

  try {
    const message = await stream.finalMessage();
    return {
      stopped: false,
      text: responseText(message.content),
      response: {
        content: message.content,
        stopReason: message.stop_reason,
        model: message.model,
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
          cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
          cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
        },
      },
    };
  } catch (error) {
    if (stopped && error instanceof Anthropic.APIUserAbortError) {
      return { stopped: true, text, partialUsage, model: answeringModel };
    }
    // A stream that broke after `message_start` was billed for what it reported.
    const reported = partialUsage as ModelUsage | null;
    if (reported && typeof error === 'object' && error !== null) {
      throw withBilledUsage(error, { usage: reported, complete: false, model: answeringModel });
    }
    throw error;
  } finally {
    clearInterval(stopPoll);
    if (flushTimer) clearTimeout(flushTimer);
  }
}

/** HTTP statuses the Claude API uses for rate limits and overload. */
const ANTHROPIC_BUSY_STATUSES: ReadonlySet<number> = new Set([429, 503, 529]);

/** Classifies a Claude API error by its SDK error class and HTTP status. */
export function anthropicFailureKind(error: unknown): ModelFailureKind {
  if (error instanceof Anthropic.BadRequestError) return 'rejected';
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError ||
    error instanceof Anthropic.NotFoundError
  ) {
    return 'unavailable';
  }
  if (error instanceof Anthropic.APIError && error.status !== undefined && ANTHROPIC_BUSY_STATUSES.has(error.status)) {
    return 'busy';
  }
  return 'unknown';
}

function toolUsesOf(content: readonly unknown[]): ModelToolUse[] {
  return content.flatMap((block) => {
    const candidate = block as { type?: string; id?: string; name?: string; input?: unknown };
    return candidate.type === 'tool_use' && candidate.id && candidate.name
      ? [{ id: candidate.id, name: candidate.name, input: candidate.input }]
      : [];
  });
}

export function createAnthropicProvider({ apiKey, model }: { apiKey: string; model: string }): ModelProvider {
  const client = new Anthropic({ apiKey });
  return {
    id: 'anthropic',
    model,
    async step({ prompt, tools, transcript, onText, isStopRequested }: ModelStepInput): Promise<ModelStepResult> {
      const result = await streamAssistantResponse({
        client,
        model,
        system: buildAnthropicSystem(prompt),
        tools: buildAnthropicTools(tools),
        messages: transcript as Anthropic.Beta.Messages.BetaMessageParam[],
        onText,
        isStopRequested,
      });
      if (result.stopped) return { stopped: true, text: result.text, partialUsage: result.partialUsage, model: result.model };
      const { response } = result;
      return {
        stopped: false,
        text: result.text,
        refusal: response.stopReason === 'refusal',
        paused: response.stopReason === 'pause_turn',
        toolUses: toolUsesOf(response.content),
        content: response.content,
        model: response.model,
        usage: response.usage,
      };
    },
    userContent: (body: AssistantUserMessageBody) => buildUserTranscriptContent(body),
    assistantTextContent: (text) => [{ type: 'text', text }],
    toolResultsContent: (results: readonly ModelToolResult[]) =>
      results.map((result) => ({
        type: 'tool_result',
        tool_use_id: result.toolUseId,
        content: result.content,
        ...(result.isError ? { is_error: true } : {}),
      })),
    toolUsesOf,
    failureKind: anthropicFailureKind,
  };
}
