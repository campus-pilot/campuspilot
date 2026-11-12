/**
 * The AI model the generation job calls, as a structural interface.
 *
 * `@campuspilot/api` cannot import `@campuspilot/assistant` (that package
 * depends on this one), and the assistant package must stay free of
 * CampusPilot business logic. So the job's business code lives in this
 * package and the model is injected: a process that needs it calls
 * {@link configureQuestionPaperModel} once at boot with the assistant
 * package's implementation. A process that never configures one (a test, or a
 * deployment without a provider) has {@link getQuestionPaperModel} return
 * `undefined`, and starting a generation is refused with a clear message.
 *
 * The part, result and usage types below are structurally the assistant
 * package's `TextPart` / `TextResult` / `ModelUsage`; its
 * `createQuestionPaperModel()` (`packages/assistant/src/question-paper-model.ts`)
 * adapts a configured provider to this interface.
 */

export type TextPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data: Uint8Array };

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
};

export type TextResult = {
  /** The model's plain text answer, as returned (the HTML fragment, possibly inside a code fence). */
  text: string;
  usage: ModelUsage;
  /** The model that actually answered. */
  answeredModel: string;
  /** The model declined to answer. */
  refusal: boolean;
  /** The answer hit the output limit and is cut off. */
  truncated: boolean;
};

export interface QuestionPaperModel {
  readonly provider: 'anthropic' | 'gemini';
  /** The requested model (`QUESTION_PAPER_MODEL`, else the provider default). */
  readonly model: string;
  readonly prices: {
    inputUsdPerMtok: string;
    outputUsdPerMtok: string;
    cacheReadUsdPerMtok: string;
    cacheWriteUsdPerMtok: string;
  };
  /** Media types of images the provider accepts as input (HEIC for Gemini only). */
  readonly imageMimeTypes: readonly string[];
  generate(input: {
    system: string;
    parts: TextPart[];
    maxOutputTokens: number;
  }): Promise<TextResult>;
  failureKind(error: unknown): 'rejected' | 'unavailable' | 'busy' | 'unknown';
  billedUsageOf(error: unknown): { usage: ModelUsage; complete: boolean; model: string | null } | null;
}

let configured: QuestionPaperModel | undefined;

/** Sets (or, with `undefined`, clears) the process's model. Called once at boot. */
export function configureQuestionPaperModel(model: QuestionPaperModel | undefined) {
  configured = model;
}

/** The process's model, or `undefined` when none is configured. */
export function getQuestionPaperModel(): QuestionPaperModel | undefined {
  return configured;
}
