import 'dotenv/config';
import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

/**
 * Environment of the in-app assistant (`packages/assistant`), read by both
 * the API server (which serves `/model/*` and picks the provider of a new
 * conversation) and `apps/worker` (which runs the turns and calls the
 * model). Both processes get the same values: the worker's `.env` is a copy
 * of the server's.
 *
 * Every provider follows one convention: `<P>_API_KEY`, `<P>_MODEL` and four
 * prices in USD per million tokens (`<P>_PRICE_INPUT_USD_PER_MTOK`,
 * `_OUTPUT_`, `_CACHE_READ_`, `_CACHE_WRITE_`). A provider is configured
 * only when all six are set; setting some of them is refused at start, so a
 * provider can never run without the prices its cost is saved with. The
 * prices are copied onto every `assistant_model_request` row when the
 * response arrives and never looked up again, so changing them affects only
 * later requests. There is deliberately no price list in code: providers
 * change prices without an API to read them from.
 */

/** A non-negative decimal amount of USD, kept as text so no float ever touches money. */
const usdPerMillionTokens = z
  .string()
  .regex(/^\d{1,6}(\.\d{1,6})?$/, 'Use a decimal amount of USD per million tokens, for example 0.75.')
  .optional();

/** The settings of one provider, all optional here; the final schema requires all or none. */
function providerShape<P extends 'ANTHROPIC' | 'GEMINI'>(prefix: P) {
  return {
    [`${prefix}_API_KEY`]: z.string().min(1).optional(),
    [`${prefix}_MODEL`]: z.string().min(1).optional(),
    [`${prefix}_PRICE_INPUT_USD_PER_MTOK`]: usdPerMillionTokens,
    [`${prefix}_PRICE_OUTPUT_USD_PER_MTOK`]: usdPerMillionTokens,
    [`${prefix}_PRICE_CACHE_READ_USD_PER_MTOK`]: usdPerMillionTokens,
    [`${prefix}_PRICE_CACHE_WRITE_USD_PER_MTOK`]: usdPerMillionTokens,
  } as {
    [K in
      | `${P}_API_KEY`
      | `${P}_MODEL`
      | `${P}_PRICE_INPUT_USD_PER_MTOK`
      | `${P}_PRICE_OUTPUT_USD_PER_MTOK`
      | `${P}_PRICE_CACHE_READ_USD_PER_MTOK`
      | `${P}_PRICE_CACHE_WRITE_USD_PER_MTOK`]: z.ZodOptional<z.ZodString>;
  };
}

/** The six variable suffixes of one provider, in the order errors name them. */
export const ASSISTANT_PROVIDER_SETTING_SUFFIXES = [
  'API_KEY',
  'MODEL',
  'PRICE_INPUT_USD_PER_MTOK',
  'PRICE_OUTPUT_USD_PER_MTOK',
  'PRICE_CACHE_READ_USD_PER_MTOK',
  'PRICE_CACHE_WRITE_USD_PER_MTOK',
] as const;

/** Refuses a provider with some but not all of its six settings. */
function requireCompleteProviders(value: Record<string, unknown>, context: z.RefinementCtx) {
  for (const prefix of ['ANTHROPIC', 'GEMINI'] as const) {
    const names = ASSISTANT_PROVIDER_SETTING_SUFFIXES.map((suffix) => `${prefix}_${suffix}`);
    const missing = names.filter((name) => value[name] === undefined);
    if (missing.length > 0 && missing.length < names.length) {
      for (const name of missing) {
        context.addIssue({
          code: 'custom',
          path: [name],
          message: `${name} is required because other ${prefix}_* assistant settings are set: a provider needs its key, model and all four prices.`,
        });
      }
    }
  }
}

/**
 * A question paper provider needs a way to be called: an explicit
 * `QUESTION_PAPER_PROVIDER` must have its key, and a model from either
 * `QUESTION_PAPER_MODEL` or its own `<P>_MODEL`.
 */
function requireUsableQuestionPaperProvider(value: Record<string, unknown>, context: z.RefinementCtx) {
  const provider = value.QUESTION_PAPER_PROVIDER;
  if (provider !== 'anthropic' && provider !== 'gemini') return;
  const prefix = provider === 'anthropic' ? 'ANTHROPIC' : 'GEMINI';
  if (value[`${prefix}_API_KEY`] === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['QUESTION_PAPER_PROVIDER'],
      message: `QUESTION_PAPER_PROVIDER=${provider} needs ${prefix}_API_KEY.`,
    });
  }
  if (value.QUESTION_PAPER_MODEL === undefined && value[`${prefix}_MODEL`] === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['QUESTION_PAPER_PROVIDER'],
      message: `QUESTION_PAPER_PROVIDER=${provider} needs QUESTION_PAPER_MODEL or ${prefix}_MODEL.`,
    });
  }
}

