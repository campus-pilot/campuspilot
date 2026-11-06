import { createServer } from 'node:http2';
import {
  demoSchoolControlService,
  demoSchoolPurgeWorkflow,
  demoSchoolWorkflow,
} from '@campuspilot/api/workflows/demo-school';
import { env } from '@campuspilot/env/worker';
import { createEndpointHandler } from '@restatedev/restate-sdk';

import { log } from './log';

/**
 * Hosts the Restate services in an HTTP/2 server. `restate.serve` offers no
 * way to close its server, so the handler is mounted on our own server to
 * shut down cleanly: stop accepting invocations, let in-flight ones finish
 * their current step, then exit. Restate resumes anything interrupted.
 */
export function startWorker() {
  // Request signing: with identity keys the endpoint rejects any request not
  // signed by our Restate server. They are optional only outside production
  // (see @campuspilot/env/worker), where an absent value means unsigned dev.
  if (!env.RESTATE_IDENTITY_KEYS) log.warn('worker.identity-keys.absent');
  const handler = createEndpointHandler({
    services: [demoSchoolControlService, demoSchoolWorkflow, demoSchoolPurgeWorkflow],
    identityKeys: env.RESTATE_IDENTITY_KEYS,
  });
  const server = createServer(handler);
  const ready = new Promise<void>((resolve) => {
    server.listen(env.WORKER_PORT, () => {
      log.info({ port: env.WORKER_PORT }, 'worker.listening');
      resolve();
    });
  });

  const shutdown = (signal: string) => {
    log.info({ signal }, 'worker.shutdown.start');
    server.close((err) => {
      if (err) log.error({ err }, 'worker.shutdown.error');
      else log.info('worker.shutdown.ok');
      process.exit(err ? 1 : 0);
    });
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  return ready;
}
