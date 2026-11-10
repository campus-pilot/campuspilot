import { serve } from '@hono/node-server';
import { env } from '@campuspilot/env/assistant';

import { migrateAssistantDatabase } from './db/client';
import { createAssistantApp } from './http';
import { log } from './log';
import { startRestateEndpoint } from './runtime/endpoint';

/** How long open requests get to finish after a stop signal. */
const SHUTDOWN_GRACE_MS = 10_000;

async function phase<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    log.info({ phase: name, durationMs: Math.round(performance.now() - start) }, 'boot.phase.ok');
    return result;
  } catch (err) {
    log.error({ phase: name, err }, 'boot.phase.fail');
    throw err;
  }
}

async function main() {
  await phase('db.migrate', migrateAssistantDatabase);
  await phase('restate.endpoint', startRestateEndpoint);
  const app = createAssistantApp();
  const server = serve({ fetch: app.fetch, port: env.ASSISTANT_PORT }, (info) => {
    log.info({ port: info.port }, 'boot.server.listening');
  });
  if (env.ASSISTANT_DIAGNOSTICS && env.NODE_ENV === 'production') {
    // Every user of this deployment sees token counts, cost and raw errors.
    log.warn('assistant.diagnostics.on-in-production');
  }
  /**
   * Stops taking requests and exits. Open conversation streams never end on
   * their own, so `close` alone would hang until the process is killed:
   * after the grace period the process exits anyway. Browsers reconnect to
   * another instance and resume from their last event; turns in flight are
   * Restate's and continue there.
   */
  const shutdown = (signal: string) => {
    log.info({ signal }, 'boot.shutdown.start');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  log.fatal({ err }, 'boot.failed');
  process.exit(1);
});
