import { GoogleGenAI, type Decisions } from '@google/genai';

import { GEMINI_API_VERSION } from './gemini-api-version';
import type { ModelUsage } from './types';

/** One yes or no question, with what a yes and a no mean. */
export type YesNoQuestion = { instructions: string; trueDescription: string; falseDescription: string };

export type YesNoDecision = {
  /** The calibrated probability, between 0.01 and 0.99, that the answer is yes. */
  probability: number;
  usage: ModelUsage;
  answeredModel: string;
};

/** The id the one question of a request is sent and answered under. */
const QUESTION_ID = 'answer';

/**
 * Gemini's Decisions API (`POST /v1beta/decisions`, `@google/genai` 3.2 or
 * later): a decision model reads the input once and answers closed questions
 * with calibrated probabilities instead of text, so it is billed for input
 * tokens only. This asks one yes or no ("noul") question about images.
 */
export function createGeminiDecisionModel({ apiKey, model }: { apiKey: string; model: string }) {
  const client = new GoogleGenAI({ apiKey, apiVersion: GEMINI_API_VERSION });
  return {
    model,
    async decideYesNo(images: Array<{ mimeType: string; data: Uint8Array }>, question: YesNoQuestion): Promise<YesNoDecision> {
      const input: Decisions.DecisionInputContent[] = images.map((image) => ({
        type: 'image',
        mime_type: image.mimeType,
        data: Buffer.from(image.data).toString('base64'),
      }));
      const response = await client.decisions.create({
        model: `models/${model}`,
        input,
        questions: {
          [QUESTION_ID]: {
            type: 'noul',
            instructions: question.instructions,
            criteria: { true_description: question.trueDescription, false_description: question.falseDescription },
          },
        },
        api_version: GEMINI_API_VERSION,
      });
      const answer = response.answers?.[QUESTION_ID];
      if (answer?.type !== 'noul') throw new Error('The decision model returned no yes or no answer.');
      return {
        probability: answer.noul,
        usage: {
          inputTokens: response.usage?.total_input_tokens ?? 0,
          outputTokens: response.usage?.total_output_tokens ?? 0,
          cacheReadInputTokens: response.usage?.total_cached_tokens ?? 0,
          cacheCreationInputTokens: 0,
        },
        answeredModel: model,
      };
    },
  };
}
