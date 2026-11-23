import { z } from 'zod';

/**
 * Restate names and keys of the school setup. Kept free of runtime imports
 * so the API can reference the services by name and type without importing
 * the workflow implementation.
 */
export const SCHOOL_SETUP_WORKFLOW_NAME = 'SchoolSetup';
/** The only ingress-callable school setup service; it checks the setup row before starting the workflow. */
export const SCHOOL_SETUP_CONTROL_SERVICE_NAME = 'SchoolSetupControl';
export type SchoolSetupControlHandler = 'start';

/** The input of the control service and of the workflow: one attempt of one setup. */
export const schoolSetupWorkflowInputSchema = z.object({
  setupId: z.string().regex(/^ssetup_[a-z0-9]{21}$/),
  attempt: z.number().int().positive().max(1_000),
});
export type SchoolSetupWorkflowInput = z.infer<typeof schoolSetupWorkflowInputSchema>;

/** The Restate workflow key of one attempt; a retry uses a new attempt. */
export function schoolSetupWorkflowKey(setupId: string, attempt: number) {
  return `${setupId}.${attempt}`;
}

/** The idempotency key of one attempt's hand-over; every re-send joins the first. */
export function schoolSetupIdempotencyKey(setupId: string, attempt: number) {
  return `school-setup:${setupId}.${attempt}`;
}
