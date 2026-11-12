import Anthropic from '@anthropic-ai/sdk';
import { FinishReason, type GoogleGenAI } from '@google/genai';
import { describe, expect, it } from 'vitest';

import { ANTHROPIC_IMAGE_MIME_TYPES, buildAnthropicStructuredRequest, generateAnthropicStructured } from './anthropic';
import { createFakeProvider, fakeStructuredResult, FakeModelError } from './fake';
import {
  buildGeminiStructuredRequest,
  GEMINI_IMAGE_MIME_TYPES,
  generateGeminiStructured,
  toGeminiResponseSchema,
} from './gemini';
import { billedUsageOf, type StructuredRequest } from './types';

const request: StructuredRequest = {
  system: 'Transcribe.',
  parts: [
    { type: 'text', text: 'Page 1 of 2' },
    { type: 'image', mimeType: 'image/jpeg', data: new Uint8Array([1, 2, 3]) },
  ],
  jsonSchema: { type: 'object', properties: { schemaVersion: { type: 'number', const: 1 } } },
  maxOutputTokens: 32_000,
};

describe('anthropic structured request', () => {
  it('sends the pages as base64 images with the schema as the output format', () => {
    expect(buildAnthropicStructuredRequest('claude-test', request)).toEqual({
      model: 'claude-test',
      max_tokens: 32_000,
      system: 'Transcribe.',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Page 1 of 2' },
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AQID' } },
          ],
        },
      ],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: request.jsonSchema } },
    });
  });

  it('cannot read HEIC and refuses to send it as something else', () => {
    expect(ANTHROPIC_IMAGE_MIME_TYPES).not.toContain('image/heic');
    expect(() =>
      buildAnthropicStructuredRequest('claude-test', { ...request, parts: [{ type: 'image', mimeType: 'image/heic', data: new Uint8Array() }] }),
    ).toThrow(/cannot read image\/heic/);
  });

  function clientWith(final: () => Promise<unknown>, events: unknown[] = []) {
    const stream = {
      on(_name: string, listener: (event: unknown) => void) {
        for (const event of events) listener(event);
        return stream;
      },
      finalMessage: final,
    };
    return { beta: { messages: { stream: () => stream } } } as unknown as Anthropic;
  }

  it('maps the final message: text, model, usage, truncation and refusal', async () => {
    const message = (stopReason: string) => ({
      content: [{ type: 'text', text: '{"a":1}' }],
      model: 'claude-test-20261101',
      stop_reason: stopReason,
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 3, cache_creation_input_tokens: null },
    });
    const done = await generateAnthropicStructured(clientWith(async () => message('end_turn')), 'claude-test', request);
    expect(done).toEqual({
      text: '{"a":1}',
      model: 'claude-test-20261101',
      usage: { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 3, cacheCreationInputTokens: 0 },
      refusal: false,
      truncated: false,
    });
    expect((await generateAnthropicStructured(clientWith(async () => message('max_tokens')), 'm', request)).truncated).toBe(true);
    expect((await generateAnthropicStructured(clientWith(async () => message('refusal')), 'm', request)).refusal).toBe(true);
  });

  it('attaches the usage a broken stream had reported to its error', async () => {
    const events = [
      { type: 'message_start', message: { model: 'claude-test-1', usage: { input_tokens: 900, output_tokens: 1 } } },
      { type: 'message_delta', delta: {}, usage: { output_tokens: 40 } },
    ];
    const error = new Error('stream broke');
    const failure = await generateAnthropicStructured(clientWith(() => Promise.reject(error), events), 'm', request).catch((e: unknown) => e);
    expect(failure).toBe(error);
    expect(billedUsageOf(error)).toEqual({
      usage: { inputTokens: 900, outputTokens: 40, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
      complete: false,
      model: 'claude-test-1',
    });
  });
});

