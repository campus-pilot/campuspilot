import type {
  DemoSchoolJobDto,
  DemoSchoolPurgeDto,
} from '@campuspilot/api/routers/system-admin/demo-school/demo-school.dto';

export const STEP_LABELS: Record<DemoSchoolJobDto['steps'][number], string> = {
  staff: 'Staff',
  session: 'Session',
  classes: 'Classes',
  students: 'Students',
  exams: 'Exams',
  finance: 'Finance',
  templates: 'Templates',
  notices: 'Notices',
  credentials: 'Credentials',
};

/** What each running step is doing, for the progress toast. */
const STEP_ACTIVITY: Record<DemoSchoolJobDto['steps'][number], string> = {
  staff: 'Creating staff…',
  session: 'Creating the session…',
  classes: 'Creating classes…',
  students: 'Admitting students…',
  exams: 'Recording exams and results…',
  finance: 'Billing and collecting fees…',
  templates: 'Choosing document templates…',
  notices: 'Writing notices…',
  credentials: 'Generating staff logins…',
};

const PURGE_STAGE_ACTIVITY: Record<DemoSchoolPurgeDto['stages'][number], string> = {
  'stopping-seed': 'Stopping seeding…',
  'revoking-sessions': 'Signing out demo staff…',
  'deleting-data': 'Deleting school data…',
  'deleting-files': 'Deleting files…',
};

export type ProgressTone = 'active' | 'success' | 'error';

export type ProgressDescription = {
  tone: ProgressTone;
  /** One short line describing where the work is. */
  detail: string;
  /** 1-based position among the steps, when a step is running. */
  position: { current: number; total: number } | null;
};

/**
 * Describes a seeding job from its own recorded facts, in precedence order:
 * finished outcome, purge, then the hand-over chain (requested → accepted by
 * Restate → started by a worker) and finally the running step.
 */
export function describeDemoJob(job: DemoSchoolJobDto): ProgressDescription {
  if (job.status === 'succeeded') return { tone: 'success', detail: 'Ready to use.', position: null };
  if (job.status === 'failed') {
    const step = job.error ? (STEP_LABELS[job.error.step as keyof typeof STEP_LABELS] ?? 'Start') : null;
    return { tone: 'error', detail: job.error ? `${step}: ${job.error.message}` : 'Seeding failed.', position: null };
  }
  if (job.purgeRequestedAt) return { tone: 'error', detail: 'This demo school is being purged.', position: null };
  if (job.status === 'running' && job.currentStep) {
    return {
      tone: 'active',
      detail: STEP_ACTIVITY[job.currentStep],
      position: { current: job.steps.indexOf(job.currentStep) + 1, total: job.steps.length },
    };
  }
  if (job.status === 'running') return { tone: 'active', detail: 'Starting…', position: null };
  if (!job.startRequestedAt) return { tone: 'active', detail: 'Preparing…', position: null };
  if (!job.submittedAt) {
    return {
      tone: 'active',
      detail: job.lastSubmitError ? `Waiting for the workflow engine (${job.lastSubmitError}) Retrying…` : 'Handing over…',
      position: null,
    };
  }
  return { tone: 'active', detail: 'Queued; waiting for the demo worker…', position: null };
}

/** Describes a purge from its recorded status, stage and hand-over facts. */
export function describeDemoPurge(purge: DemoSchoolPurgeDto): ProgressDescription {
  if (purge.status === 'completed') return { tone: 'success', detail: 'The demo school and its files are gone.', position: null };
  if (purge.status === 'failed') {
    const retry = purge.automaticRetryPending ? ' It will be retried automatically.' : '';
    return { tone: 'error', detail: `${purge.error ?? 'The purge failed.'}${retry}`, position: null };
  }
  if (purge.stage) {
    return {
      tone: 'active',
      detail: PURGE_STAGE_ACTIVITY[purge.stage],
      position: { current: purge.stages.indexOf(purge.stage) + 1, total: purge.stages.length },
    };
  }
  if (purge.status === 'pending') {
    return {
      tone: 'active',
      detail: purge.lastSubmitError ? `Waiting for the workflow engine (${purge.lastSubmitError}) Retrying…` : 'Handing over…',
      position: null,
    };
  }
  return { tone: 'active', detail: 'Queued; waiting for the demo worker…', position: null };
}

export function isFinishedJob(job: DemoSchoolJobDto) {
  return job.status === 'succeeded' || job.status === 'failed';
}

export function isFinishedPurge(purge: DemoSchoolPurgeDto) {
  return purge.status === 'completed' || purge.status === 'failed';
}
