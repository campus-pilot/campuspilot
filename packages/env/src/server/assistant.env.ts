import { z } from 'zod';

/**
 * The API's setting for delegating access to the in-app assistant. Optional:
 * when unset the API issues no assistant tokens and accepts none, so the
 * assistant cannot act, and the rest of the platform is unaffected.
 */
export const ASSISTANT_DELEGATION_ENV_SHAPE = {
  /**
   * Signs the assistant's delegated MCP tokens. Known only to the API, which
   * both issues (in-process, for `/model/*`) and verifies them (on `/mcp`).
   * Generate with `openssl rand -hex 32`.
   */
  ASSISTANT_TOKEN_SIGNING_SECRET: z.string().min(32).optional(),
};
