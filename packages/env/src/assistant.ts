import 'dotenv/config';
import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

/**
 * Environment of the assistant service (apps/assistant). It is a separate
 * service, so it reads none of the API's settings: it reaches CampusPilot
 * only through the API's public URLs, with the service secret the API
 * shares with it.
 */
export const env = createEnv({
  server: {
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    /** HTTP port of the assistant's own API (used by the management app). */
    ASSISTANT_PORT: z.coerce.number().int().min(1).max(65_535).default(3104),
    /** Origins allowed to call the assistant API with credentials. */
    CORS_ORIGIN: z.string().min(1),
    /** Postgres for the assistant's own `assistant` schema. */
    ASSISTANT_DATABASE_URL: z.url(),
    /** Migrations folder; defaults to the one next to the service source. */
    ASSISTANT_DB_MIGRATIONS_PATH: z.string().min(1).optional(),
    REDIS_URL: z.url(),

    /** CampusPilot API origin, for session checks and token issuance. */
    CAMPUSPILOT_API_URL: z.url(),
    /** CampusPilot MCP endpoint the assistant calls tools through. */
    CAMPUSPILOT_MCP_URL: z.url(),
    /** Same value as the API's ASSISTANT_SERVICE_SECRET. */
    ASSISTANT_SERVICE_SECRET: z.string().min(32),

    RESTATE_INGRESS_URL: z.url(),
    RESTATE_ADMIN_URL: z.url(),
    /** Port of the assistant's Restate service endpoint. */
    RESTATE_SERVICE_PORT: z.coerce.number().int().min(1).max(65_535).default(9081),
    /**
     * URL at which Restate reaches the service endpoint. When set, the
     * service registers that deployment at boot; when unset, registration is
     * left to the deployment tooling.
     */
    RESTATE_SERVICE_URL: z.url().optional(),
    /**
     * Restate's request-signing public keys (`publickeyv1_…`), comma
     * separated. When set, the service endpoint only accepts requests signed
     * by that Restate server. Without it, anything that can reach the
     * endpoint's port can drive a turn, including approving a waiting change,
     * so leave it unset only where the port is private to Restate.
     */
    RESTATE_IDENTITY_KEYS: z.string().min(1).optional(),

    /**
     * Model provider for new conversations. Existing conversations keep the
     * provider they started with, since each provider has its own transcript
     * format. Swapping providers is this setting plus that provider's key.
     */
    ASSISTANT_PROVIDER: z.enum(['anthropic', 'gemini']).default('anthropic'),

    /** Anthropic API key; optional so the service boots without one. */
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_MODEL: z.string().min(1).default('claude-opus-5-5'),

    /** Gemini API key (Google AI Studio); optional like the Anthropic key. */
    GEMINI_API_KEY: z.string().min(1).optional(),
    /**
     * Gemini model id, for example a current Gemini Pro model. No default:
     * Gemini model names change often, so it is chosen explicitly.
     */
    GEMINI_MODEL: z.string().min(1).optional(),

    /**
     * Developer diagnostics in the chat: each turn shows its model, token
     * usage, estimated cost and the raw error behind a failure. Off by
     * default and never meant for real users, who would see internals.
     */
    ASSISTANT_DIAGNOSTICS: z.stringbool().default(false),
  },
  runtimeEnv: process.env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
