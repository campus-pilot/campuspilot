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
  const handler = createEndpointHandler({
    services: [demoSchoolControlService, demoSchoolWorkflow, demoSchoolPurgeWorkflow],
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
