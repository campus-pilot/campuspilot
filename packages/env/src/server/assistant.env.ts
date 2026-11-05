import { z } from 'zod';

/**
 * Settings the API needs to delegate access to the separate assistant
 * service (apps/assistant). Both are optional: when either is unset the API
 * issues no assistant tokens and accepts none, and the rest of the platform
 * is unaffected.
 */
export const ASSISTANT_DELEGATION_ENV_SHAPE = {
  /**
   * Shared with the assistant service; proves a token request comes from it.
   * It cannot sign tokens, so a leaked copy alone cannot impersonate users:
   * every request must also carry that user's live session.
   */
  ASSISTANT_SERVICE_SECRET: z.string().min(32).optional(),
  /** Signs assistant access tokens. Known only to the API. */
  ASSISTANT_TOKEN_SIGNING_SECRET: z.string().min(32).optional(),
};
