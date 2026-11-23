import { randomUUID } from 'node:crypto';

import { getRedisClient } from '@campuspilot/redis/client';
import { describe, expect, it } from 'vitest';

import { PREVIEW_CONVERSIONS_PER_USER, PREVIEW_SLOT_TTL_MS, withPreviewConversionSlot } from './document.preview-slots';

/** A conversion that runs until `finish` is called, so a test can hold its slot. */
function heldConversion() {
  let finish!: () => void;
  const done = new Promise<string>((resolve) => (finish = () => resolve('converted')));
  return { done, finish };
}

describe('template preview conversion slots (one Redis set per person, shared by every replica)', () => {
  it('lets a person hold the limit at once, refuses one more with TOO_MANY_REQUESTS, and frees a slot when a conversion ends', async () => {
    const userId = `usr_${randomUUID()}`;
    const held = Array.from({ length: PREVIEW_CONVERSIONS_PER_USER }, heldConversion);
    const running = held.map((conversion) => withPreviewConversionSlot(userId, () => conversion.done));

    await expect(withPreviewConversionSlot(userId, async () => 'extra')).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    // Someone else is not affected.
    await expect(withPreviewConversionSlot(`usr_${randomUUID()}`, async () => 'theirs')).resolves.toBe('theirs');

    held[0]!.finish();
    await expect(running[0]).resolves.toBe('converted');
    await expect(withPreviewConversionSlot(userId, async () => 'next')).resolves.toBe('next');
    for (const conversion of held.slice(1)) conversion.finish();
    await Promise.all(running);
  });

  it('frees the slot of a conversion that failed or was aborted', async () => {
    const userId = `usr_${randomUUID()}`;
    for (let attempt = 0; attempt < PREVIEW_CONVERSIONS_PER_USER + 1; attempt += 1) {
      await expect(
        withPreviewConversionSlot(userId, async () => {
          throw new DOMException('The operation was aborted.', 'AbortError');
        }),
      ).rejects.toMatchObject({ name: 'AbortError' });
    }
    await expect(withPreviewConversionSlot(userId, async () => 'after')).resolves.toBe('after');
  });

  it('drops a slot older than its TTL, so a replica that died mid-conversion cannot hold it for good', async () => {
    const userId = `usr_${randomUUID()}`;
    const key = `server:doc-preview:slots:${userId}`;
    const longAgo = Date.now() - PREVIEW_SLOT_TTL_MS - 1_000;
    // Slots a crashed process took and never released.
    await getRedisClient().zadd(key, ...Array.from({ length: PREVIEW_CONVERSIONS_PER_USER }, (_, index) => [longAgo, `lost-${index}`]).flat());

    await expect(withPreviewConversionSlot(userId, async () => 'converted')).resolves.toBe('converted');
    expect(await getRedisClient().zcard(key)).toBe(0);
  });

  it('runs the conversion without a slot when Redis cannot be reached', async () => {
    const unreachable = {
      eval: async () => {
        throw new Error('Connection is closed.');
      },
      zrem: async () => 0,
    };
    await expect(withPreviewConversionSlot(`usr_${randomUUID()}`, async () => 'converted', { redis: unreachable })).resolves.toBe('converted');
  });
});
