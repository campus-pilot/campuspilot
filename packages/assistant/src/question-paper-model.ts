import type { QuestionPaperModel } from '@campuspilot/api/workflows/question-paper/model';

import { createAnthropicProvider } from './runtime/providers/anthropic';
import { questionPaperSettings, type QuestionPaperSettings } from './runtime/providers/config';
import { createGeminiProvider } from './runtime/providers/gemini';
import { billedUsageOf, type ModelProvider } from './runtime/providers/types';

/**
 * Adapts a provider to the API's `QuestionPaperModel` (the generation job's
 * view of the model, see `workflows/question-paper/model.ts`). Lives outside
 * `src/runtime`: it is not part of the turn loop and never reaches school
 * data, it only forwards one request to the provider.
 */
export function questionPaperModelOf(provider: ModelProvider, settings: QuestionPaperSettings): QuestionPaperModel {
  return {
    provider: provider.id,
    model: provider.model,
    prices: settings.prices,
    imageMimeTypes: provider.imageMimeTypes,
    generate: async (input) => {
      const result = await provider.generateText({
        system: input.system,
        parts: input.parts,
        maxOutputTokens: input.maxOutputTokens,
      });
      return {
        text: result.text,
        usage: result.usage,
        answeredModel: result.model,
        refusal: result.refusal,
        unfinished: result.unfinished,
      };
    },
    failureKind: (error) => provider.failureKind(error),
    billedUsageOf,
  };
}

/**
 * The process's question paper model from the environment (`QUESTION_PAPER_*`,
 * falling back to the assistant's provider, model and prices), or `undefined`
 * when generation is not configured. The provider is created with the
 * question paper model, so a `QUESTION_PAPER_MODEL` override needs no second
 * code path. Called once at boot by `apps/server` and `apps/worker`, which
 * pass the result to `configureQuestionPaperModel`.
 */
export function createQuestionPaperModel(): QuestionPaperModel | undefined {
  const settings = questionPaperSettings();
  if (!settings) return undefined;
  const create = settings.id === 'anthropic' ? createAnthropicProvider : createGeminiProvider;
  return questionPaperModelOf(create({ apiKey: settings.apiKey, model: settings.model }), settings);
}
