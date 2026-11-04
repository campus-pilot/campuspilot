import { z } from 'zod';

import { oauthClientRegistrationMethodSchema } from '../../oauth/oauth-client-facts';

export const setPasswordInputSchema = z.object({
  newPassword: z.string().min(8, 'Password must contain at least 8 characters.'),
});

export const setPasswordOutputSchema = z.object({
  success: z.literal(true),
});

export const getOAuthConsentClientInputSchema = z.object({
  clientId: z.string().min(1).max(2048),
});

export const oauthConsentClientSchema = z.object({
  clientId: z.string(),
  /** Self-asserted by the client (or set by an administrator). */
  name: z.string().nullable(),
  uri: z.string().nullable(),
  registrationMethod: oauthClientRegistrationMethodSchema,
  /**
   * Host that proves the client's identity: the host of a Client ID
   * Metadata Document URL. Null for other registration methods.
   */
  verifiedHost: z.string().nullable(),
});
