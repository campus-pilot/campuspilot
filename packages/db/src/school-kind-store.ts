import { eq } from 'drizzle-orm';

import type { DatabaseExecutor } from './index';
import type { SchoolKind } from './school-kind';
import { schoolTable } from './schema/school';

/**
 * The school's kind (`school.kind`, docs/personal-space.md), or null when the
 * school does not exist. One query, shared by the API's kind gate (which
 * caches it) and the assistant's turn loop, which may not import school
 * tables itself (`runtime/boundary.test.ts`).
 */
export async function getSchoolKind(db: DatabaseExecutor, schoolId: string): Promise<SchoolKind | null> {
  const [row] = await db.select({ kind: schoolTable.kind }).from(schoolTable).where(eq(schoolTable.id, schoolId)).limit(1);
  return row?.kind ?? null;
}
