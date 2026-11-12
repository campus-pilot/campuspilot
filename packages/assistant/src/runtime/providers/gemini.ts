import { randomUUID } from 'node:crypto';

import {
  ApiError,
  FinishReason,
  GoogleGenAI,
  MediaResolution,
  type Content,
  type GenerateContentConfig,
  type FunctionDeclaration,
  type GenerateContentResponseUsageMetadata,
  type Part,
} from '@google/genai';

import type { AssistantUserMessageBody } from '@campuspilot/db/schema/assistant';
import { buildUserTranscriptContent, isAttachmentMarker, type AttachmentMarker } from '../../transcript';
import { attachmentLabel, attachmentNote } from '../context';
import type { AssistantPrompt } from '../prompt';
import { modelToolDescription, type AssistantTool } from '../tools';
import type {
  AttachmentFile,
  ContextAdapter,
  ModelFailureKind,
  ModelProvider,
  ModelStepInput,
  ModelStepResult,
  ModelToolResult,
  ModelToolUse,
  ModelUsage,
  TextPart,
  TextRequest,
  TextResult,
} from './types';
import { GEMINI_IMAGE_MIME_TYPES } from './image-types';
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
  FinishReason.IMAGE_SAFETY,
  FinishReason.IMAGE_PROHIBITED_CONTENT,
]);

export { GEMINI_IMAGE_MIME_TYPES };

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

/**
 * Pruning and attachment rules of Gemini's transcript (design G3). A human
 * turn is a user entry without `functionResponse` parts. Only the text of a
 * response's `output`/`error` changes when it is stubbed: `id` and `name`
 * stay, so every `functionCall` keeps its response; call parts and thought
 * signatures are never touched.
 */
export const geminiContext: ContextAdapter = {
  isHumanTurn: (entry) => entry.role === 'user' && !(entry.content as Part[]).some((part) => part.functionResponse),
  toolNamesByUseId(entries) {
    const names = new Map<string, string>();
    for (const entry of entries) {
      for (const part of entry.content as Part[]) {
        if (part.functionCall?.id && part.functionCall.name) names.set(part.functionCall.id, part.functionCall.name);
      }
    }
    return names;
  },
  stubToolResults(entry, toolNames, stub, minChars) {
    if (!(entry.content as Part[]).some((part) => part.functionResponse)) return entry;
    return {
      ...entry,
      content: (entry.content as Part[]).map((part) => {
        const response = part.functionResponse;
        if (!response) return part;
        const body = (response.response ?? {}) as { output?: unknown; error?: unknown };
        const key = typeof body.error === 'string' ? 'error' : 'output';
        const text = typeof body[key] === 'string' ? (body[key] as string) : JSON.stringify(body[key] ?? '');
        if (text.length < minChars) return part;
        const toolName = response.name ?? toolNames.get(response.id ?? '') ?? 'a tool';
        return { ...part, functionResponse: { ...response, response: { [key]: stub({ toolName, chars: text.length }) } } };
      }),
    };
  },
  materializeAttachment(marker: AttachmentMarker, file: AttachmentFile) {
    if (file.kind !== 'image') return [{ text: attachmentNote(marker, file.kind) }];
    if (!GEMINI_IMAGE_MIME_TYPES.some((supported) => supported === file.mimeType)) {
      return [{ text: attachmentNote(marker, 'unreadable') }];
    }
    return [{ text: attachmentLabel(marker) }, { inlineData: { mimeType: file.mimeType, data: Buffer.from(file.bytes).toString('base64') } }];
  },
  stubAttachment: (marker) => [{ text: attachmentNote(marker, 'old') }],
};

/** A user message as Gemini parts: text blocks become `{ text }`, attachment markers stay markers (replaced per request). */
export function geminiUserContent(body: AssistantUserMessageBody): unknown[] {
  return buildUserTranscriptContent(body).map((block) => (isAttachmentMarker(block) ? block : { text: (block as { text: string }).text }));
}

function geminiPartOf(part: TextPart): Part {
  if (part.type === 'text') return { text: part.text };
  if (!GEMINI_IMAGE_MIME_TYPES.some((supported) => supported === part.mimeType)) {
    throw new Error(`Gemini cannot read ${part.mimeType} images.`);
  }
  return { inlineData: { mimeType: part.mimeType, data: Buffer.from(part.data).toString('base64') } };
}

/**
 * The Gemini request of a one-shot text request (pinned by a test): plain
 * text out, no JSON mode and no response schema.
 * High media resolution is requested because handwriting is read from
 * photographs. Thinking and caching stay at the model's defaults.
 */
export function buildGeminiTextRequest(model: string, input: TextRequest) {
  const config: GenerateContentConfig = {
    systemInstruction: input.system,
    maxOutputTokens: input.maxOutputTokens,
    mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
    ...(input.signal ? { abortSignal: input.signal } : {}),
  };
  return {
    model,
    contents: [{ role: 'user', parts: input.parts.map(geminiPartOf) }] satisfies Content[],
    config,
  };
}

/**
 * Runs a one-shot text request. It streams (like `step`) rather than
 * waiting for one response: a long answer then survives idle-connection
 * limits, and a stream that breaks after its first usage report still says
 * what it was billed for.
 */
export async function generateGeminiText(client: GoogleGenAI, model: string, input: TextRequest): Promise<TextResult> {
  const parts: Part[] = [];
  let usage: GenerateContentResponseUsageMetadata | undefined;
  let finishReason: FinishReason | undefined;
  let blocked = false;
  let modelVersion = model;
  try {
    const stream = await client.models.generateContentStream(buildGeminiTextRequest(model, input));
    for await (const chunk of stream) {
      const candidate = chunk.candidates?.[0];
      if (candidate?.content?.parts) parts.push(...candidate.content.parts);
      finishReason = candidate?.finishReason ?? finishReason;
      if (chunk.promptFeedback?.blockReason) blocked = true;
      usage = chunk.usageMetadata ?? usage;
      modelVersion = chunk.modelVersion ?? modelVersion;
    }
  } catch (error) {
    if (usage && typeof error === 'object' && error !== null) {
      throw withBilledUsage(error, { usage: normalizeGeminiUsage(usage), complete: false, model: modelVersion });
    }
    throw error;
  }
  return {
    text: geminiVisibleText(parts),
    model: modelVersion,
    usage: normalizeGeminiUsage(usage),
    refusal: blocked || (finishReason !== undefined && REFUSAL_REASONS.has(finishReason)),
    truncated: finishReason === FinishReason.MAX_TOKENS,
  };
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
    imageMimeTypes: GEMINI_IMAGE_MIME_TYPES,
    generateText: (input) => generateGeminiText(client, model, input),
    step,
    context: geminiContext,
    userContent: geminiUserContent,
    assistantTextContent: (text) => [{ text }],
    toolResultsContent: geminiToolResultParts,
    toolUsesOf,
    failureKind: geminiFailureKind,
  };
}
