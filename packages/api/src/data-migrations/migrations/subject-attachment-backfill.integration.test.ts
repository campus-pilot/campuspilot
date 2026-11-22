import { db } from '@campuspilot/db';
import { classTable } from '@campuspilot/db/schema/class';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { createResultsSchool } from '../../../test/exam-results';
import { createTestClass, createTestUser, type TestClient } from '../../../test/fixtures';
import { runDataMigrationBatches } from '../../workflows/data-migration/workflow';
import { loadDataMigrationRun, requestDataMigrationRun, startDataMigrationRun } from '../run-store';
import { subjectAttachmentBackfillMigration } from './subject-attachment-backfill';

/**
 * Runs the real backfill over the whole test database, so this file is in
 * the platform-wide group that runs after every other file (vitest.config.ts).
 */
const directStep = <T,>(_name: string, action: () => Promise<T>) => action();

async function runMigration(dryRun: boolean) {
  const user = await createTestUser();
  const run = await requestDataMigrationRun(db, { migrationId: subjectAttachmentBackfillMigration.id, dryRun, requestedBy: user.id });
  await startDataMigrationRun(run!.id);
  await runDataMigrationBatches({ runId: run!.id, migration: { ...subjectAttachmentBackfillMigration, batchSize: 2 }, step: directStep });
  return (await loadDataMigrationRun(run!.id))!;
}

/** The stored JSON, read past the column's normalising reader. */
async function rawSubjects(classId: string) {
  const [row] = await db.select({ raw: sql<string>`${classTable.config}::text` }).from(classTable).where(eq(classTable.id, classId));
  return (JSON.parse(row!.raw) as { subjects: Record<string, Record<string, unknown>> }).subjects;
}

describe('subject attachment backfill (data migration) and reads of subjects without attachment', () => {
  let principal: TestClient;
  let schoolId: string;
  let legacyId: string;
  let examOnlyId: string;
  const modes = { written: { name: 'Written', percentage: 100 } };

  beforeAll(async () => {
    const school = await createResultsSchool();
    principal = school.principal;
    schoolId = school.school.id;
    legacyId = (await createTestClass({ schoolId, label: 'Legacy' })).schoolClass.id;
    examOnlyId = (await createTestClass({ schoolId, label: 'Exam only' })).schoolClass.id;
    // As the previous release (or the state before migration 0082) stored it.
    await db.execute(
      sql`update "class" set "config" = ${JSON.stringify({ subjects: { maths: { name: 'Maths', books: [], examModes: modes } } })}::jsonb where "id" = ${legacyId}`,
    );
    await db.execute(
      sql`update "class" set "config" = ${JSON.stringify({
        subjects: {
          gk: { name: 'GK', books: [], examModes: modes, attachment: { kind: 'exam', exams: [{ sessionId: 's', examSlug: 'term' }] } },
          art: { name: 'Art', books: [], examModes: modes },
        },
      })}::jsonb where "id" = ${examOnlyId}`,
    );
  });

  it('reads a stored subject without attachment as a classroom subject', async () => {
    expect((await rawSubjects(legacyId)).maths).not.toHaveProperty('attachment');
    const read = await principal.school.getClass({ schoolId, classId: legacyId });
    expect(read.config.subjects.maths?.attachment).toEqual({ kind: 'school' });
    const listed = await principal.school.listClasses({ schoolId });
    expect(listed.find((entry) => entry.id === legacyId)!.subjectCount).toBe(1);
  });

  it('dry run changes nothing', async () => {
    const run = await runMigration(true);
    expect(run).toMatchObject({ status: 'completed', dryRun: true });
    expect(run.changedCount).toBeGreaterThanOrEqual(2);
    expect((await rawSubjects(legacyId)).maths).not.toHaveProperty('attachment');
  });

  it('stores the attachment, keeps existing ones, and is idempotent', async () => {
    const run = await runMigration(false);
    expect(run.status).toBe('completed');
    expect((await rawSubjects(legacyId)).maths!.attachment).toEqual({ kind: 'school' });
    const mixed = await rawSubjects(examOnlyId);
    expect(mixed.art!.attachment).toEqual({ kind: 'school' });
    expect(mixed.gk!.attachment).toEqual({ kind: 'exam', exams: [{ sessionId: 's', examSlug: 'term' }] });
    const again = await runMigration(false);
    expect(again).toMatchObject({ status: 'completed', changedCount: 0 });
  });
});
