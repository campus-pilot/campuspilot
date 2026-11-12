import { questionPaperProviderJsonSchema } from '@campuspilot/question-paper/provider-schema';
import { questionPaper } from '@campuspilot/question-paper/schema';
import { describe, expect, it } from 'vitest';

import { adaptGeminiResponseSchema, countProperties, GEMINI_SCHEMA_LIMITS, jsonDepth, toGeminiResponseSchema } from './gemini-schema';

type Json = Record<string, any>;

function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => keysOf(item, into));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      into.add(key);
      keysOf(item, into);
    }
  }
  return into;
}

describe('toGeminiResponseSchema', () => {
  it('rewrites const without touching a property called const, and expands references', () => {
    expect(
      toGeminiResponseSchema({
        $defs: { flag: { type: 'boolean', const: true }, kind: { type: 'string', const: 'text' } },
        type: 'object',
        properties: { const: { type: 'string' }, flag: { $ref: '#/$defs/flag' }, kind: { $ref: '#/$defs/kind' } },
      }),
    ).toEqual({
      type: 'object',
      properties: { const: { type: 'string' }, flag: { type: 'boolean' }, kind: { type: 'string', enum: ['text'] } },
    });
  });

  it('refuses a reference cycle', () => {
    expect(() => toGeminiResponseSchema({ $defs: { a: { $ref: '#/$defs/a' } }, $ref: '#/$defs/a' })).toThrow(/Recursive/);
  });

  it('relaxes the deepest optional subtree to an open schema, never a required one', () => {
    const deep = (levels: number): Json => (levels === 0 ? { type: 'string' } : { type: 'object', properties: { next: deep(levels - 1), list: { type: 'array', items: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' }, c: { type: 'string' } } } } } });
    const result = adaptGeminiResponseSchema(deep(20), { maxDepth: 30, maxProperties: 1000 });
    expect(jsonDepth(result.schema)).toBeLessThanOrEqual(30);
    expect(result.relaxed.length).toBeGreaterThan(0);
    const requiredChain = (levels: number): Json => (levels === 0 ? { type: 'string' } : { type: 'object', properties: { next: requiredChain(levels - 1) }, required: ['next'] });
    expect(() => adaptGeminiResponseSchema(requiredChain(20), { maxDepth: 10, maxProperties: 1000 })).toThrow(/too complex/);
  });
});

/**
 * Pins the cause of the first real Gemini call failing with
 * `400 INVALID_ARGUMENT`: the expanded question paper schema was 36 levels
 * deep and had about 880 declared properties (limits: 30 and about 200).
 */
describe('the question paper schema for Gemini', () => {
  const { schema, relaxed } = adaptGeminiResponseSchema(questionPaperProviderJsonSchema());
  const root = schema as Json;

  it('is within the limits measured against the real API', () => {
    expect(jsonDepth(schema)).toBeLessThanOrEqual(GEMINI_SCHEMA_LIMITS.maxDepth);
    expect(countProperties(schema)).toBeLessThanOrEqual(GEMINI_SCHEMA_LIMITS.maxProperties);
    expect(GEMINI_SCHEMA_LIMITS.maxProperties).toBeLessThanOrEqual(170);
    expect(jsonDepth(schema)).toBeLessThanOrEqual(20);
  });

  it('is fully expanded, without const', () => {
    const keys = keysOf(schema);
    expect(keys.has('$ref')).toBe(false);
    expect(keys.has('$defs')).toBe(false);
    expect(keys.has('const')).toBe(false);
  });

  it('keeps the top levels typed: questions, their text, options, parts and marks', () => {
    const question = root.properties.sections.items.properties.questions.items.properties as Json;
    expect(Object.keys(question)).toEqual(expect.arrayContaining(['number', 'type', 'text', 'marks', 'blocks', 'options', 'parts', 'alternatives']));
    expect(question.type.enum).toContain('mcq');
    // Blocks (figures, tables) are relaxed to an open array at this budget; the prompt describes them.
    expect(question.blocks.type).toBe('array');
    expect(Object.keys(question.options.items.properties)).toEqual(expect.arrayContaining(['label', 'text']));
    expect(Object.keys(question.parts.items.properties)).toEqual(expect.arrayContaining(['label', 'text', 'marks']));
  });

  it('relaxes only optional content below the parts', () => {
    expect(relaxed.length).toBeGreaterThan(0);
    for (const path of relaxed) expect(path).toMatch(/caption$|blocks$|options$|parts$|\.(widthPct)$/);
    expect(relaxed).not.toContain('$.sections[].questions[].options');
    expect(relaxed).not.toContain('$.sections[].questions[].parts');
  });

  it('still describes a valid minimal paper', () => {
    const paper = { schemaVersion: 1, meta: { language: 'hi', script: 'devanagari', direction: 'ltr' }, sections: [{ questions: [{ number: '1', type: 'short_answer', text: [{ t: 'text', v: 'सिद्ध कीजिए' }, { t: 'math', tex: 'x^2' }], marks: 2 }] }] };
    expect(questionPaper.safeParse(paper).success).toBe(true);
  });
});
