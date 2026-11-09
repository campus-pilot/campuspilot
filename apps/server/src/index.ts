import { serve } from '@hono/node-server';
import {
  CADET_OAUTH_SERVER_TABLES,
  deleteUnusedDynamicOAuthClients,
} from '@campuspilot/auth/mcp-oauth';
import { db } from '@campuspilot/db';
import { runMigrations } from '@campuspilot/db/migrate';
import { env } from '@campuspilot/env/server';
import { sweepDemoSchoolOutbox } from '@campuspilot/api/routers/system-admin/demo-school/demo-school.outbox';
import { sweepDataMigrationOutbox } from '@campuspilot/api/data-migrations/data-migration.outbox';

import { app, cadetMcpCatalog, cadetMcpHandler, mcpCatalog, mcpHandler } from './http';
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
/**
 * How often the demo outbox re-sends starts and purges Restate has not
 * accepted and checks accepted runs for pauses. Kick-offs hand over
 * immediately; this is the fallback, so it bounds the delay after an outage.
 */
const DEMO_OUTBOX_INTERVAL_MS = 30 * 1000;

/** One demo outbox sweep; failures are retried next sweep. */
async function sweepDemoOutbox() {
  const result = await sweepDemoSchoolOutbox();
  if (Object.values(result).some((value) => value > 0)) log.info(result, 'demo-school.outbox.ok');
}

/**
 * One data migration sweep. The first successful sweep after boot also
 * registers an apply run for every data migration that needs one; the run is
 * handed to the worker and the server never waits for it (D-36), so the code
 * must tolerate rows a migration has not reached yet.
 */
async function sweepDataMigrations(register: boolean) {
  const result = await sweepDataMigrationOutbox({ register });
  if (Object.values(result).some((value) => value > 0)) log.info(result, 'data-migration.outbox.ok');
}

/**
 * Removes dynamically registered OAuth clients that never got a grant, for
 * the staff and the cadet authorization servers.
 */
async function removeUnusedDynamicClients() {
  const deleted = await deleteUnusedDynamicOAuthClients(db);
  const cadetDeleted = await deleteUnusedDynamicOAuthClients(db, new Date(), CADET_OAUTH_SERVER_TABLES);
  log.info({ deleted, cadetDeleted }, 'oauth.dcr-cleanup.ok');
}

async function main() {
  // Every later phase and request expects the current schema.
  await phase('db.migrate', () => runMigrations());
  await phase('mcp.catalog', async () => {
    await mcpCatalog;
  });
  await phase('cadet.mcp.catalog', async () => {
    await cadetMcpCatalog;
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
  // Chained, not setInterval: the next sweep is scheduled only after the
  // previous one finished, so slow sweeps never overlap on this instance.
  // Across replicas, the sweep claims rows with FOR UPDATE SKIP LOCKED.
  let demoOutbox: NodeJS.Timeout | undefined;
  let stopped = false;
  // Registration of pending data migrations is retried on every sweep until
  // it succeeds once, then never again during this process.
  let dataMigrationsRegistered = false;
  const sweepOutbox = async () => {
    try {
      await sweepDemoOutbox();
    } catch (err) {
      log.error({ err }, 'demo-school.outbox.error');
    }
    try {
      await sweepDataMigrations(!dataMigrationsRegistered);
      dataMigrationsRegistered = true;
    } catch (err) {
      log.error({ err }, 'data-migration.outbox.error');
    }
    if (stopped) return;
    demoOutbox = setTimeout(() => void sweepOutbox(), DEMO_OUTBOX_INTERVAL_MS);
    demoOutbox.unref();
  };
  void sweepOutbox();

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
    stopped = true;
    clearTimeout(demoOutbox);
    void mcpHandler.close().catch((err) => {
      log.error({ err }, 'mcp.shutdown.error');
    });
    void cadetMcpHandler.close().catch((err) => {
      log.error({ err }, 'cadet.mcp.shutdown.error');
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
