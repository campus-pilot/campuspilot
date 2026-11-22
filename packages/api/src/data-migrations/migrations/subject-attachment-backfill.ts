import type { DatabaseExecutor } from '@campuspilot/db';
import { classTable } from '@campuspilot/db/schema/class';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';

import type { DataMigration, DataMigrationSkippedItem } from '../types';

/** The class's stored subjects, or an empty object when the key is missing or not an object. */
const storedSubjects = sql`case when jsonb_typeof(${classTable.config} -> 'subjects') = 'object' then ${classTable.config} -> 'subjects' else '{}'::jsonb end`;

/** True when a stored subject of the class has no `attachment` key. Read from the raw column, never through the normalising reader. */
const hasSubjectWithoutAttachment = sql<boolean>`exists (select 1 from jsonb_each(${storedSubjects}) as s where jsonb_typeof(s.value) = 'object' and not (s.value ? 'attachment'))`;

/**
 * Follow-up of migration 0081 after the rolling deploy (exam README,
 * "Subjects offered in an exam"). 0081 ran before the new release
 * served traffic, but API servers of the previous release kept running until
 * the rollout finished, and their class configuration schema strips unknown
 * keys, so a subject they saved has no `attachment`. Reads already treat
 * such a subject as a classroom subject (`readStoredClassConfig`); this
 * stores the fact explicitly, exactly as 0081 did.
 *
 * Reads, in ID order and without a lock, the classes that still have a
 * subject without `attachment`, then locks those FOR UPDATE SKIP LOCKED: a
 * class another transaction holds (plan generation locks the school's
 * classes FOR SHARE in display order) is not waited for, so the batch never
 * waits on a row lock and cannot deadlock. Such a class is reported as a
 * skipped item (`class_locked`) rather than silently passed by the cursor:
 * the run completes with a skipped count, and a platform admin requests
 * another run, which picks it up (and reports it again only if it is still
 * locked then). Every write is fenced on the subject still lacking it, so
 * the migration is idempotent and a concurrent edit through the API, which
 * always stores attachments, wins.
 *
 * It deliberately runs for suspended schools and schools without a plan:
 * it normalises the storage format of a fact they already have (every such
 * subject is a classroom subject) and changes no school data, so the
 * read-only rule of docs/school-suspension.md does not apply. `updated_at` is not touched: this is not an edit by a
 * person. It is registered on boot like every data migration; because it may
 * finish while old servers are still draining, a platform admin can request
 * another run after the rollout (it then changes only what they wrote).
 */
export const subjectAttachmentBackfillMigration: DataMigration = {
  id: 'subject-attachment-backfill',
  description: 'Stores where each class subject is offered ({ kind: "school" }) for subjects saved without it during the rollout of exam-only subjects.',
  batchSize: 500,
  runBatch: async (db: DatabaseExecutor, { cursor, limit }) => {
    const candidates = await db
      .select({ id: classTable.id, schoolId: classTable.schoolId })
      .from(classTable)
      .where(and(cursor === null ? undefined : gt(classTable.id, cursor), hasSubjectWithoutAttachment))
      .orderBy(asc(classTable.id))
      .limit(limit);
    // Only rows nobody else holds; the rest are reported below.
    const rows = candidates.length
      ? await db
          .select({ id: classTable.id })
          .from(classTable)
          .where(inArray(classTable.id, candidates.map((row) => row.id)))
          .orderBy(asc(classTable.id))
          .for('update', { skipLocked: true })
      : [];
    const locked = new Set(rows.map((row) => row.id));
    const skipped: DataMigrationSkippedItem[] = candidates
      .filter((row) => !locked.has(row.id))
      .map((row) => ({ itemKey: row.id, reason: 'class_locked', detail: { schoolId: row.schoolId, classId: row.id } }));
    let changed = 0;
    for (const row of rows) {
      const written = await db
        .update(classTable)
        .set({
          config: sql`jsonb_set(${classTable.config}, '{subjects}', (
            select jsonb_object_agg(
              s.key,
              case
                when jsonb_typeof(s.value) <> 'object' or s.value ? 'attachment' then s.value
                else s.value || '{"attachment":{"kind":"school"}}'::jsonb
              end
            )
            from jsonb_each(${storedSubjects}) as s
          ))`,
        })
        .where(and(eq(classTable.id, row.id), hasSubjectWithoutAttachment))
        .returning({ id: classTable.id });
      if (written.length) changed += 1;
    }
    return {
      processed: candidates.length,
      changed,
      skipped,
      // The cursor follows what was read, never what was locked or written.
      nextCursor: candidates.length < limit ? null : candidates.at(-1)!.id,
    };
  },
};
