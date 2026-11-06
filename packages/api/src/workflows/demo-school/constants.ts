/**
 * Restate service names and the ordered product steps. Kept free of runtime
 * imports so the API router can reference the workflows by name and type
 * without importing the workflow implementation (which imports the router).
 */
export const DEMO_SCHOOL_WORKFLOW_NAME = 'DemoSchool';
export const DEMO_SCHOOL_PURGE_WORKFLOW_NAME = 'DemoSchoolPurge';
/** The only ingress-callable demo service; it validates IDs before starting a workflow. */
export const DEMO_SCHOOL_CONTROL_SERVICE_NAME = 'DemoSchoolControl';

/** The steps the admin progress view shows, in execution order. */
export const DEMO_SCHOOL_STEPS = [
  'staff',
  'session',
  'classes',
  'students',
  'exams',
  'finance',
  'templates',
  'credentials',
] as const;

export type DemoSchoolStep = (typeof DEMO_SCHOOL_STEPS)[number];

/** The Restate workflow key for one attempt of a job; a retry uses a new attempt. */
export function demoSchoolWorkflowKey(jobId: string, attempt: number): string {
  return `${jobId}.${attempt}`;
}

/** Private S3 key of a demo school's credentials CSV. */
export function demoCredentialsS3Key(schoolId: string): string {
  return `schools/${schoolId}/demo/credentials.csv`;
}
