const MAX_RETRIES = 3;

/**
 * Retries a failed read up to three times, but never a client error (4xx).
 * A NOT_FOUND or FORBIDDEN answer will not change on retry, so it surfaces at
 * once (e.g. "Class not found" for a class id that is not the student's)
 * instead of after several seconds of backoff. Network failures and 5xx
 * answers carry no 4xx status and are still retried.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) return false;
  return failureCount < MAX_RETRIES;
}
