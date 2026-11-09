import { db } from '@campuspilot/db';
import * as restate from '@restatedev/restate-sdk';

import {
  failNotificationEvent,
  NotificationDispatchError,
  runNotificationDispatch,
  type NotificationDispatchResult,
} from '../../notifications/dispatch';
import { NOTIFICATION_DISPATCH_WORKFLOW_NAME, notificationDispatchWorkflowKey } from './constants';
import { notificationDispatchInputSchema, type NotificationDispatchInput } from './input';
import { log } from './log';

/** Error code marking a deterministic failure whose message is safe to record. */
const SAFE_FAILURE_CODE = 422;
const UNEXPECTED_FAILURE = 'A database operation failed repeatedly; the worker log has the details.';

/** Bounded retries for transient failures (connection loss, lock timeouts). */
const STEP_OPTIONS = {
  maxRetryAttempts: 8,
  initialRetryInterval: 1_000,
  retryIntervalFactor: 2,
  maxRetryInterval: 60_000,
} as const;

/** Error details for the log only: the message before any SQL parameters and the database code. */
function describe(error: unknown) {
  if (!(error instanceof Error)) return { message: String(error).slice(0, 300) };
  const cause = error.cause as { code?: unknown } | undefined;
  return {
    name: error.name,
    message: error.message.split('\nparams:')[0]!.slice(0, 500),
    code: typeof cause?.code === 'string' ? cause.code : undefined,
  };
}

/**
 * Runs one journaled unit. Deterministic failures become terminal at once;
 * anything else is replaced by a generic retryable error so Restate's failure
 * text never contains SQL, parameters or payloads.
 */
function step<T>(ctx: restate.WorkflowContext, name: string, action: () => Promise<T>) {
  return ctx.run(name, async () => {
    try {
      return await action();
    } catch (error) {
      if (error instanceof restate.TerminalError) throw error;
      if (error instanceof NotificationDispatchError) throw new restate.TerminalError(error.message, { errorCode: SAFE_FAILURE_CODE });
      log.error({ workflow: NOTIFICATION_DISPATCH_WORKFLOW_NAME, key: ctx.key, step: name, err: describe(error) }, 'notification.step.error');
      throw new Error(UNEXPECTED_FAILURE);
    }
  }, STEP_OPTIONS);
}

/**
 * `NotificationDispatch` fans out one `notification_event` (D-24): inbox rows
 * per recipient, delivery rows per remote channel, then sends owed copies
 * in throttled rounds with durable sleeps (see `runNotificationDispatch`).
 * Its key is the event ID plus the fan-out attempt, so each attempt runs
 * once; every write is idempotent besides (derived IDs, `ON CONFLICT DO
 * NOTHING`, claim before send). Private to ingress: only
 * `NotificationControl`, which validates the event first, starts it. A
 * terminal failure is recorded on the event with a safe message.
 */
export const notificationDispatchWorkflow = restate.workflow({
  name: NOTIFICATION_DISPATCH_WORKFLOW_NAME,
  options: { ingressPrivate: true },
  handlers: {
    run: async (ctx: restate.WorkflowContext, rawInput: NotificationDispatchInput): Promise<NotificationDispatchResult> => {
      const parsed = notificationDispatchInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new restate.TerminalError('Invalid notification dispatch input.', { errorCode: 400 });
      const { eventId, attempt } = parsed.data;
      if (ctx.key !== notificationDispatchWorkflowKey(eventId, attempt)) {
        throw new restate.TerminalError('The workflow key does not match the event.', { errorCode: 400 });
      }
      try {
        const result = await runNotificationDispatch({
          eventId,
          step: (name, action) => step(ctx, name, action),
          // Durable: the workflow suspends and resumes after the backoff, surviving worker restarts.
          sleep: (name, ms) => ctx.sleep(ms, name),
        });
        log.info({ eventId, ...result }, 'notification.dispatch.finished');
        return result;
      } catch (error) {
        if (error instanceof restate.TerminalError) {
          const cancelled = error instanceof restate.CancelledError;
          const deterministic = !cancelled && error.code === SAFE_FAILURE_CODE;
          const message = cancelled ? 'The dispatch was cancelled.' : deterministic ? error.message : UNEXPECTED_FAILURE;
          // Only exhausted transient failures may be retried; a deterministic
          // failure would fail again and a cancellation was deliberate.
          const retryable = !cancelled && !deterministic;
          await ctx.run('mark-failed', () => failNotificationEvent(db, eventId, message, { retryable, attempt }));
          log.warn({ eventId, attempt, message, retryable }, 'notification.dispatch.failed');
        }
        throw error;
      }
    },
  },
});

export type NotificationDispatchWorkflow = typeof notificationDispatchWorkflow;
