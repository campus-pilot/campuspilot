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
};

/**
 * The full assistant environment schema, with the all-or-nothing rule per
 * provider. Exported so the rule is testable without a process environment.
 */
export const assistantEnvSchema = z.object(assistantEnvShape).superRefine((value, context) => {
  requireCompleteProviders(value, context);
});

export const env = createEnv({
  server: assistantEnvShape,
  createFinalSchema: (shape) =>
    z.object(shape).superRefine((value, context) => {
      requireCompleteProviders(value, context);
    }),
  runtimeEnv: process.env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
