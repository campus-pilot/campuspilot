import type { DatabaseExecutor } from '@campuspilot/db';
import { activeSchoolTrialColumns, activeSchoolTrialCondition, activeSchoolTrialOf } from '@campuspilot/db/feature-flags/store';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolTrialTable } from '@campuspilot/db/schema/school-trial';
import { and, eq } from 'drizzle-orm';

import { toSchoolDto, type SchoolDto } from './school.dto';

/**
 * Schools with their active trial, for the admin DTO. A school has at most
 * one active trial (the table's EXCLUDE constraint), so the left join adds
 * no rows; filters may name `schoolTrialTable` columns (null: no active
 * trial).
 */
export function selectSchoolsWithActiveTrial(db: DatabaseExecutor) {
  return db
    .select({ school: schoolTable, ...activeSchoolTrialColumns })
    .from(schoolTable)
    .leftJoin(schoolTrialTable, and(eq(schoolTrialTable.schoolId, schoolTable.id), activeSchoolTrialCondition()))
    .$dynamic();
}

/** One row of {@link selectSchoolsWithActiveTrial} as the admin DTO. */
export function schoolRowToDto(row: Awaited<ReturnType<typeof selectSchoolsWithActiveTrial>>[number]): SchoolDto {
  return toSchoolDto(row.school, activeSchoolTrialOf(row));
}

/** One school as the admin DTO, or null when it does not exist. */
export async function readSchoolDto(db: DatabaseExecutor, schoolId: string): Promise<SchoolDto | null> {
  const [row] = await selectSchoolsWithActiveTrial(db).where(eq(schoolTable.id, schoolId)).limit(1);
  return row ? schoolRowToDto(row) : null;
}
