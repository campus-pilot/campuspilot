import { log } from './log';
import { startWorker } from './server';

// Production entry. Deployments register the worker with Restate separately
// (`node dist/restate-register.mjs` or `pnpm --filter worker register`).
startWorker().catch((err) => {
  log.fatal({ err }, 'worker.boot.failed');
  process.exit(1);
});
