import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createGeminiDecisionModel } from './gemini-decisions';

/** The SDK's client, replaced by one that records the decision request and answers with `reply`. */
const sdk = vi.hoisted(() => ({ options: [] as unknown[], requests: [] as unknown[], reply: {} as unknown }));

vi.mock('@google/genai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@google/genai')>()),
  GoogleGenAI: class {
    constructor(options: unknown) {
      sdk.options.push(options);
    }
    decisions = {
      create: async (request: unknown) => {
        sdk.requests.push(request);
        return sdk.reply;
      },
    };
  },
}));

const QUESTION = { instructions: 'Is there a diagram?', trueDescription: 'There is one.', falseDescription: 'There is none.' };
const IMAGE = { mimeType: 'image/jpeg', data: new Uint8Array([1, 2, 3]) };

beforeEach(() => {
  sdk.options.length = 0;
  sdk.requests.length = 0;
});

describe('the Gemini decision model', () => {
  it('asks one yes or no question about the images on v1beta and reads the probability and the input tokens', async () => {
    sdk.reply = { answers: { answer: { type: 'noul', noul: 0.87, confidence: 0.87 } }, usage: { total_input_tokens: 1340, total_output_tokens: 0 } };
    const decided = await createGeminiDecisionModel({ apiKey: 'key', model: 'gemini-decision-1' }).decideYesNo([IMAGE, IMAGE], QUESTION);

    expect(sdk.options).toEqual([{ apiKey: 'key', apiVersion: 'v1beta' }]);
    expect(sdk.requests).toEqual([
      {
        model: 'models/gemini-decision-1',
        input: [
          { type: 'image', mime_type: 'image/jpeg', data: 'AQID' },
          { type: 'image', mime_type: 'image/jpeg', data: 'AQID' },
        ],
        questions: {
          answer: { type: 'noul', instructions: 'Is there a diagram?', criteria: { true_description: 'There is one.', false_description: 'There is none.' } },
        },
        api_version: 'v1beta',
      },
    ]);
    expect(decided).toEqual({
      probability: 0.87,
      usage: { inputTokens: 1340, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
      answeredModel: 'gemini-decision-1',
    });
  });

  it('fails when the reply has no yes or no answer', async () => {
    sdk.reply = { answers: {} };
    await expect(createGeminiDecisionModel({ apiKey: 'key', model: 'gemini-decision-1' }).decideYesNo([IMAGE], QUESTION)).rejects.toThrow('no yes or no answer');
  });
});
