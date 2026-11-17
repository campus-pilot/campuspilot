import { db } from '@campuspilot/db';

import type { ImageDerivativeTarget } from '../src/workflows/image-derivatives/constants';
import { processImageDerivatives, type DerivativeOutcome } from '../src/workflows/image-derivatives/process';

/**
 * Runs the worker's image derivative job in the test process instead of
 * handing it to Restate. A test file swaps the outbox's
 * `requestImageDerivatives` for {@link runDerivativesInline} with `vi.mock`
 * and awaits {@link settleDerivatives} before it looks at the result: the
 * processing is the worker's real code, only the hand-over is skipped (the
 * hand-over and the sweep have tests of their own).
 */
const pending: Array<Promise<DerivativeOutcome>> = [];
/** Jobs requested while {@link holdDerivatives} is on: they start only at the next {@link settleDerivatives}. */
const held: Array<() => Promise<DerivativeOutcome>> = [];
let holding = false;

export function runDerivativesInline(target: ImageDerivativeTarget, id: string) {
  const job = () => processImageDerivatives(db, target, id);
  if (holding) held.push(job);
  else pending.push(job());
}

/**
 * Keeps requested jobs from starting, like a busy worker, so a test can look
 * at a page or attachment while it is still `pending`. The next
 * {@link settleDerivatives} releases and runs them.
 */
export function holdDerivatives() {
  holding = true;
}

/** Runs any held jobs and waits until every job started so far (and any started meanwhile) has finished. */
export async function settleDerivatives() {
  holding = false;
  pending.push(...held.splice(0).map((job) => job()));
  while (pending.length > 0) await Promise.all(pending.splice(0));
}
