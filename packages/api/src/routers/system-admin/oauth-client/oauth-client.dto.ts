import { z } from 'zod';

import { oauthClientRegistrationMethodSchema } from '../../../oauth/oauth-client-facts';
import {
  createListInputSchema,
  createPaginatedOutputSchema,
} from '../../../paginations';

export const listOAuthClientsInputSchema = createListInputSchema({
  searchQuery: z.string().trim().max(100).default(''),
  filters: z
    .object({
      registrationMethod: oauthClientRegistrationMethodSchema.optional(),
      disabled: z.boolean().optional(),
    })
    .optional(),
  orderBy: z
    .object({
      field: z.enum(['createdAt', 'name']),
      direction: z.enum(['asc', 'desc']),
    })
    .default({ field: 'createdAt', direction: 'desc' }),
});

export const oauthClientDtoSchema = z.object({
  clientId: z.string(),
  name: z.string().nullable(),
  uri: z.string().nullable(),
  registrationMethod: oauthClientRegistrationMethodSchema,
  verifiedHost: z.string().nullable(),
  redirectUris: z.array(z.string()),
  tokenEndpointAuthMethod: z.string().nullable(),
  disabled: z.boolean(),
  createdAt: z.date().nullable(),
  /** Users currently connected through this client. */
  connectionCount: z.number().int().nonnegative(),
});

export const listOAuthClientsOutputSchema = createPaginatedOutputSchema(
  oauthClientDtoSchema,
);

/** Methods a pre-registered (confidential) client authenticates with. */
export const preRegisteredClientAuthMethodSchema = z.enum([
  'client_secret_basic',
  'client_secret_post',
]);

export const createOAuthClientInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  redirectUris: z
    .array(z.url({ protocol: /^https?$/ }).max(2048))
    .min(1)
    .max(10)
    .refine((uris) => new Set(uris).size === uris.length, {
      message: 'Redirect URIs must be unique.',
    }),
  tokenEndpointAuthMethod: preRegisteredClientAuthMethodSchema.default(
    'client_secret_basic',
  ),
});

/** A client secret is returned only when it is created or rotated. */
export const oauthClientSecretOutputSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string(),
});

export const oauthClientIdInputSchema = z.object({
  clientId: z.string().min(1).max(2048),
});

export const setOAuthClientDisabledInputSchema = oauthClientIdInputSchema.extend({
  disabled: z.boolean(),
});

export const oauthClientMutationOutputSchema = z.object({
  success: z.literal(true),
});
