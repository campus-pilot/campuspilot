/**
 * Registers the running worker with Restate by hand: `pnpm --filter worker
 * register` (add `--force` to replace changed service definitions at the same
 * URI). The worker already registers itself on every start; this is only for
 * cases it cannot see, such as Restate losing its data while the worker keeps
 * running.
 */
import { registerWorkerDeployment } from '../src/register';

const deployment = await registerWorkerDeployment({ force: process.argv.includes('--force') });
console.log(`Registered Restate deployment ${deployment.id}: ${deployment.services.join(', ')}`);
