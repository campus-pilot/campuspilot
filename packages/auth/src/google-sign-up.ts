import { log } from './log';

/**
 * What runs after a new account signed up with Google (docs/personal-space.md:
 * the person's personal space is created). Registered once at boot by
 * `apps/server`, which serves the sign-in routes; `@campuspilot/auth` cannot
 * import the API, which owns personal spaces.
 */
export type GoogleSignUpHandler = (userId: string) => Promise<void>;

let handler: GoogleSignUpHandler | null = null;

/** Registers what runs after a Google sign-up. Call once, at boot, before serving requests. */
export function registerGoogleSignUpHandler(next: GoogleSignUpHandler): void {
  handler = next;
}

/** The endpoint facts the decision reads (Better Auth's `GenericEndpointContext`, or null outside an endpoint). */
type EndpointFacts = { path?: string; params?: Record<string, unknown> | undefined; body?: unknown } | null | undefined;

/**
 * Whether a user was created by a Google sign-in, from the endpoint that
 * created it, never from the user's fields (an invited person's email is
 * marked verified too). Better Auth creates an account through Google on
 * two endpoints:
 * - the OAuth redirect callback, `/callback/:id` with `id` = `google`;
 * - the ID token sign-in, `/sign-in/social` with `provider` = `google`.
 * Every other creator is not a Google sign-up: `school.inviteMember` and the
 * demo seed create users through the admin plugin (`/admin/create-user`),
 * and an email sign-up uses `/sign-up/email`. A user created outside an
 * endpoint (context null) is not one either.
 */
export function isGoogleSignUpEndpoint(context: EndpointFacts): boolean {
  const path = context?.path;
  if (!path) return false;
  if (path.startsWith('/callback/')) {
    const id = context.params?.id ?? path.split('/').pop();
    return id === 'google';
  }
  if (path === '/sign-in/social') {
    const body = context.body as { provider?: unknown } | undefined;
    return body?.provider === 'google';
  }
  return false;
}

/**
 * Runs the registered handler for a user created by a Google sign-up. Better
 * Auth runs `user.create.after` once the user and their Google account are
 * committed. The handler never fails a sign-in: it logs its own failures,
 * and a missing registration is logged here.
 */
export async function afterUserCreated(userId: string, context: EndpointFacts): Promise<void> {
  if (!isGoogleSignUpEndpoint(context)) return;
  if (!handler) {
    log.warn({ userId }, 'auth.google-sign-up.no-handler');
    return;
  }
  try {
    await handler(userId);
  } catch (error) {
    log.error({ err: error, userId }, 'auth.google-sign-up.handler-failed');
  }
}
