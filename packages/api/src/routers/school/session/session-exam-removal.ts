import type { DatabaseTransaction } from '@campuspilot/db';
import { examKeyPart } from '../question-paper/question-paper.records';
import {
  examAssessmentSettingsTable,
  examLifecycleTable,
  examPlanTable,
  examStudentAssessmentTable,
  examStudentRemarkTable,
  examTimetableTable,
} from '@campuspilot/db/schema/exam';
import { examQuestionPaperTable } from '@campuspilot/db/schema/exam-question-paper';
import { examResultPublicationTable } from '@campuspilot/db/schema/exam-result-publication';
import { and, eq, inArray, isNotNull, ne, or, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

import { rpcError } from '../../../errors';

/**
 * One exam-keyed table whose rows are recorded data of an exam: `examSlug`
 * and `sessionId` are its key columns, and `hasData` (when set) narrows the
 * rows that count.
 */
type ExamDataSource = {
  examSlug: PgColumn;
  sessionId: PgColumn;
  query: (
    tx: DatabaseTransaction,
    where: SQL | undefined,
  ) => Promise<Array<{ examSlug: string }>>;
  hasData?: SQL;
};

/**
 * The exam-keyed tables whose rows keep an exam slug from being removed from
 * a session's `examConfig`, decided table by table:
 *
 * - `exam_plan`: the exam's plans (and through them `exam_result`, which is
 *   keyed by plan and cascades with it). Any row.
 * - `exam_timetable`: the exam's timetable, draft or published. Any row.
 * - `exam_assessment_settings`: the exam's working-day limit. Only a row with
 *   `total_working_days` set; clearing the limit leaves a row with null, which
 *   records nothing.
 * - `exam_student_assessment`: a student's attendance, activities and their
 *   review. Any row.
 * - `exam_student_remark`: a teacher's remark on a student. Any row.
 * - `exam_lifecycle`: the explicit lifecycle. Only a row that records
 *   something: a status other than `ready`, or a start, completion or Cadet
 *   Portal release time. Plan generation writes a bare `ready` row, and
 *   deleting every plan (`deleteExamPlan`) leaves it behind; that placeholder
 *   is not data, so it does not keep an exam whose plans were deleted.
 * - `exam_result_publication`: the record that students were notified of
 *   the results. Any row.
 * - `exam_question_paper`: an uploaded or written question paper. Any row.
 *
 * Deliberately not here: `artifact.exam_slug` (generated documents are
 * immutable provenance meant to outlive the records they were made from) and
 * `assistant_conversation.paper_exam_slug` (a user's chat history, which only
 * names a paper's key and may exist without any paper).
 */
const EXAM_DATA_SOURCES: ExamDataSource[] = [
  {
    examSlug: examPlanTable.examSlug,
    sessionId: examPlanTable.sessionId,
    query: (tx, where) =>
      tx.selectDistinct({ examSlug: examPlanTable.examSlug }).from(examPlanTable).where(where),
  },
  {
    examSlug: examTimetableTable.examSlug,
    sessionId: examTimetableTable.sessionId,
    query: (tx, where) =>
      tx
        .selectDistinct({ examSlug: examTimetableTable.examSlug })
        .from(examTimetableTable)
        .where(where),
  },
  {
    examSlug: examAssessmentSettingsTable.examSlug,
    sessionId: examAssessmentSettingsTable.sessionId,
    hasData: isNotNull(examAssessmentSettingsTable.totalWorkingDays),
    query: (tx, where) =>
      tx
        .selectDistinct({ examSlug: examAssessmentSettingsTable.examSlug })
        .from(examAssessmentSettingsTable)
        .where(where),
  },
  {
    examSlug: examStudentAssessmentTable.examSlug,
    sessionId: examStudentAssessmentTable.sessionId,
    query: (tx, where) =>
      tx
        .selectDistinct({ examSlug: examStudentAssessmentTable.examSlug })
        .from(examStudentAssessmentTable)
        .where(where),
  },
  {
    examSlug: examStudentRemarkTable.examSlug,
    sessionId: examStudentRemarkTable.sessionId,
    query: (tx, where) =>
      tx
        .selectDistinct({ examSlug: examStudentRemarkTable.examSlug })
        .from(examStudentRemarkTable)
        .where(where),
  },
  {
    examSlug: examLifecycleTable.examSlug,
    sessionId: examLifecycleTable.sessionId,
    hasData: or(
      ne(examLifecycleTable.status, 'ready'),
      isNotNull(examLifecycleTable.startedAt),
      isNotNull(examLifecycleTable.completedAt),
      isNotNull(examLifecycleTable.cadetReleasedAt),
    ),
    query: (tx, where) =>
      tx
        .selectDistinct({ examSlug: examLifecycleTable.examSlug })
        .from(examLifecycleTable)
        .where(where),
  },
  {
    examSlug: examResultPublicationTable.examSlug,
    sessionId: examResultPublicationTable.sessionId,
    query: (tx, where) =>
      tx
        .selectDistinct({ examSlug: examResultPublicationTable.examSlug })
        .from(examResultPublicationTable)
        .where(where),
  },
  {
    examSlug: examQuestionPaperTable.examSlug,
    sessionId: examQuestionPaperTable.sessionId,
    // The where clause names a session and slugs, so only exam papers match (a standalone paper has neither).
    query: (tx, where) =>
      tx
        .selectDistinct({ examSlug: examQuestionPaperTable.examSlug })
        .from(examQuestionPaperTable)
        .where(where)
        .then((rows) => rows.map((row) => ({ examSlug: examKeyPart(row.examSlug) }))),
  },
];

/**
 * Which of `slugs` have recorded data in the session (`EXAM_DATA_SOURCES`),
 * sorted. Callers hold the session row lock (FOR UPDATE). Exam writers that
 * check the exam under a session lock (`getExamSession` with `share` or
 * `update`, as plan generation, timetables, results and question papers do)
 * wait for it and then find the exam removed, so they cannot add data to a
 * slug between this check and the commit.
 */
export async function findExamSlugsWithData(
  tx: DatabaseTransaction,
  sessionId: string,
  slugs: readonly string[],
): Promise<string[]> {
  if (!slugs.length) return [];
  const found = new Set<string>();
  for (const source of EXAM_DATA_SOURCES) {
    const rows = await source.query(
      tx,
      and(
        eq(source.sessionId, sessionId),
        inArray(source.examSlug, [...slugs]),
        source.hasData,
      ),
    );
    for (const row of rows) found.add(row.examSlug);
  }
  return [...found].sort();
}

/**
 * Refuses removing exams of a session that have recorded data
 * (`findExamSlugsWithData`), with CONFLICT naming those exams by their stored
 * name and slug. `slugs` are the exams being removed and `storedExams` the
 * configuration read under the session lock. The one guard behind every way
 * an exam definition is removed: `deleteExam` (`refusal: 'delete'`) and a
 * full replacement through `updateSession` (`refusal: 'replace'`,
 * `assertNoExamWithDataRemoved`), so neither leaves results notifications,
 * assessments, remarks, question papers, lifecycle facts or a working-day
 * limit behind under a slug the session no longer defines. The exam's class
 * selection (`exam_class`) is not data here; callers delete it once this
 * passes.
 */
export async function assertExamsHaveNoData(
  tx: DatabaseTransaction,
  sessionId: string,
  storedExams: Readonly<Record<string, { name: string }>>,
  slugs: readonly string[],
  refusal: 'delete' | 'replace',
): Promise<void> {
  const withData = await findExamSlugsWithData(tx, sessionId, slugs);
  if (!withData.length) return;
  const labels = withData.map((slug) =>
    Object.hasOwn(storedExams, slug)
      ? `“${storedExams[slug]!.name}” (${slug})`
      : slug,
  );
  const one = withData.length === 1;
  const subject = one
    ? `The examination ${labels[0]} has plans, a timetable, results, question papers or other recorded data`
    : `The examinations ${labels.join(', ')} have plans, timetables, results, question papers or other recorded data`;
  throw rpcError.conflict(
    refusal === 'delete'
      ? `${subject}, so ${one ? 'it' : 'they'} cannot be deleted.`
      : `${subject}, so ${one ? 'it cannot be removed and its slug cannot be changed' : 'they cannot be removed and their slugs cannot be changed'}.`,
  );
}

/**
 * Refuses a full replacement of a session's exams (`updateSession`) that
 * removes an exam with recorded data (`assertExamsHaveNoData`). An exam is
 * removed when its slug is in `storedExams` (the configuration read under the
 * session lock) and not in `submittedExams`. That includes changing an exam's
 * slug in session settings: the edited exam is saved as a new exam under the
 * new slug and the old slug is removed, so it is refused too while the old
 * slug has data.
 *
 * Only removed slugs are checked. Data under a slug the stored configuration
 * no longer defines (left by an exam deleted before `deleteExam` used this
 * guard) is not removed by the save, so it never blocks saving unrelated
 * settings. Returns the removed slugs, whose class selection the caller then
 * deletes.
 */
export async function assertNoExamWithDataRemoved(
  tx: DatabaseTransaction,
  sessionId: string,
  storedExams: Readonly<Record<string, { name: string }>>,
  submittedExams: Readonly<Record<string, unknown>>,
): Promise<string[]> {
  const removed = Object.keys(storedExams).filter(
    (slug) => !Object.hasOwn(submittedExams, slug),
  );
  await assertExamsHaveNoData(tx, sessionId, storedExams, removed, 'replace');
  return removed;
}
