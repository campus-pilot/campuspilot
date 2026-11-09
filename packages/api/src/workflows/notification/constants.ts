/**
 * Restate names for notifications. Kept free of runtime imports so the API
 * can reference the services by name and type without importing the worker
 * implementation.
 */
export const NOTIFICATION_DISPATCH_WORKFLOW_NAME = 'NotificationDispatch';
/** The only ingress-callable notification service; it validates the event before starting the workflow. */
export const NOTIFICATION_CONTROL_SERVICE_NAME = 'NotificationControl';

/** Workflow key of one event's fan-out: the event ID (a workflow key runs once). */
export function notificationDispatchWorkflowKey(eventId: string): string {
  return eventId;
}

/** Restate's idempotency key for handing one event to the control service. */
export function notificationHandoverKey(eventId: string): string {
  return `notification-dispatch:${eventId}`;
}
