import { z } from 'zod';

export const allowedAuthMethodSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('password') }),
  z.object({ type: z.literal('google') }),
  // Personal access keys. Enforced at PAK exchange time, not interactive
  // sign-in. On by default for organizations; an enterprise admin removes it
  // to forbid PAK-scoped sessions for their organization.
  z.object({ type: z.literal('apiKey') }),
]);

export const allowedAuthMethodsSchema = z.array(allowedAuthMethodSchema);

export type AllowedAuthMethod = z.infer<typeof allowedAuthMethodSchema>;
export type AllowedAuthMethods = z.infer<typeof allowedAuthMethodsSchema>;

export function isMethodAllowed(
  allowed: AllowedAuthMethods,
  session: { authMethod: string | null; authSsoProviderId: string | null },
): boolean {
  if (!session.authMethod) return false;
  return allowed.some((m) => m.type === session.authMethod);
}
