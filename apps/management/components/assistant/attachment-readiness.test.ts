import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { AssistantAttachmentRef } from '@campuspilot/assistant-contract/attachments';

import { AttachmentNotProcessedError, READINESS_POLL_DELAYS_MS, READINESS_TIMEOUT_MS, waitUntilProcessed } from './attachment-readiness';

const ref = (derivativeStatus: AssistantAttachmentRef['derivativeStatus'], kind: 'image' | 'document' = 'image'): AssistantAttachmentRef => ({
  id: 'asat_1',
  kind,
  fileName: 'page.jpg',
  contentType: kind === 'image' ? 'image/jpeg' : 'application/pdf',
  byteSize: 10,
  width: null,
  height: null,
  previewable: derivativeStatus === 'ready',
  derivativeStatus,
});

test('a document or an already processed image resolves without reading', async () => {
  for (const start of [ref(null, 'document'), ref('ready'), ref('unsupported')]) {
    const result = await waitUntilProcessed(start, async () => {
      throw new Error('should not read');
    });
    assert.equal(result, start);
  }
});

test('a pending image is read again, with growing waits, until it is ready', async () => {
  const states = [ref('pending'), ref('pending'), ref('ready')];
  const waits: number[] = [];
  const result = await waitUntilProcessed(ref('pending'), async () => states.shift()!, {
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  assert.equal(result.derivativeStatus, 'ready');
  assert.equal(result.previewable, true);
  assert.deepEqual(waits, READINESS_POLL_DELAYS_MS.slice(0, 3));
});

test('a failed image rejects with a sentence that names the file', async () => {
  await assert.rejects(
    waitUntilProcessed(ref('pending'), async () => ref('failed'), { sleep: async () => undefined }),
    (error: unknown) => error instanceof AttachmentNotProcessedError && /page\.jpg could not be read/.test(error.message),
  );
});

test('an image still pending after the timeout rejects instead of waiting for ever', async () => {
  let clock = 0;
  await assert.rejects(
    waitUntilProcessed(ref('pending'), async () => ref('pending'), {
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
    }),
    (error: unknown) => error instanceof AttachmentNotProcessedError && /taking too long/.test(error.message),
  );
  assert.ok(clock >= READINESS_TIMEOUT_MS);
});
