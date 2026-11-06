import { serve } from '@hono/node-server';
import { deleteUnusedDynamicOAuthClients } from '@campuspilot/auth/mcp-oauth';
import { db } from '@campuspilot/db';
import { runMigrations } from '@campuspilot/db/migrate';
import { env } from '@campuspilot/env/server';
import { resubmitPendingDemoPurges } from '@campuspilot/api/routers/system-admin/demo-school/demo-school.purge';

import { app, mcpCatalog, mcpHandler } from './http';
import { log } from './log';

async function phase<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  log.info({ phase: name }, 'boot.phase.start');
  try {
    const result = await fn();
    const durationMs = Math.round(performance.now() - start);
    log.info({ phase: name, durationMs }, 'boot.phase.ok');
    return result;
  } catch (err) {
    const durationMs = Math.round(performance.now() - start);
    log.error({ phase: name, durationMs, err }, 'boot.phase.fail');
    throw err;
  }
}

const DCR_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** How often the demo purge outbox resubmits S3 cleanups Restate never accepted. */
const DEMO_PURGE_OUTBOX_INTERVAL_MS = 10 * 60 * 1000;

/** Resubmits pending demo-school S3 cleanups; failures are retried next sweep. */
async function sweepDemoPurgeOutbox() {
  const result = await resubmitPendingDemoPurges();
  if (result.pending > 0) log.info(result, 'demo-school.purge-outbox.ok');
}

/** Removes dynamically registered OAuth clients that never got a grant. */
async function removeUnusedDynamicClients() {
  const deleted = await deleteUnusedDynamicOAuthClients(db);
  log.info({ deleted }, 'oauth.dcr-cleanup.ok');
}

async function main() {
  // Every later phase and request expects the current schema.
  await phase('db.migrate', () => runMigrations());
  await phase('mcp.catalog', async () => {
    await mcpCatalog;
  });
  // await phase('auth.seed', () => seedIamDatabase());
  await phase('oauth.dcr-cleanup', removeUnusedDynamicClients);
  // Daily thereafter; the delete is idempotent, so concurrent instances are safe.
  const dcrCleanup = setInterval(() => {
    void removeUnusedDynamicClients().catch((err) => {
      log.error({ err }, 'oauth.dcr-cleanup.error');
    });
  }, DCR_CLEANUP_INTERVAL_MS);
  dcrCleanup.unref();
  const sweepOutbox = () => {
    void sweepDemoPurgeOutbox().catch((err) => {
      log.error({ err }, 'demo-school.purge-outbox.error');
    });
  };
  sweepOutbox();
  const demoPurgeOutbox = setInterval(sweepOutbox, DEMO_PURGE_OUTBOX_INTERVAL_MS);
  demoPurgeOutbox.unref();

  const server = serve(
    {
      fetch: app.fetch,
      port: env.SERVER_PORT,
    },
    (info) => {
      log.info(
        { port: info.port, url: `http://localhost:${info.port}` },
        'boot.server.listening',
      );
    },
  );

  const shutdown = (signal: string) => {
    log.info({ signal }, 'boot.shutdown.start');
    clearInterval(dcrCleanup);
    clearInterval(demoPurgeOutbox);
    void mcpHandler.close().catch((err) => {
      log.error({ err }, 'mcp.shutdown.error');
    });
    server.close((err) => {
      if (err) log.error({ err }, 'boot.shutdown.error');
      else log.info('boot.shutdown.ok');
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  log.fatal({ err }, 'boot.failed');
  process.exit(1);
});
