import { DEMO_SCHOOL_WORKFLOW_NAME } from './constants';
import { queryRestateAdmin, RESTATE_INVOCATION_ID } from '../restate-admin';

/**
 * Demo-specific Restate admin queries. The generic invocation helpers live in
 * `../restate-admin.ts` and are re-exported here for the demo modules.
 */
export {
  cancelRestateInvocation,
  getRestateInvocation,
  type RestateInvocationStatus,
} from '../restate-admin';

const JOB_ID = /^dsj_[a-z0-9]{21}$/;

/**
 * Every `DemoSchool` run of these jobs that has not completed, whatever
 * attempt started it. Found by workflow key (`{jobId}.{attempt}`) rather than
 * by the invocation ID recorded on the job, so a run that started just before
 * a purge recorded its intent is found even if its ID was not recorded yet.
 */
export async function listLiveDemoSeedInvocations(jobIds: string[]): Promise<string[]> {
  const ids = jobIds.filter((id) => JOB_ID.test(id));
  if (ids.length === 0) return [];
  const keyFilter = ids.map((id) => `target_service_key LIKE '${id}.%'`).join(' OR ');
  const rows = await queryRestateAdmin<{ id: string }>(
    `SELECT id FROM sys_invocation WHERE target_service_name = '${DEMO_SCHOOL_WORKFLOW_NAME}' AND status <> 'completed' AND (${keyFilter})`,
  );
  return rows.map((row) => row.id).filter((id) => RESTATE_INVOCATION_ID.test(id)).sort();
}
