import { log } from './log';
import { registerWorkerDeployment } from './register';
import { startWorker } from './server';

/**
 * Development entry (`pnpm dev`): starts the worker, then (re-)registers it
 * with the local Restate server. `force` lets edited handlers replace the
 * previous registration at the same local URI.
 */
async function main() {
  await startWorker();
  const deployment = await registerWorkerDeployment({ force: true });
  log.info(deployment, 'worker.dev.registered');
}

main().catch((err) => {
  log.fatal({ err }, 'worker.dev.failed');
  process.exit(1);
});
