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
    VITE_STAFF_LOGIN_URL: z.url(),
    /**
     * Base URL of the narrated demo videos (`<base>/<demo>.<language>.mp4`), served
     * from the R2 bucket behind its own subdomain rather than the web image. No trailing slash.
     */
    VITE_DEMO_MEDIA_URL: z.url().refine((url) => !url.endsWith('/'), 'Drop the trailing slash'),
    /** Optional until a dedicated student and family workspace is deployed. */
    VITE_STUDENT_LOGIN_URL: z.url().optional(),
    /** The Meta Pixel (dataset) ID; without it the website loads no pixel. Digits only, since it is written into an inline script. */
    VITE_META_PIXEL_ID: z.string().regex(/^\d{5,25}$/).optional(),
  },
  runtimeEnv: (import.meta as any).env,
  emptyStringAsUndefined: true,
});
