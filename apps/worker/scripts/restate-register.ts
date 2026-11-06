/**
 * Registers the running worker with Restate: `pnpm --filter worker register`
 * (add `--force` to replace changed service definitions at the same URI).
 * Run after the worker starts, in deploy pipelines as well as by hand.
 */
import { registerWorkerDeployment } from '../src/register';

const deployment = await registerWorkerDeployment({ force: process.argv.includes('--force') });
console.log(`Registered Restate deployment ${deployment.id}: ${deployment.services.join(', ')}`);
