import { pino, type Logger, type LoggerOptions, type Bindings } from "pino";
import { CENSOR, sanitizeLogArgs, sanitizeLogRecord } from "./sanitize";

const LEVEL = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_LOG_LEVEL ?? "info";

function buildOptions(): LoggerOptions {
  return {
    level: LEVEL,
    // `formatters.log` cannot reach `msg` — pino hands it the log object only —
    // so the message string is scrubbed here. See sanitizeLogArgs.
    hooks: {
      logMethod(this: unknown, args: unknown[], method: (...a: unknown[]) => void) {
        method.apply(this, sanitizeLogArgs(args));
      },
    },
    // Same sanitiser as the Node entry — a browser log can still be handed a
    // fetch/axios error carrying an Authorization header. See ./sanitize.ts.
    formatters: { log: sanitizeLogRecord },
    redact: {
      paths: [
        "password",
        "*.password",
        "token",
        "*.token",
        "authorization",
        "*.authorization",
        "cookie",
        "*.cookie",
        "secret",
        "*.secret",
        "apiKey",
        "*.apiKey",
      ],
      censor: CENSOR,
    },
    browser: { asObject: true },
  };
}

export const logger: Logger = pino(buildOptions());

export function createLogger(bindings: Bindings): Logger {
  return logger.child(bindings);
}

export type { Logger, Bindings } from "pino";

// No-op in browser: pino-browser proxies to console.*, so patching console
// would create an infinite loop. Kept for API parity with the Node entry.
export function patchConsole(): void {}
