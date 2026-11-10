import { randomUUID } from 'node:crypto';

import { schoolTable } from '@campuspilot/db/schema/school';

import { db } from '../db';

/**
 * A school row for a test. Assistant rows reference their school (they go
 * with it when it is deleted), so every test conversation needs a real one.
 */
export async function createTestSchool(): Promise<string> {
  const suffix = randomUUID();
  const [school] = await db
    .insert(schoolTable)
    .values({ slug: `assistant-test-${suffix}`, name: `Assistant Test School ${suffix.slice(0, 8)}`, location: 'Test City' })
    .returning({ id: schoolTable.id });
  return school!.id;
}
