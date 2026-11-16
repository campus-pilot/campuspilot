/**
 * Restate names and keys of the image derivative job (`process.ts`). Kept
 * free of runtime imports so the API can name the worker's service without
 * importing sharp or the processing code (see `restate.ts`).
 */

/** The ingress-callable service that makes the derivatives of one stored image. */
export const IMAGE_DERIVATIVE_CONTROL_SERVICE_NAME = 'ImageDerivativeControl';

/** Handlers of `ImageDerivativeControl`; each signature is bound to one. */
export type ImageDerivativeControlHandler = 'makeDerivatives';

/** What an image derivative job is for: a question paper page or a chat attachment. */
export const IMAGE_DERIVATIVE_TARGETS = ['page', 'attachment'] as const;
export type ImageDerivativeTarget = (typeof IMAGE_DERIVATIVE_TARGETS)[number];

/**
 * The Restate idempotency key of one image's job. One per row: a repeated
 * send (the hand-over after commit, then the sweep) joins the same
 * invocation, and the row's `pending` status fences the write anyway.
 */
export function imageDerivativeIdempotencyKey(target: ImageDerivativeTarget, id: string): string {
  return `img-deriv:${target}:${id}`;
}

/**
 * How long a stored image may stay `pending` before the sweep marks it
 * `failed`, so the screen stops waiting and says to upload it again. A
 * derivative takes well under a second; this covers a worker restart and a
 * Restate backlog.
 */
export const IMAGE_DERIVATIVE_DEADLINE_MS = 10 * 60 * 1000;

/** A `pending` image older than this is handed to Restate again by the sweep (the first hand-over may have failed). */
export const IMAGE_DERIVATIVE_RESEND_AFTER_MS = 30 * 1000;
