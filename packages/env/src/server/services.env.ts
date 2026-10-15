import { z } from 'zod';

export const SERVICES_ENV_SHAPE = {
  GOTENBERG_URL: z.url(),
  OPA_URL: z.url(),
  REDIS_URL: z.url(),
  RESTATE_ADMIN_URL: z.url(),
  RESTATE_FABRIC_URL: z.url(),
  RESTATE_INGRESS_URL: z.url(),
};
