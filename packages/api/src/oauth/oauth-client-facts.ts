import { z } from 'zod';

/** How an OAuth client was registered, from its explicitly recorded facts. */
export const oauthClientRegistrationMethodSchema = z.enum([
  'client_id_metadata_document',
  'pre_registered',
  'dynamic',
  'unknown',
]);

export type OAuthClientRegistrationMethod = z.infer<
  typeof oauthClientRegistrationMethodSchema
>;

/**
 * Reads the registration method from the facts recorded at registration: the
 * CIMD plugin's `clientDiscoveryId`, or `metadata.registrationMethod` written
 * by DCR and by administrators. Unrecorded clients stay `unknown`.
 */
export function oauthClientRegistrationMethod(client: {
  clientDiscoveryId: string | null;
  metadata: unknown;
}): OAuthClientRegistrationMethod {
  if (client.clientDiscoveryId === 'cimd') return 'client_id_metadata_document';
  const recorded = (client.metadata as { registrationMethod?: unknown } | null)
    ?.registrationMethod;
  return recorded === 'pre_registered' || recorded === 'dynamic'
    ? recorded
    : 'unknown';
}

/**
 * The host that proves a client's identity: for a Client ID Metadata
 * Document the client ID is the document URL, so its host is verified by
 * TLS. Other registration methods have no verified host.
 */
export function oauthClientVerifiedHost(
  clientId: string,
  method: OAuthClientRegistrationMethod,
): string | null {
  return method === 'client_id_metadata_document' ? new URL(clientId).host : null;
}
