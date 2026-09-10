import type { Context, MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import { logger as rootLogger } from "./index.node";

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
export function resolveClientIpFromHeaders(headers: Headers): string | undefined {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwardedFor = headers.get("x-forwarded-for")?.trim();
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
 *
 * Request bodies are intentionally NOT logged — they can carry credentials,
 * OTPs, PII, and other sensitive content that the redact list cannot catch.
 * To inspect a body during development, log it explicitly inside the procedure
 * with whatever subset is safe.
 */
export function pinoLogger(): MiddlewareHandler<{ Variables: LoggerVariables }> {
  return async (c, next) => {
    const headerId = c.req.header("x-request-id");
    const requestId = headerId && headerId.length > 0 ? headerId : crypto.randomUUID();
    const ip = resolveClientIp(c);
    const log = rootLogger.child({ reqId: requestId, ...(ip ? { ip } : {}) });

    c.set("requestId", requestId);
    c.set("logger", log);
    c.res.headers.set("x-request-id", requestId);

    const start = performance.now();
    log.info(
      {
        method: c.req.method,
        path: c.req.path,
        userAgent: c.req.header("user-agent"),
      },
      "http.request.start",
    );

    try {
      await next();
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      log.error({ err, durationMs, method: c.req.method, path: c.req.path }, "http.request.error");
      throw err;
    }

    const durationMs = Math.round(performance.now() - start);
    const status = c.res.status;
    const evt =
      status >= 500
        ? "http.request.5xx"
        : status >= 400
          ? "http.request.4xx"
          : "http.request.end";
    const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
    (log as unknown as Record<string, (obj: object, msg: string) => void>)[level]!(
      { status, durationMs, method: c.req.method, path: c.req.path },
      evt,
    );
  };
}

/** Read the per-request logger off a Hono context, falling back to the root logger. */
export function honoLogger(c: Context<{ Variables: LoggerVariables }>): Logger {
  return c.var.logger ?? rootLogger;
}
