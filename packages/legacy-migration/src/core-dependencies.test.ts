import { expect, it } from 'vitest';

import {
  resolveImportCoreDependencies,
} from './import.ts';
import {
  resolveVerifyCoreDependencies,
} from './verify.ts';
import { verifyKubernetesWriterFence } from './writer-fence.ts';

it('keeps both production CLI cores pinned to the real Kubernetes fence', () => {
  const importer = resolveImportCoreDependencies();
  const verifier = resolveVerifyCoreDependencies();
  expect(importer.verifyWriterFence).toBe(verifyKubernetesWriterFence);
  expect(verifier.verifyWriterFence).toBe(verifyKubernetesWriterFence);
});
