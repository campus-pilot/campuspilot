import { z } from 'zod';

export const SERVICES_ENV_SHAPE = {
  GOTENBERG_URL: z.url(),
  AI_BASE_URL: z.url().default('https://api.openai.com/v1'),
  AI_API_KEY: z.string().min(1).optional(),
  AI_MODEL: z.string().min(1).default('gpt-4o'),
  OPA_URL: z.url(),
  REDIS_URL: z.url(),
  RESTATE_ADMIN_URL: z.url(),
  RESTATE_FABRIC_URL: z.url(),
  RESTATE_INGRESS_URL: z.url(),
};
