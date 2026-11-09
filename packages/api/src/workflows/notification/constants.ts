/**
 * Restate names for notifications. Kept free of runtime imports so the API
 * can reference the services by name and type without importing the worker
 * implementation.
 */
export const NOTIFICATION_DISPATCH_WORKFLOW_NAME = 'NotificationDispatch';
/** The only ingress-callable notification service; it validates the event before starting the workflow. */
export const NOTIFICATION_CONTROL_SERVICE_NAME = 'NotificationControl';

/**
 * Fan-out attempts per event: the first plus automatic retries of
 * retryable failures (see `notifications/notification.outbox.ts`).
 */
export const MAX_NOTIFICATION_DISPATCH_ATTEMPTS = 3;

/**
 * Workflow key of one fan-out attempt. A workflow key runs once, so each
 * retry gets its own: the event ID for attempt 1 (unchanged from before
 * retries existed), `{eventId}.{attempt}` after.
 */
export function notificationDispatchWorkflowKey(eventId: string, attempt: number = 1): string {
  return attempt === 1 ? eventId : `${eventId}.${attempt}`;
}

/** Restate's idempotency key for handing one fan-out attempt to the control service. */
export function notificationHandoverKey(eventId: string, attempt: number = 1): string {
  return attempt === 1 ? `notification-dispatch:${eventId}` : `notification-dispatch:${eventId}.${attempt}`;
}
