import { randomUUID } from 'node:crypto';

import {
  ApiError,
  FinishReason,
  GoogleGenAI,
  type Content,
  type FunctionDeclaration,
  type GenerateContentResponseUsageMetadata,
  type Part,
} from '@google/genai';

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
 * Gemini through the Gemini API (`@google/genai`), using its own conventions
 * rather than Claude's:
 * - Transcript entries are Gemini `Part` lists, kept exactly as returned so
 *   thought signatures go back unchanged, as Gemini requires for multi-step
 *   function calling.
 * - Gemini has no server-side tool search, so every allowed tool is declared
 *   on each request (`parametersJsonSchema`, the API's JSON Schema form).
 * - Thinking and implicit caching are the model's defaults; neither needs
 *   request flags.
 */

/** Finish reasons meaning the model declined, so that turn's calls must not run. */
const REFUSAL_REASONS: ReadonlySet<FinishReason> = new Set([
  FinishReason.SAFETY,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
  FinishReason.RECITATION,
]);

/** A malformed call is the model's mistake; the step is retried rather than failed. */
class MalformedFunctionCallError extends Error {}

export function buildGeminiSystemInstruction(prompt: AssistantPrompt): string {
  return `${prompt.instructions}\n\n${prompt.facts}`;
}

export function buildGeminiTools(tools: readonly AssistantTool[]): FunctionDeclaration[] {
  return tools.map((tool) => ({
    name: tool.modelName,
    description: modelToolDescription(tool),
    parametersJsonSchema: tool.inputSchema,
  }));
}

export function toGeminiContents(transcript: ModelStepInput['transcript']): Content[] {
  return transcript.map((entry) => ({
    role: entry.role === 'assistant' ? 'model' : 'user',
    parts: entry.content as Part[],
  }));
}

/**
 * Gemini usage in the shared shape. `promptTokenCount` includes cached
 * tokens, so they are moved out of `inputTokens`; thinking tokens are billed
 * as output. Implicit caching has no write charge, so creation stays 0.
 */
export function normalizeGeminiUsage(usage: GenerateContentResponseUsageMetadata | undefined): ModelUsage {
  const cached = usage?.cachedContentTokenCount ?? 0;
  return {
    inputTokens: Math.max(0, (usage?.promptTokenCount ?? 0) - cached),
    outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
    cacheReadInputTokens: cached,
    cacheCreationInputTokens: 0,
  };
}

/** Visible text: non-thought text parts, in order. */
export function geminiVisibleText(parts: readonly Part[]): string {
  return parts
    .filter((part) => typeof part.text === 'string' && !part.thought)
    .map((part) => part.text)
    .join('');
}

/**
 * Gives every function call an id (the Gemini API may omit it) so results can
 * be matched back, and drops parts that carry nothing.
 */
export function prepareGeminiParts(parts: readonly Part[]): Part[] {
  return parts
    .filter((part) => Object.keys(part).length > 0)
    .map((part) =>
      part.functionCall && !part.functionCall.id
        ? { ...part, functionCall: { ...part.functionCall, id: `call_${randomUUID()}` } }
        : part,
    );
}

function toolUsesOf(content: readonly unknown[]): ModelToolUse[] {
  return (content as Part[]).flatMap((part) =>
    part.functionCall?.name && part.functionCall.id
      ? [{ id: part.functionCall.id, name: part.functionCall.name, input: part.functionCall.args ?? {} }]
      : [],
  );
}

export function geminiToolResultParts(results: readonly ModelToolResult[]): Part[] {
  return results.map((result) => ({
    functionResponse: {
      id: result.toolUseId,
      name: result.toolName,
      response: result.isError ? { error: result.content } : { output: result.content },
    },
  }));
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /abort/i.test(error.message));
}

/**
 * Classifies a Gemini API error by HTTP status. 429 covers both a
 * per-minute rate limit and an exhausted quota or spending cap; the API
 * reports them the same way, so both are `busy`.
 */
