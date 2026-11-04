import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

// contains env for building apps/web
export const env = createEnv({
  clientPrefix: 'VITE_',
  client: {
    VITE_SERVER_URL: z.url(),
    VITE_CONTACT_EMAIL: z.email(),
    VITE_CONTACT_PHONE_NUMBER: z.string().regex(/^\+[1-9]\d{7,14}$/),
    VITE_CONTACT_PHONE_LABEL: z.string().min(1),
    VITE_WHATSAPP_NUMBER: z.string().regex(/^[1-9]\d{7,14}$/),
    VITE_WHATSAPP_LABEL: z.string().min(1),
    VITE_CALENDAR_URL: z.url(),
    VITE_STAFF_LOGIN_URL: z.url(),
    /** Optional until a dedicated student and family workspace is deployed. */
    VITE_STUDENT_LOGIN_URL: z.url().optional(),
  },
  runtimeEnv: (import.meta as any).env,
  emptyStringAsUndefined: true,
});
