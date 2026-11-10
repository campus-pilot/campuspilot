import { env } from '@campuspilot/env/server';
import type { Logger } from '@campuspilot/logger';
import * as restate from '@restatedev/restate-sdk';

import { verifyWorkerControlCall } from './control-auth';
import { getRestateInvocation } from './restate-admin';

/**
 * Refuses a control call that the API did not sign (see `./control-auth.ts`).
 * Every ingress-public worker service calls it first, before any journal
 * entry and before the database is read. It is not journaled: it reads only
 * the invocation's immutable headers and Restate's immutable acceptance time,
 * so every retry reaches the same verdict. A missing secret fails closed. An
 * unreachable admin API is retried (a plain error), never treated as
 * authenticated.
 */
export async function authenticateControlCall(
  ctx: restate.Context,
  options: { service: string; handler: string; input: unknown; log: Logger },
) {
  const { service, handler, input, log } = options;
  const secret = env.WORKER_CONTROL_SECRET;
  if (!secret) {
    log.error({ service, handler }, 'worker.control.secret-missing');
    throw new restate.TerminalError('Worker control calls are disabled: WORKER_CONTROL_SECRET is not configured.', { errorCode: 503 });
  }
  const request = ctx.request();
  const invocation = await getRestateInvocation(request.id);
  if (!invocation) throw new Error('Restate does not report this invocation yet.');
  const verdict = verifyWorkerControlCall({ secret, target: { service, handler }, input, headers: request.headers, acceptedAt: invocation.createdAt });
  if (!verdict.ok) {
    log.warn({ service, handler, reason: verdict.reason, invocationId: request.id }, 'worker.control.unauthenticated');
    throw new restate.TerminalError('Unauthenticated worker control call.', { errorCode: 401 });
  }
}