export function geminiFailureKind(error: unknown): ModelFailureKind {
  if (!(error instanceof ApiError)) return 'unknown';
  if (error.status === 400) return 'rejected';
  if (error.status === 401 || error.status === 403 || error.status === 404) return 'unavailable';
  if (error.status === 429 || error.status === 503) return 'busy';
  return 'unknown';
}

export function createGeminiProvider({ apiKey, model }: { apiKey: string; model: string }): ModelProvider {
  const client = new GoogleGenAI({ apiKey });

  async function step({
    prompt,
    tools,
    transcript,
    onText,
    isStopRequested,
  }: ModelStepInput): Promise<ModelStepResult> {
    const controller = new AbortController();
    let stopped = false;
    const stopPoll = setInterval(() => {
      void isStopRequested().then((requested) => {
        if (requested && !stopped) {
          stopped = true;
          controller.abort();
        }
      });
    }, 750);

    const parts: Part[] = [];
    let usage: GenerateContentResponseUsageMetadata | undefined;
    let finishReason: FinishReason | undefined;
    let blocked = false;
    let modelVersion = model;
    let flushed = '';
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      flushTimer = null;
      const text = geminiVisibleText(parts);
      if (text !== flushed) {
        flushed = text;
        onText(text);
      }
    };

    try {
      const stream = await client.models.generateContentStream({
        model,
        contents: toGeminiContents(transcript),
        config: {
          systemInstruction: buildGeminiSystemInstruction(prompt),
          tools: [{ functionDeclarations: buildGeminiTools(tools) }],
          abortSignal: controller.signal,
        },
      });
      for await (const chunk of stream) {
        const candidate = chunk.candidates?.[0];
        if (candidate?.content?.parts) {
          parts.push(...candidate.content.parts);
          flushTimer ??= setTimeout(flush, 60);
        }
        finishReason = candidate?.finishReason ?? finishReason;
        if (chunk.promptFeedback?.blockReason) blocked = true;
        usage = chunk.usageMetadata ?? usage;
        modelVersion = chunk.modelVersion ?? modelVersion;
      }
    } catch (error) {
      if (stopped && isAbort(error)) {
        // Gemini reports usage on stream chunks; keep what arrived before the abort.
        return {
          stopped: true,
          text: geminiVisibleText(parts),
          partialUsage: usage ? normalizeGeminiUsage(usage) : null,
          model: usage ? modelVersion : null,
        };
      }
      // A stream that broke after a usage report was billed for that much.
      if (usage && typeof error === 'object' && error !== null) {
        throw withBilledUsage(error, { usage: normalizeGeminiUsage(usage), complete: false, model: modelVersion });
      }
      throw error;
    } finally {
      clearInterval(stopPoll);
      if (flushTimer) clearTimeout(flushTimer);
    }

    if (finishReason === FinishReason.MALFORMED_FUNCTION_CALL) {
      // The response finished, so its usage is final and billed even though
      // the step is retried.
      const error = new MalformedFunctionCallError('Gemini returned a malformed function call.');
      throw usage ? withBilledUsage(error, { usage: normalizeGeminiUsage(usage), complete: true, model: modelVersion }) : error;
    }
    const content = prepareGeminiParts(parts);
    const refusal = blocked || (finishReason !== undefined && REFUSAL_REASONS.has(finishReason));
    return {
      stopped: false,
      text: geminiVisibleText(content),
      refusal,
      paused: false,
      toolUses: toolUsesOf(content),
      content,
      model: modelVersion,
      usage: normalizeGeminiUsage(usage),
    };
  }

  return {
    id: 'gemini',
    model,
    step,
    userContent: (body: AssistantUserMessageBody) =>
      buildUserTranscriptContent(body).map((block) => ({ text: (block as { text: string }).text })),
    assistantTextContent: (text) => [{ text }],
    toolResultsContent: geminiToolResultParts,
    toolUsesOf,
    failureKind: geminiFailureKind,
  };
}
