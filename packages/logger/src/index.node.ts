import { logEnv } from '@campuspilot/env/log';
import { pino, type Logger, type LoggerOptions, type Bindings } from 'pino';
import { CENSOR, sanitizeLogArgs, sanitizeLogRecord } from './sanitize';

function buildOptions(): LoggerOptions {
  return {
    level: logEnv.LOG_LEVEL,
    base: { app: logEnv.LOG_APP, pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime,
    // `formatters.log` cannot reach `msg` — pino hands it the log object only —
    // so the message string is scrubbed here. See sanitizeLogArgs.
    hooks: {
      logMethod(
        this: unknown,
        args: unknown[],
        method: (...a: unknown[]) => void,
      ) {
        method.apply(this, sanitizeLogArgs(args));
      },
    },
    formatters: {
      level: (label) => ({ level: label.toUpperCase() }),
      // Deep sanitiser. Runs before `serializers` and `redact` and receives the
      // whole object, which makes it the only hook that can reach a secret
      // nested inside a foreign object — see ./sanitize.ts.
      log: sanitizeLogRecord,
    },
    // Pass-through. `formatters.log` has already turned every error into a
    // sanitised plain object, and pino's default `err` serializer would relabel
    // that object `"type":"Object"` and re-walk it for nothing.
    serializers: { err: (value: unknown) => value },
    // Kept as the cheap first pass over the shapes we build ourselves. These
    // paths are single-level by design; anything deeper is the sanitiser's job.
    redact: {
      paths: [
        'password',
        '*.password',
        'token',
        '*.token',
        'authorization',
        '*.authorization',
        'cookie',
        '*.cookie',
        'secret',
        '*.secret',
        'apiKey',
        '*.apiKey',
        'email',
        '*.email',
        'otp',
        '*.otp',
      ],
      censor: CENSOR,
    },
  };
}

export const logger: Logger = pino(buildOptions());

export function createLogger(bindings: Bindings): Logger {
  return logger.child(bindings);
}

export type { Logger, Bindings } from 'pino';

type LogFn = (obj: object, msg?: string) => void;

/**
 * Route every `console.*` call through pino so third-party libraries that log
 * via the global console are captured as structured records. Call once at app
 * boot before any other import-time code may log.
 */
export function patchConsole(): void {
  const map: Array<[string, LogFn]> = [
    ['log', (o, m) => logger.info(o, m)],
    ['info', (o, m) => logger.info(o, m)],
    ['warn', (o, m) => logger.warn(o, m)],
    ['error', (o, m) => logger.error(o, m)],
    ['debug', (o, m) => logger.debug(o, m)],
    ['trace', (o, m) => logger.trace(o, m)],
  ];
  const ROUTED = Symbol.for('campuspilot.logger.consolePatched');
  const c = console as unknown as Record<string | symbol, unknown>;
  if (c[ROUTED]) return;
  for (const [consoleFn, log] of map) {
    c[consoleFn] = (...args: unknown[]) => {
      if (args.length === 0) {
        log({ via: 'console' }, '');
        return;
      }
      const [first, ...rest] = args;
      if (typeof first === 'string') {
        log({ via: 'console', ...(rest.length ? { args: rest } : {}) }, first);
      } else if (first instanceof Error) {
        log(
          { via: 'console', err: first, args: rest.length ? rest : undefined },
          first.message,
        );
      } else {
        log(
          {
            via: 'console',
            payload: first,
            args: rest.length ? rest : undefined,
          },
          'console',
        );
      }
    };
  }
  c[ROUTED] = true;
}
