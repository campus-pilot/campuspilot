import type { DatabaseExecutor } from '@campuspilot/db';
import type { SchoolTier } from '@campuspilot/db/feature-flags/catalogue';
import { activeSchoolTrialCondition } from '@campuspilot/db/feature-flags/store';
import { schoolTrialTable } from '@campuspilot/db/schema/school-trial';
import { and, desc, eq, sql } from 'drizzle-orm';

import { rpcError } from '../../../errors';
import { MAX_TRIAL_DAYS } from '../school/school.dto';
import { schoolTrialDtoSchema, type SchoolTrialDto } from './school-trial.dto';

/**
 * Writes and reads of school trials (docs/school-trials.md) for the system
 * admin procedures. Callers lock the school row first (`FOR UPDATE`), so two
 * administrators changing one school's trials are applied one after the
 * other; the table's EXCLUDE constraint still refuses an overlap that
 * slipped past (answered as CONFLICT by {@link trialOverlapConflict}).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The columns of a trial DTO, with `active` decided by the database's clock. */
const trialColumns = {
  id: schoolTrialTable.id,
  schoolId: schoolTrialTable.schoolId,
  tier: schoolTrialTable.tier,
  startsAt: schoolTrialTable.startsAt,
  endsAt: schoolTrialTable.endsAt,
  endedAt: schoolTrialTable.endedAt,
  active: sql<boolean>`${activeSchoolTrialCondition()}`,
  createdBy: schoolTrialTable.createdBy,
  endedBy: schoolTrialTable.endedBy,
  createdAt: schoolTrialTable.createdAt,
};

/**
 * Parses a submitted end and checks it: in the future, after the trial's
 * start (when known), and at most {@link MAX_TRIAL_DAYS} days from now.
 */
export function parseTrialEnd(endsAt: string, startsAt: Date | null = null): Date {
  const end = new Date(endsAt);
  const now = Date.now();
  if (end.getTime() <= now) throw rpcError.badRequest('The trial must end in the future.');
  if (startsAt !== null && end.getTime() <= startsAt.getTime()) throw rpcError.badRequest('The trial must end after it starts.');
  if (end.getTime() > now + MAX_TRIAL_DAYS * DAY_MS) {
    throw rpcError.badRequest(`A trial can run for at most ${MAX_TRIAL_DAYS} days from now.`);
  }
  return end;
}

/** The PostgreSQL exclusion violation of `school_trial_no_overlap` as CONFLICT, or null for any other error. */
export function trialOverlapConflict(error: unknown) {
  let current: unknown = error;
  while (typeof current === 'object' && current !== null) {
    if ('code' in current && current.code === '23P01') {
      return rpcError.conflict('This school already has a trial at that time. Change or end it instead.', current);
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return null;
}

/** One trial of a school, or null when the school has no trial with that id. */
export async function readSchoolTrial(db: DatabaseExecutor, schoolId: string, trialId: string): Promise<SchoolTrialDto | null> {
  const [trial] = await db
    .select(trialColumns)
    .from(schoolTrialTable)
    .where(and(eq(schoolTrialTable.id, trialId), eq(schoolTrialTable.schoolId, schoolId)))
    .limit(1);
  return trial ? schoolTrialDtoSchema.parse(trial) : null;
}

/** Every trial of a school, newest first. */
export async function listSchoolTrials(db: DatabaseExecutor, schoolId: string): Promise<SchoolTrialDto[]> {
  const trials = await db
    .select(trialColumns)
    .from(schoolTrialTable)
    .where(eq(schoolTrialTable.schoolId, schoolId))
    .orderBy(desc(schoolTrialTable.startsAt), desc(schoolTrialTable.id));
  return trials.map((trial) => schoolTrialDtoSchema.parse(trial));
}

/**
 * Starts a trial of `tier` for the school now, ending at `endsAt` (already
 * checked with {@link parseTrialEnd}). CONFLICT when the school already has
 * an active trial: an administrator changes or ends that one instead. The
 * caller holds the school row's lock.
 */
export async function startSchoolTrial(
  db: DatabaseExecutor,
  input: { schoolId: string; tier: SchoolTier; endsAt: Date; createdBy: string },
): Promise<SchoolTrialDto> {
  const [active] = await db
    .select({ id: schoolTrialTable.id })
    .from(schoolTrialTable)
    .where(and(eq(schoolTrialTable.schoolId, input.schoolId), activeSchoolTrialCondition()))
    .limit(1);
  if (active) throw rpcError.conflict('This school already has an active trial. Change or end it instead.');
  try {
    // `starts_at` is the database's now(), the clock every read of the trial compares with.
    const [created] = await db
      .insert(schoolTrialTable)
      .values({ schoolId: input.schoolId, tier: input.tier, endsAt: input.endsAt, createdBy: input.createdBy })
      .returning({ id: schoolTrialTable.id });
    const trial = created && (await readSchoolTrial(db, input.schoolId, created.id));
    if (!trial) throw rpcError.internal();
    return trial;
  } catch (error) {
    throw trialOverlapConflict(error) ?? error;
  }
}
