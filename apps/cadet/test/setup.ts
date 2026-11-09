import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/** Unmounts what each test rendered (Vitest globals are off, so it is not automatic). */
afterEach(() => {
  cleanup();
});

/** jsdom has no ResizeObserver; Recharts' responsive container needs one to mount. */
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
