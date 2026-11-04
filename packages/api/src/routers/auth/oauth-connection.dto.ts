import { z } from 'zod';

import { oauthClientRegistrationMethodSchema } from '../../oauth/oauth-client-facts';
import {
  createListInputSchema,
  createPaginatedOutputSchema,
} from '../../paginations';

export const listOAuthConnectionsInputSchema = createListInputSchema({
  orderBy: z
    .object({
      field: z.enum(['connectedAt', 'lastUsedAt']),
      direction: z.enum(['asc', 'desc']),
    })
    .default({ field: 'connectedAt', direction: 'desc' }),
});

/** An AI app the signed-in user connected through OAuth. */
export const oauthConnectionSchema = z.object({
  clientId: z.string(),
  /** Self-asserted by the client (or set by an administrator). */
  name: z.string().nullable(),
  registrationMethod: oauthClientRegistrationMethodSchema,
  verifiedHost: z.string().nullable(),
  scopes: z.array(z.string()),
  connectedAt: z.date().nullable(),
  lastUsedAt: z.date().nullable(),
});

export const listOAuthConnectionsOutputSchema = createPaginatedOutputSchema(
  oauthConnectionSchema,
);

export const disconnectOAuthConnectionInputSchema = z.object({
  clientId: z.string().min(1).max(2048),
});

export const disconnectOAuthConnectionOutputSchema = z.object({
  success: z.literal(true),
});