/** The four question paper price settings, in the order errors name them. */
const QUESTION_PAPER_PRICE_NAMES = [
  'QUESTION_PAPER_PRICE_INPUT_USD_PER_MTOK',
  'QUESTION_PAPER_PRICE_OUTPUT_USD_PER_MTOK',
  'QUESTION_PAPER_PRICE_CACHE_READ_USD_PER_MTOK',
  'QUESTION_PAPER_PRICE_CACHE_WRITE_USD_PER_MTOK',
] as const;

/**
 * Prices belong to a model. A question paper model different from the
 * provider's own therefore brings all four prices, and without that model the
 * prices must not be set (the provider's own are used): a model never
 * silently inherits another model's prices.
 */
function requireQuestionPaperPricesWithModel(value: Record<string, unknown>, context: z.RefinementCtx) {
  const modelSet = value.QUESTION_PAPER_MODEL !== undefined;
  for (const name of QUESTION_PAPER_PRICE_NAMES) {
    const priceSet = value[name] !== undefined;
    if (modelSet && !priceSet) {
      context.addIssue({
        code: 'custom',
        path: [name],
        message: `${name} is required because QUESTION_PAPER_MODEL is set: a model needs all four prices.`,
      });
    } else if (!modelSet && priceSet) {
      context.addIssue({
        code: 'custom',
        path: [name],
        message: `${name} is set without QUESTION_PAPER_MODEL. Prices belong to a model; unset it to use the provider's own prices.`,
      });
    }
  }
}

/** Every cross-field rule of the assistant environment. */
function refineAssistantEnv(value: Record<string, unknown>, context: z.RefinementCtx) {
  requireCompleteProviders(value, context);
  requireQuestionPaperPricesWithModel(value, context);
  requireUsableQuestionPaperProvider(value, context);
}

/** The assistant settings' shape, without validation (see `assistantEnvSchema`). */
const assistantEnvShape = {
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    /**
     * Model provider for new conversations. Existing conversations keep the
     * provider they started with, since each provider has its own transcript
     * format, so every provider that still has conversations needs its
     * settings while they are in use.
     */
    ASSISTANT_PROVIDER: z.enum(['anthropic', 'gemini']).default('gemini'),
    ...providerShape('ANTHROPIC'),
    ...providerShape('GEMINI'),
    /**
     * The API's MCP endpoint as the worker reaches it (an internal address
     * plus `/mcp`). The model reaches school data only through it, with the
     * run's delegated token. The worker refuses to start without it while a
     * provider is configured; the API does not use it.
     */
    CAMPUSPILOT_MCP_URL: z.url().optional(),
    /**
     * Developer diagnostics in the chat: each turn shows its model, token
     * usage, saved cost and the raw error behind a failure. Off by default
     * and never meant for real users, who would see internals.
     */
    ASSISTANT_DIAGNOSTICS: z.stringbool().default(false),
    /**
     * Question paper generation (the manual "Generate with AI" job, run by
     * `apps/worker`). It falls back to the assistant's provider and model, so
     * a deployment that configures only the assistant can generate papers.
     * `QUESTION_PAPER_PROVIDER` defaults to `ASSISTANT_PROVIDER`;
     * `QUESTION_PAPER_MODEL` defaults to that provider's `<P>_MODEL`. When a
     * model is set here, all four prices are required (and are used); when it
     * is not, they must be unset and the provider's own prices apply.
     */
    QUESTION_PAPER_PROVIDER: z.enum(['anthropic', 'gemini']).optional(),
    QUESTION_PAPER_MODEL: z.string().min(1).optional(),
    QUESTION_PAPER_PRICE_INPUT_USD_PER_MTOK: usdPerMillionTokens,
    QUESTION_PAPER_PRICE_OUTPUT_USD_PER_MTOK: usdPerMillionTokens,
    QUESTION_PAPER_PRICE_CACHE_READ_USD_PER_MTOK: usdPerMillionTokens,
    QUESTION_PAPER_PRICE_CACHE_WRITE_USD_PER_MTOK: usdPerMillionTokens,
    /** Output token limit of one generation request; a paper that does not fit fails as too long. */
    QUESTION_PAPER_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1_000).max(128_000).default(32_000),
    /**
     * How long a running generation job may take before the API's sweep fails
     * it as `not_finished`. Also read by the API server, which runs the sweep.
     */
    QUESTION_PAPER_JOB_TIMEOUT_MINUTES: z.coerce.number().int().min(1).max(240).default(20),
};

/**
 * The full assistant environment schema, with the all-or-nothing rule per
 * provider. Exported so the rule is testable without a process environment.
 */
export const assistantEnvSchema = z.object(assistantEnvShape).superRefine(refineAssistantEnv);

export const env = createEnv({
  server: assistantEnvShape,
  createFinalSchema: (shape) => z.object(shape).superRefine(refineAssistantEnv),
  runtimeEnv: process.env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
