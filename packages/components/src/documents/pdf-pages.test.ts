import { describe, expect, it, vi } from 'vitest';

import { createPdfHolds } from './pdf-pages';

describe('a loaded PDF’s holds (owner release, viewer retain)', () => {
  it('is freed at once when its owner releases a document nothing shows', async () => {
    const destroy = vi.fn(async () => undefined);
    await createPdfHolds(destroy).release();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('is never freed while a viewer still shows it, however soon the owner releases it', async () => {
    const destroy = vi.fn(async () => undefined);
    const holds = createPdfHolds(destroy);
    const first = holds.retain();
    const second = holds.retain();
    await holds.release();
    first();
    expect(destroy).not.toHaveBeenCalled();
    second();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('is not freed by viewers letting go while the owner still holds it, and is freed once only', async () => {
    const destroy = vi.fn(async () => undefined);
    const holds = createPdfHolds(destroy);
    const viewer = holds.retain();
    viewer();
    // Letting go twice (a ref cleanup run again) does not count twice.
    viewer();
    expect(destroy).not.toHaveBeenCalled();
    await holds.release();
    await holds.release();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
