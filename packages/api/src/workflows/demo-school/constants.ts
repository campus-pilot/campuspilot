import type { SchoolTier } from "@campuspilot/db/feature-flags/catalogue";
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
  'notices',
  'question-papers',
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

/**
 * The subscription tier a new demo school is created on. A demo shows the
 * whole school (its seed is admissions, results, fees, notices and the
 * Cadet Portal), so it is on the tier that includes all of it. The
 * assistant is in no tier and stays off: every assistant request is paid
 * model usage, so a platform admin enables it for a demo deliberately (with
 * its limit and roles) on the school's AI page. WhatsApp is part of the
 * tier, and a demo still never sends any (`skipped: demo_school`).
 */
export const DEMO_SCHOOL_TIER = 'enterprise' as const satisfies SchoolTier;
