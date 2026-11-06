import { log } from './log';
import { startWorker } from './server';

// Entry for production and `pnpm dev`. The worker registers itself with
// Restate once it is listening (see server.ts).
startWorker().catch((err) => {
  log.fatal({ err }, 'worker.boot.failed');
  process.exit(1);
});
