import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { buildAssistantPrompt } from '../prompt';
import type { AssistantTool } from '../tools';
import { buildAnthropicRequest, buildAnthropicSystem, buildAnthropicTools, createAnthropicProvider } from './anthropic';
import {
  buildGeminiTools,
  createGeminiProvider,
  geminiVisibleText,
  normalizeGeminiUsage,
  prepareGeminiParts,
  toGeminiContents,
} from './gemini';

const tool = (name: string, exposure: 'core' | 'advanced', readOnly: boolean): AssistantTool => ({
  source: 'mcp',
  modelName: name, mcpName: name.replace('_', '.'), title: 'Title', description: 'Description.',
  inputSchema: { type: 'object', properties: {} }, readOnly, destructive: false, exposure, module: 'students',
});
const facts = { schoolId: 's', schoolName: 'Maple', userName: 'U', userEmail: 'u@x', today: '2026-11-05' };
const results = [
  { toolUseId: 'a', toolName: 'school_listStudents', content: '{"items":[]}', isError: false },
  { toolUseId: 'b', toolName: 'school_updateStudent', content: 'declined', isError: true },
];

describe('anthropic adapter (must match the Claude-only build)', () => {
  it('keeps the request parameters', () => {
    const { system, tools, messages, ...params } = buildAnthropicRequest({
      model: 'claude-opus-5-5', system: [], tools: [], messages: [],
    });
    expect({ system, tools, messages }).toEqual({ system: [], tools: [], messages: [] });
    expect(params).toEqual({
      model: 'claude-opus-5-5',
      max_tokens: 64_000,
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
  });

  it('keeps the prompt text', () => {
    // Pins the prompt text so it only changes on purpose. The Claude-only and
    // Gemini-only builds carry the same instructions; change them together.
    // Last changed for question papers (decision D36): one "call
    // learn_question_paper_generation first" bullet, and the decline rule now
    // says "question papers written from scratch".
    const system = JSON.stringify(buildAnthropicSystem(buildAssistantPrompt(facts)));
    expect(createHash('sha256').update(system).digest('hex').slice(0, 16)).toMatchInlineSnapshot(`"3daf1e125a78ad2a"`);
  });

  it('defers advanced tools behind tool search and labels writes', () => {
    const definitions = buildAnthropicTools([tool('school_get', 'core', true), tool('school_update', 'advanced', false)]);
    expect(definitions).toEqual([
      { name: 'school_get', description: 'Title. Description.', input_schema: { type: 'object', properties: {} } },
      {
        name: 'school_update',
        description:
          'Title. Description.\n\nThis changes school data. When you call it, the user is asked to approve it before it runs.',
        input_schema: { type: 'object', properties: {} },
        defer_loading: true,
      },
      { type: 'tool_search_tool_bm25_20251119', name: 'tool_search_tool_bm25' },
    ]);
  });

  it('writes tool results as tool_result blocks', () => {
    const provider = createAnthropicProvider({ apiKey: 'k', model: 'm' });
    expect(provider.toolResultsContent(results)).toEqual([
      { type: 'tool_result', tool_use_id: 'a', content: '{"items":[]}' },
      { type: 'tool_result', tool_use_id: 'b', content: 'declined', is_error: true },
    ]);
    expect(provider.toolUsesOf([{ type: 'tool_use', id: 't', name: 'n', input: { x: 1 } }, { type: 'text', text: 'hi' }])).toEqual([
      { id: 't', name: 'n', input: { x: 1 } },
    ]);
  });
});

describe('gemini adapter', () => {
  const provider = createGeminiProvider({ apiKey: 'k', model: 'gemini-model' });

  it('declares every tool, since Gemini has no server-side tool search', () => {
    expect(buildGeminiTools([tool('a', 'core', true), tool('b', 'advanced', false)]).map((t) => t.name)).toEqual(['a', 'b']);
  });

  it('maps roles and keeps parts as stored, thought signatures included', () => {
    const parts = [{ text: 'hi', thoughtSignature: 'sig' }];
    expect(toGeminiContents([{ role: 'assistant', content: parts }, { role: 'user', content: [{ text: 'q' }] }])).toEqual([
      { role: 'model', parts },
      { role: 'user', parts: [{ text: 'q' }] },
    ]);
  });

  it('gives function calls ids and returns results as function responses', () => {
    const [call] = prepareGeminiParts([{ functionCall: { name: 'school_get', args: { a: 1 } } }, {}]);
    expect(call?.functionCall?.id).toMatch(/^call_/);
    expect(provider.toolUsesOf([call])).toEqual([{ id: call!.functionCall!.id, name: 'school_get', input: { a: 1 } }]);
    expect(provider.toolResultsContent(results)).toEqual([
      { functionResponse: { id: 'a', name: 'school_listStudents', response: { output: '{"items":[]}' } } },
      { functionResponse: { id: 'b', name: 'school_updateStudent', response: { error: 'declined' } } },
    ]);
  });

  it('normalises usage to the shared shape', () => {
    expect(
      normalizeGeminiUsage({ promptTokenCount: 1000, cachedContentTokenCount: 600, candidatesTokenCount: 50, thoughtsTokenCount: 30 }),
    ).toEqual({ inputTokens: 400, outputTokens: 80, cacheReadInputTokens: 600, cacheCreationInputTokens: 0 });
  });

  it('shows only non-thought text', () => {
    expect(geminiVisibleText([{ text: 'Hel' }, { text: 'secret', thought: true }, { text: 'lo' }])).toBe('Hello');
  });

  it('sends the same user text as the Claude adapter', () => {
    const body = { text: 'Who?', pageContext: { path: '/p' } };
    const claude = createAnthropicProvider({ apiKey: 'k', model: 'm' }).userContent(body) as Array<{ text: string }>;
    expect(provider.userContent(body)).toEqual(claude.map((block) => ({ text: block.text })));
  });
});
