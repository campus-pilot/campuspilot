import * as restate from '@restatedev/restate-sdk';

import { log } from './log';

/** Shared, non-revealing text for unexpected failures. */
export const UNEXPECTED_STEP_FAILURE = 'A database or storage operation failed; the worker log has the details.';

/**
 * Drizzle query errors carry the SQL and its parameters (which, in the
 * credentials step, include a password hash). Only the part before
 * `params:` and the database error code are logged.
 */
function describe(error: unknown) {
  if (!(error instanceof Error)) return { message: String(error).slice(0, 300) };
  const cause = error.cause as { code?: unknown } | undefined;
  return {
    name: error.name,
    message: error.message.split('\nparams:')[0]!.slice(0, 500),
    code: typeof cause?.code === 'string' ? cause.code : undefined,
  };
}

/**
 * Replaces an unexpected error with a safe one before it reaches Restate, whose
 * failure text (`last_failure`) and logs must never contain SQL, parameters or
 * secrets. The detail is logged here, without parameters. A `TerminalError`
 * is already safe and passes through; anything else stays retryable.
 */
export function toSafeError(error: unknown, context: Record<string, unknown>): unknown {
  if (error instanceof restate.TerminalError) return error;
  log.error({ ...context, err: describe(error) }, 'demo-school.step.error');
  return new Error(UNEXPECTED_STEP_FAILURE);
}
