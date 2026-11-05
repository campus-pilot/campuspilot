import { serve } from '@hono/node-server';
import { env } from '@campuspilot/env/assistant';

import { migrateAssistantDatabase } from './db/client';
import { createAssistantApp } from './http';
import { log } from './log';
import { startRestateEndpoint } from './runtime/endpoint';

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
  const shutdown = (signal: string) => {
    log.info({ signal }, 'boot.shutdown.start');
    server.close();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  log.fatal({ err }, 'boot.failed');
  process.exit(1);
});
