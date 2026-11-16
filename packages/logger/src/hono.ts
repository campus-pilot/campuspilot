import type { Context, MiddlewareHandler } from 'hono';
import type { Logger } from 'pino';
import { performance } from 'node:perf_hooks';
import { logger as rootLogger } from '@campuspilot/logger';

import {
  createTimingScope,
  runInTimingScope,
  SLOW_REQUEST_MS,
  summarizeTiming,
  trackInFlight,
} from './perf';

export type LoggerVariables = {
  requestId: string;
  logger: Logger;
};

/**
 * Best-effort client IP from the proxy headers, used both to annotate logs and
 * to key the rate limiters.
 *
 * A deliberate port of voyager's `utils.GetIPAddress` (`api/utils/http.go`), so
 * the same request keys identically in both services:
 *
 * ```go
 * ip := r.Header.Get("X-Real-IP")
 * if ip == "" { ip = r.Header.Get("X-Forwarded-For") }
 * if ip == "" { ip = "127.0.0.1" }
 * ```
 *
 * `x-real-ip` wins because the ingress sets it to the single peer address it
 * observed, overwriting whatever the caller sent. `x-forwarded-for` is used
 * whole, exactly as voyager uses it — not split to its first hop — so both
 * services derive the same string from the same request.
 *
 * The `""` checks are `.trim()`ed here only to mirror Go: `net/http` strips the
 * optional whitespace around a field value while parsing, so a blank header
 * already reads as absent there.
 *
 * Voyager's no-header fallback is the literal `127.0.0.1`. This returns
 * `undefined` instead, leaving that substitution to the caller: the rate
 * limiters apply voyager's label so the buckets line up, while `context.ip`
 * stays null — recording an address the proxy never reported would put a fact
 * on audit rows that nothing actually established.
 *
 * SECURITY: every one of these headers is client-controlled unless a trusted
 * proxy overwrites it. Safe as a rate-limit key only behind a load balancer that
 * sets them itself — otherwise a caller picks a fresh key per request and the
 * limits are bypassed.
 *
 * In particular `x-forwarded-for` is append-only: our ingress adds to whatever
 * the caller sent rather than replacing it, so its contents are partly
 * attacker-controlled. It is safe here only because `x-real-ip` is overwritten
 * upstream and therefore always wins. Do not reorder these two.
 */
export function resolveClientIpFromHeaders(
  headers: Headers,
): string | undefined {
  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  const forwardedFor = headers.get('x-forwarded-for')?.trim();
  if (forwardedFor) return forwardedFor;

  return undefined;
}

/**
 * {@link resolveClientIpFromHeaders} for callers holding a Hono context.
 *
 * Reads `c.req.raw.headers` rather than `c.req.header()` so the one definition
 * of the precedence rules also serves callers that only have the raw `Request`
 * — `createContext` is handed context doubles that implement no more than that.
 */
export function resolveClientIp(c: Context): string | undefined {
  return resolveClientIpFromHeaders(c.req.raw.headers);
}

/**
 * Hono middleware that:
 * - Resolves a request id (header `x-request-id`, else `crypto.randomUUID()`).
 * - Creates a per-request pino child logger bound to that id + IP.
 * - Exposes both via `c.var.requestId` / `c.var.logger`.
 * - Echoes the id back as the `x-request-id` response header.
 * - Logs request start, end with status + duration, and unhandled errors.
 * - Opens the request's timing scope (see `./perf.ts`): the end line also
 *   carries the steps timed during the request (`steps`, `stepCalls`), their
 *   annotations, `loopBusy` (how busy this process's event loop was while the
 *   request ran, 0 to 1, shared by every concurrent request) and `slow: true`
 *   at warn level from {@link SLOW_REQUEST_MS}. The request is also listed as
 *   in flight for `runtime.eventloop.blocked`.
 *
 * Request bodies are intentionally NOT logged — they can carry credentials,
 * OTPs, PII, and other sensitive content that the redact list cannot catch.
 * To inspect a body during development, log it explicitly inside the procedure
 * with whatever subset is safe.
 */
export function pinoLogger(): MiddlewareHandler<{
  Variables: LoggerVariables;
}> {
  return async (c, next) => {
    const headerId = c.req.header('x-request-id');
    const requestId =
      headerId && headerId.length > 0 ? headerId : crypto.randomUUID();
    const ip = resolveClientIp(c);
    const log = rootLogger.child({ reqId: requestId, ...(ip ? { ip } : {}) });

    c.set('requestId', requestId);
    c.set('logger', log);
    c.res.headers.set('x-request-id', requestId);

    const start = performance.now();
    const loopAtStart = performance.eventLoopUtilization();
    const scope = createTimingScope(log);
    const untrack = trackInFlight({ reqId: requestId, method: c.req.method, path: c.req.path });
    /** The timing facts of the end and error lines. */
    const timing = () => ({
      loopBusy: Math.round(performance.eventLoopUtilization(loopAtStart).utilization * 100) / 100,
      ...summarizeTiming(scope),
    });
    log.debug({
      seperator: '----------------------------------------------------',
    });
    log.info(
      {
        method: c.req.method,
        path: c.req.path,
        userAgent: c.req.header('user-agent'),
      },
      'http.request.start',
    );

    try {
      await runInTimingScope(scope, () => next());
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      log.error(
        { err, durationMs, method: c.req.method, path: c.req.path, ...timing() },
        'http.request.error',
      );
      log.debug({
        seperator: '----------------------------------------------------',
      });
      throw err;
    } finally {
      untrack();
    }

    const durationMs = Math.round(performance.now() - start);
    const status = c.res.status;
    const evt =
      status >= 500
        ? 'http.request.5xx'
        : status >= 400
          ? 'http.request.4xx'
          : 'http.request.end';
    const slow = durationMs >= SLOW_REQUEST_MS;
    const level =
      status >= 500 ? 'error' : status >= 400 || slow ? 'warn' : 'info';
    (log as unknown as Record<string, (obj: object, msg: string) => void>)[
      level
    ]!(
      {
        status,
        durationMs,
        method: c.req.method,
        path: c.req.path,
        ...timing(),
        ...(slow ? { slow } : {}),
      },
      evt,
    );
    log.debug({
      seperator: '----------------------------------------------------',
    });
  };
}

/** Read the per-request logger off a Hono context, falling back to the root logger. */
export function honoLogger(c: Context<{ Variables: LoggerVariables }>): Logger {
  return c.var.logger ?? rootLogger;
}
