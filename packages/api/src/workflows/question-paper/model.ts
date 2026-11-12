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
 * The part, result and usage types below are the minimum the API side needs
 * to name. The worker side of the job (phase P2) owns their final shape; this
 * file is the contract it implements.
 */

export type StructuredPart =
  | { kind: 'text'; text: string }
  | { kind: 'image'; mimeType: string; bytes: Uint8Array };

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
};

export type StructuredResult = {
  /** The model's JSON text. */
  text: string;
  usage: ModelUsage;
  /** Whether the provider reported every usage figure. */
  usageComplete: boolean;
  /** The model that actually answered. */
  answeredModel: string;
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
    parts: StructuredPart[];
    jsonSchema: Record<string, unknown>;
    maxOutputTokens: number;
  }): Promise<StructuredResult>;
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
