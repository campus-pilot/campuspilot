import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/** Unmounts what each test rendered (Vitest globals are off, so it is not automatic). */
afterEach(() => {
  cleanup();
});
