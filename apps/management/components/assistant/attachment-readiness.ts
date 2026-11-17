import type { AssistantAttachmentRef } from '@campuspilot/assistant-contract/attachments';

/** Waits between status reads: quick at first (a copy takes well under a second), then at most once a second. */
export const READINESS_POLL_DELAYS_MS = [250, 400, 600, 800, 1000] as const;
/** Gives up after this long; the server fails a copy that is still not made after ten minutes anyway. */
export const READINESS_TIMEOUT_MS = 2 * 60 * 1000;

/** Raised when an image could not be processed; its message is shown on the composer tile. */
export class AttachmentNotProcessedError extends Error {}

/**
 * Resolves with the attachment once the server has made its image copies
 * (`derivativeStatus` is no longer `pending`), reading its current reference
 * with `read`. A document, or an image already processed, resolves at once.
 * An image that `failed`, or one still pending after
 * {@link READINESS_TIMEOUT_MS}, rejects with a sentence for the composer. A
 * plain async loop, not an effect: it belongs to the one upload that started
 * it and ends with it.
 */
export async function waitUntilProcessed(
  ref: AssistantAttachmentRef,
  read: (attachmentId: string) => Promise<AssistantAttachmentRef>,
  options: { sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<AssistantAttachmentRef> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const started = now();
  let current = ref;
  for (let attempt = 0; current.derivativeStatus === 'pending'; attempt += 1) {
    if (now() - started >= READINESS_TIMEOUT_MS) {
      throw new AttachmentNotProcessedError(`${current.fileName} is taking too long to process. Remove it and attach it again.`);
    }
    await sleep(READINESS_POLL_DELAYS_MS[Math.min(attempt, READINESS_POLL_DELAYS_MS.length - 1)]!);
    current = await read(current.id);
  }
  if (current.derivativeStatus === 'failed') {
    throw new AttachmentNotProcessedError(`${current.fileName} could not be read as an image. Attach a JPEG or PNG instead.`);
  }
  return current;
}
