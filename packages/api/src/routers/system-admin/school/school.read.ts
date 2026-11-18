import type { DatabaseExecutor } from '@campuspilot/db';
import { activeBillingPeriodColumns, activeBillingPeriodOf, joinActiveBillingPeriod } from '@campuspilot/db/feature-flags/store';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolBillingPeriodTable } from '@campuspilot/db/schema/school-billing';
import { eq } from 'drizzle-orm';

import { toSchoolDto, type SchoolDto } from './school.dto';

/**
 * Schools with their active billing period, for the admin DTO. A school has
 * at most one active period (the table's EXCLUDE constraint), so the left
 * join adds no rows; filters may name `schoolBillingPeriodTable` columns
 * (null: no active period).
 */
export function selectSchoolsWithActivePeriod(db: DatabaseExecutor) {
  return db
    .select({ school: schoolTable, ...activeBillingPeriodColumns })
    .from(schoolTable)
    .leftJoin(schoolBillingPeriodTable, joinActiveBillingPeriod())
    .$dynamic();
}

/** One row of {@link selectSchoolsWithActivePeriod} as the admin DTO. */
export function schoolRowToDto(row: Awaited<ReturnType<typeof selectSchoolsWithActivePeriod>>[number]): SchoolDto {
  return toSchoolDto(row.school, activeBillingPeriodOf(row));
}

/** One school as the admin DTO, or null when it does not exist. */
export async function readSchoolDto(db: DatabaseExecutor, schoolId: string): Promise<SchoolDto | null> {
  const [row] = await selectSchoolsWithActivePeriod(db).where(eq(schoolTable.id, schoolId)).limit(1);
  return row ? schoolRowToDto(row) : null;
}
