/**
 * The facts of an error that are safe to log where its message is not.
 *
 * The sanitiser (`sanitize.ts`) keeps an error's `message` and `stack`, which
 * is right for most errors and wrong for a database error: Drizzle's
 * `DrizzleQueryError` message is the failed query with its bound values
 * ("Failed query: insert into ... params: Asha's personal school, ..."), so
 * a person's name or other row values would reach the log. Where an error may
 * come from a query that carries personal data, log these instead of `err`:
 * the error's class and the first machine-readable code along its `cause`
 * chain (a `pg` SQLSTATE such as `23505`, or an oRPC code such as
 * `FORBIDDEN`), with the constraint name when the database names one. None
 * of these can hold a value.
 */
export function errorFacts(error: unknown): { errorName: string; errorCode?: string; errorConstraint?: string } {
  const errorName = error instanceof Error ? error.name : typeof error;
  let errorCode: string | undefined;
  let errorConstraint: string | undefined;
  let current: unknown = error;
  // Bounded: a cause chain is short, and a cyclic one must not loop.
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const { code, constraint } = current as { code?: unknown; constraint?: unknown };
    if (errorCode === undefined && typeof code === 'string') errorCode = code;
    if (errorConstraint === undefined && typeof constraint === 'string') errorConstraint = constraint;
    current = (current as { cause?: unknown }).cause;
  }
  return {
    errorName,
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(errorConstraint === undefined ? {} : { errorConstraint }),
  };
}