describe('gemini structured request', () => {
  it('sends inline images, JSON mode, the schema and high media resolution', () => {
    const built = buildGeminiStructuredRequest('gemini-test', request);
    expect(built.model).toBe('gemini-test');
    expect(built.contents).toEqual([
      { role: 'user', parts: [{ text: 'Page 1 of 2' }, { inlineData: { mimeType: 'image/jpeg', data: 'AQID' } }] },
    ]);
    expect(built.config).toEqual({
      systemInstruction: 'Transcribe.',
      responseMimeType: 'application/json',
      responseJsonSchema: { type: 'object', properties: { schemaVersion: { type: 'number', enum: [1] } } },
      maxOutputTokens: 32_000,
      mediaResolution: 'MEDIA_RESOLUTION_HIGH',
    });
  });

  it('reads HEIC and HEIF, which the Claude API cannot', () => {
    expect(GEMINI_IMAGE_MIME_TYPES).toEqual(expect.arrayContaining(['image/heic', 'image/heif']));
    expect(() =>
      buildGeminiStructuredRequest('m', { ...request, parts: [{ type: 'image', mimeType: 'image/gif', data: new Uint8Array() }] }),
    ).toThrow(/cannot read image\/gif/);
  });

  it('rewrites const for the response schema without touching a property called const', () => {
    expect(
      toGeminiResponseSchema({
        $defs: { flag: { type: 'boolean', const: true }, kind: { type: 'string', const: 'text' } },
        properties: { const: { type: 'string' } },
      }),
    ).toEqual({
      $defs: { flag: { type: 'boolean' }, kind: { type: 'string', enum: ['text'] } },
      properties: { const: { type: 'string' } },
    });
  });

  function clientWith(chunks: unknown[], failAfter?: Error) {
    return {
      models: {
        generateContentStream: async () =>
          (async function* () {
            for (const chunk of chunks) yield chunk;
            if (failAfter) throw failAfter;
          })(),
      },
    } as unknown as GoogleGenAI;
  }

  it('joins the visible text and maps usage, truncation and refusal', async () => {
    const usageMetadata = { promptTokenCount: 100, cachedContentTokenCount: 40, candidatesTokenCount: 20, thoughtsTokenCount: 5 };
    const chunk = (finishReason: FinishReason) => [
      { candidates: [{ content: { parts: [{ text: 'hidden', thought: true }, { text: '{"a":' }] } }], modelVersion: 'gemini-test-001' },
      { candidates: [{ content: { parts: [{ text: '1}' }] }, finishReason }], usageMetadata },
    ];
    const done = await generateGeminiStructured(clientWith(chunk(FinishReason.STOP)), 'gemini-test', request);
    expect(done).toEqual({
      text: '{"a":1}',
      model: 'gemini-test-001',
      usage: { inputTokens: 60, outputTokens: 25, cacheReadInputTokens: 40, cacheCreationInputTokens: 0 },
      refusal: false,
      truncated: false,
    });
    expect((await generateGeminiStructured(clientWith(chunk(FinishReason.MAX_TOKENS)), 'm', request)).truncated).toBe(true);
    expect((await generateGeminiStructured(clientWith(chunk(FinishReason.IMAGE_SAFETY)), 'm', request)).refusal).toBe(true);
    expect((await generateGeminiStructured(clientWith([{ promptFeedback: { blockReason: 'SAFETY' } }]), 'm', request)).refusal).toBe(true);
  });

  it('attaches reported usage to a stream that broke', async () => {
    const error = new Error('stream broke');
    const failure = await generateGeminiStructured(
      clientWith([{ candidates: [{ content: { parts: [{ text: '{' }] } }], usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 2 } }], error),
      'm',
      request,
    ).catch((e: unknown) => e);
    expect(failure).toBe(error);
    expect(billedUsageOf(error)).toMatchObject({ usage: { inputTokens: 50, outputTokens: 2 }, complete: false });
  });
});

describe('the fake provider', () => {
  it('answers structured requests from its own script and records them', async () => {
    const fake = createFakeProvider({ model: 'fake-m' });
    fake.enqueueStructured(fakeStructuredResult({ text: '{"ok":true}' }), new FakeModelError('busy', 'later'));
    expect((await fake.generateStructured(request)).text).toBe('{"ok":true}');
    const failure = await fake.generateStructured(request).catch((e: unknown) => e);
    expect(fake.failureKind(failure)).toBe('busy');
    expect(fake.structuredCalls.map((call) => call.model)).toEqual(['fake-m', 'fake-m']);
    await expect(fake.generateStructured(request)).rejects.toThrow(/exhausted/);
  });
});
