import { z } from 'zod';

export const setPasswordInputSchema = z.object({
  newPassword: z.string().min(8, 'Password must contain at least 8 characters.'),
});

export const setPasswordOutputSchema = z.object({
  success: z.literal(true),
});

/** How an OAuth client was registered, from its explicitly recorded facts. */
export const oauthClientRegistrationMethodSchema = z.enum([
  'client_id_metadata_document',
  'pre_registered',
  'dynamic',
  'unknown',
]);

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
