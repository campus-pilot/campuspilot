import { serve } from '@hono/node-server';
import {
  CADET_OAUTH_SERVER_TABLES,
  deleteUnusedDynamicOAuthClients,
} from '@campuspilot/auth/mcp-oauth';
import { db } from '@campuspilot/db';
import { runMigrations } from '@campuspilot/db/migrate';
import { env } from '@campuspilot/env/server';
import { sweepAssistantOutbox } from '@campuspilot/assistant/dispatch';
import { sweepDemoSchoolOutbox } from '@campuspilot/api/routers/system-admin/demo-school/demo-school.outbox';
import { sweepDataMigrationOutbox } from '@campuspilot/api/data-migrations/data-migration.outbox';
import { DATA_MIGRATIONS } from '@campuspilot/api/data-migrations/registry';
import { sweepNotificationOutbox } from '@campuspilot/api/notifications/notification.outbox';
import { sweepNotificationRetention } from '@campuspilot/api/notifications/retention';
import { sweepResultPublications } from '@campuspilot/api/notifications/emitters/results';
import { sweepWhatsAppFailureAlerts } from '@campuspilot/api/notifications/failure-alerts';

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
 * One data migration sweep. It registers an apply run for each migration in
 * `register` that needs one and returns those still without one (a dry run
 * was active); the run is handed to the worker and the server never waits
 * for it (D-36), so the code must tolerate rows a migration has not reached
 * yet.
 */
async function sweepDataMigrations(register: readonly string[]) {
  const result = await sweepDataMigrationOutbox({ register });
  if (Object.values(result.counts).some((value) => value > 0)) log.info(result.counts, 'data-migration.outbox.ok');
  return result.awaitingRegistration;
}

/**
 * One notification outbox sweep: re-sends events whose hand-over after
 * commit failed or never happened, and fails fan-outs Restate paused or
 * ended. Requests never wait for it.
 */
async function sweepNotifications() {
  const result = await sweepNotificationOutbox();
  if (Object.values(result).some((value) => value > 0)) log.info(result, 'notification.outbox.ok');
}

/**
 * One assistant outbox sweep: hands over runs and approval decisions whose
 * hand-over after commit failed, and fails runs Restate never accepted.
 */
async function sweepAssistant() {
  const result = await sweepAssistantOutbox();
  if (Object.values(result).some((value) => value > 0)) log.info(result, 'assistant.outbox.ok');
}

/** Finishes result publications whose deliveries settled (publisher notified once). */
async function sweepPublications() {
  const publications = await sweepResultPublications();
  if (publications.finished > 0) log.info(publications, 'notification.results.sweep.ok');
}

/**
 * The sweeps of the chained 30 s loop, in order. Each runs in isolation: a
 * failing sweep (for example Restate unreachable) is logged under its own
 * error message and never keeps the later, database-only sweeps from running.
 */
const OUTBOX_SWEEPS: ReadonlyArray<{ errorMessage: string; run: () => Promise<void> }> = [
  { errorMessage: 'demo-school.outbox.error', run: sweepDemoOutbox },
  { errorMessage: 'notification.outbox.error', run: sweepNotifications },
  { errorMessage: 'assistant.outbox.error', run: sweepAssistant },
  { errorMessage: 'notification.results.sweep.error', run: sweepPublications },
  // Reports failed WhatsApp deliveries to staff granted to receive them (D-30).
  { errorMessage: 'notification.failure-alerts.error', run: async () => { await sweepWhatsAppFailureAlerts(); } },
];

/** How often old notifications are deleted (see `@campuspilot/api/notifications/retention`). */
const NOTIFICATION_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** One retention pass; idempotent, so concurrent instances are safe. */
async function removeExpiredNotifications() {
  const result = await sweepNotificationRetention(db);
  log.info(result, 'notification.retention.ok');
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
  // Notification retention: once after boot (not awaited), then daily.
  void removeExpiredNotifications().catch((err) => {
    log.error({ err }, 'notification.retention.error');
  });
  const notificationRetention = setInterval(() => {
    void removeExpiredNotifications().catch((err) => {
      log.error({ err }, 'notification.retention.error');
    });
  }, NOTIFICATION_RETENTION_INTERVAL_MS);
  notificationRetention.unref();
  // Chained, not setInterval: the next sweep is scheduled only after the
  // previous one finished, so slow sweeps never overlap on this instance.
  // Across replicas, every write of a sweep is conditional, so overlapping
  // sweeps on two instances change nothing twice.
  let demoOutbox: NodeJS.Timeout | undefined;
  let stopped = false;
  // Every data migration is registered on the first sweep after boot; one
  // whose registration was blocked (an admin's dry run was active) is retried
  // on every sweep until it has an apply run. A failed sweep retries the same set.
  let dataMigrationsToRegister: readonly string[] = DATA_MIGRATIONS.map((migration) => migration.id);
  const sweepOutbox = async () => {
    try {
      dataMigrationsToRegister = await sweepDataMigrations(dataMigrationsToRegister);
    } catch (err) {
      log.error({ err }, 'data-migration.outbox.error');
    }
    for (const sweep of OUTBOX_SWEEPS) {
      try {
        await sweep.run();
      } catch (err) {
        log.error({ err }, sweep.errorMessage);
      }
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
    clearInterval(notificationRetention);
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
