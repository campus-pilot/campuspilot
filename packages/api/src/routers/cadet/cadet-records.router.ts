import { admissionTable } from '@campuspilot/db/schema/admission';
import { eq } from 'drizzle-orm';

import { cadetProcedure } from '../../cadet/procedure';
import { rpcError, toRpcError } from '../../errors';
import { createNextPageCursor, createPaginatedResult, resolvePaginationInput } from '../../paginations';
import {
  cadetBillSchema,
  cadetExamListItemSchema,
  cadetExamResultSchema,
  cadetFeeSummarySchema,
  cadetGrowthSchema,
  cadetProfileSchema,
  getCadetBillInputSchema,
  getCadetExamResultInputSchema,
  getCadetGrowthInputSchema,
  listCadetExamsInputSchema,
  listCadetExamsOutputSchema,
  listCadetFeeLedgerInputSchema,
  listCadetFeeLedgerOutputSchema,
  listCadetRemarksInputSchema,
  listCadetRemarksOutputSchema,
} from './cadet.dto';
import {
  type CadetExam,
  findRecord,
  loadCadetAcademics,
  loadCadetSchool,
  loadRemarks,
  parseExamId,
  releasedExamExtras,
  scoreReleasedExams,
  classAverages,
  holdsResults,
  type ClassAverages,
} from './cadet-academics.service';
import { cadetBill, cadetFeeLedger, cadetFeeSummary } from './cadet-fees.service';

const route = (summary: string, description: string) => ({ summary, description, tags: ['Cadet'] });
const readMeta = (module: 'account' | 'billing' | 'exams') =>
  ({ mcp: { exposure: 'core', access: 'read', destructive: false, module } }) as const;

/** The list/summary shape of one exam; scores only for a released exam the student has marks in. */
function toExamListItem(exam: CadetExam, overall: { percentage: number; grade: string | null } | null) {
  return {
    examId: exam.examId,
    recordId: exam.record.recordId,
    examSlug: exam.examSlug,
    name: exam.name,
    order: exam.order,
    state: exam.state,
    releasedAt: exam.releasedAt,
    percentage: overall?.percentage ?? null,
    grade: overall?.grade ?? null,
  };
}

const toRecord = (map: Map<string, number> | null) => (map ? Object.fromEntries(map) : null);

/** Slices an in-memory list with the shared pagination contract. */
function paginate<T>(items: T[], input: { cursor?: string; page?: number; limit: number }) {
  const { currentPage, pageSize, offset } = resolvePaginationInput(input);
  const totalPages = Math.ceil(items.length / pageSize);
  return createPaginatedResult({
    items: items.slice(offset, offset + pageSize),
    nextCursor: createNextPageCursor(currentPage, totalPages),
    currentPage,
    totalPages,
    totalItems: items.length,
    pageSize,
  });
}

/**
 * The signed-in student's own records. Every procedure takes the school and
 * admission from the cadet context (the login), never from input; ids in the
 * input (bill, class record, exam) are looked up within that admission, so
 * another student's id is indistinguishable from an unknown one (NOT_FOUND).
 */
export const cadetRecordsRouter = {
  getProfile: cadetProcedure
    .route(route('Get my profile', "The signed-in student's name, admission number, school, current class and enrollments (session, class, section, roll number), newest session first."))
    .meta(readMeta('account'))
    .output(cadetProfileSchema)
    .handler(async ({ context }) => {
      try {
        const [admission] = await context.db
          .select({ name: admissionTable.name, admissionNo: admissionTable.admissionNo })
          .from(admissionTable)
          .where(eq(admissionTable.id, context.cadet.admissionId))
          .limit(1);
        if (!admission) throw rpcError.notFound('Admission');
        const [school, academics] = await Promise.all([
          loadCadetSchool(context.db, context.cadet),
          loadCadetAcademics(context.db, context.cadet),
        ]);
        const { enrollments, currentRecord } = academics;
        const currentEnrollment = enrollments.find((row) => row.studentId === currentRecord?.studentId);
        return {
          ...admission,
          schoolName: school.name,
          current: currentRecord
            ? {
                recordId: currentRecord.recordId,
                classLabel: currentRecord.classLabel,
                sectionLabel: currentRecord.sectionLabel,
                sessionLabel: currentRecord.sessionLabel,
                // A roll number belongs to the placement, so only when still placed in this class.
                rollNo: currentEnrollment?.classId === currentRecord.classId ? currentEnrollment.rollNo : null,
              }
            : null,
          enrollments: enrollments.map((row) => ({
            studentId: row.studentId,
            sessionId: row.sessionId,
            sessionLabel: row.sessionLabel,
            sessionIsActive: row.sessionIsActive,
            classLabel: row.classLabel,
            sectionLabel: row.sectionLabel,
            rollNo: row.rollNo,
          })),
        };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getFeeSummary: cadetProcedure
    .route(route('Get my fee summary', "The student's account totals per currency: balance owed or in credit, billed, paid, concessions and refunds over the whole admission."))
    .meta(readMeta('billing'))
    .output(cadetFeeSummarySchema)
    .handler(async ({ context }) => {
      try {
        return await cadetFeeSummary(context.db, context.cadet);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  listFeeLedger: cadetProcedure
    .route(route('List my fee ledger', "The student's account ledger, newest first: bills, payments, concessions, refunds and reversals, each with the running balance after it."))
    .meta(readMeta('billing'))
    .input(listCadetFeeLedgerInputSchema)
    .output(listCadetFeeLedgerOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        return await cadetFeeLedger(context.db, context.cadet, input);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getBill: cadetProcedure
    .route(route('Get one of my bills', 'One bill of the student with its fee lines and the concessions applied to it. Payments are credited to the account, not to a bill.'))
    .meta(readMeta('billing'))
    .input(getCadetBillInputSchema)
    .output(cadetBillSchema)
    .handler(async ({ context, input }) => {
      try {
        return await cadetBill(context.db, context.cadet, input.billId);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  listExams: cadetProcedure
    .route(route('List my examinations', "Examinations of one of the student's classes (the current class by default) with their state. Scores appear only for examinations the school released to the Cadet Portal; a completed but unreleased examination is awaiting release."))
    .meta(readMeta('exams'))
    .input(listCadetExamsInputSchema)
    .output(listCadetExamsOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const academics = await loadCadetAcademics(context.db, context.cadet);
        const record = findRecord(academics, input.filters?.recordId);
        if (!record) return { ...paginate([], input), record: null };
        const exams = academics.examsOf(record.recordId);
        const scores = new Map(scoreReleasedExams(academics, exams).map((score) => [score.exam.examId, score]));
        const items = exams.map((exam) => toExamListItem(exam, scores.get(exam.examId)?.overall ?? null));
        return {
          ...paginate(items, input),
          record: {
            recordId: record.recordId,
            classLabel: record.classLabel,
            sectionLabel: record.sectionLabel,
            sessionLabel: record.sessionLabel,
          },
        };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getExam: cadetProcedure
    .route(route('Get one of my examinations', "One examination of one of the student's classes with its state (upcoming, in progress, awaiting release or released) and, once released, the overall score. Use getExamResult for the marks of a released exam."))
    .meta(readMeta('exams'))
    .input(getCadetExamResultInputSchema)
    .output(cadetExamListItemSchema)
    .handler(async ({ context, input }) => {
      try {
        const parsed = parseExamId(input.examId);
        if (!parsed) throw rpcError.notFound('Examination');
        const academics = await loadCadetAcademics(context.db, context.cadet);
        const exam = academics.examsOf(parsed.recordId).find((item) => item.examSlug === parsed.examSlug);
        if (!exam) throw rpcError.notFound('Examination');
        const [score] = scoreReleasedExams(academics, [exam]);
        return toExamListItem(exam, score?.overall ?? null);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getExamResult: cadetProcedure
    .route(route('Get my examination result', "The student's marks per subject, overall percentage and grade, change since the previous released exam of the same class, attendance, co-scholastic grades and the teacher's remark. Only for examinations the school released to the Cadet Portal."))
    .meta(readMeta('exams'))
    .input(getCadetExamResultInputSchema)
    .output(cadetExamResultSchema)
    .handler(async ({ context, input }) => {
      try {
        const parsed = parseExamId(input.examId);
        if (!parsed) throw rpcError.notFound('Examination result');
        const academics = await loadCadetAcademics(context.db, context.cadet);
        const record = academics.records.find((item) => item.recordId === parsed.recordId);
        const exams = record ? academics.examsOf(record.recordId) : [];
        const exam = exams.find((item) => item.examSlug === parsed.examSlug);
        // Unreleased results are refused exactly like missing ones.
        if (!record || !exam || exam.state !== 'released') throw rpcError.notFound('Examination result');
        const school = await loadCadetSchool(context.db, context.cadet);
        const scores = scoreReleasedExams(academics, exams);
        const score = scores.find((item) => item.exam.examId === exam.examId)!;
        // Averages only for the requested exam, and only on the class record
        // holding the student's results (a class they moved into shows none).
        const averages =
          school.showClassAverages && holdsResults(academics, exam)
            ? (await classAverages(context.db, [exam])).get(exam.examId)
            : undefined;
        const previous = scores
          .filter((item) => item.exam.order < exam.order && item.overall !== null)
          .at(-1);
        const previousBySubject = new Map(previous?.subjects.map((subject) => [subject.subjectId, subject.percentage]));
        const extras = await releasedExamExtras(context.db, context.cadet, academics, exam);
        return {
          examId: exam.examId,
          recordId: record.recordId,
          name: exam.name,
          sessionLabel: record.sessionLabel,
          classLabel: record.classLabel,
          sectionLabel: record.sectionLabel,
          releasedAt: exam.releasedAt!,
          overall: score.overall,
          previousExam: previous ? { examId: previous.exam.examId, name: previous.exam.name, percentage: previous.overall!.percentage } : null,
          classAveragePercentage: averages?.overall ?? null,
          attendance: extras.attendance,
          subjects: score.subjects.map((subject) => ({
            subjectId: subject.subjectId,
            name: subject.name,
            obtained: subject.obtained,
            max: subject.max,
            percentage: subject.percentage,
            grade: subject.grade,
            modes: subject.modes,
            previousPercentage: previousBySubject.get(subject.subjectId) ?? null,
            classAveragePercentage: averages?.subjects?.get(subject.subjectId) ?? null,
          })),
          coScholastics: extras.coScholastics,
          remark: extras.remark,
        };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getGrowth: cadetProcedure
    .route(route('Get my growth', "Every class the student was in, each with its latest released overall percentage, and for one class (the current one by default) its subjects and released exams. Subjects belong to their class and are never compared across classes; class averages appear only when the school shares them."))
    .meta(readMeta('exams'))
    .input(getCadetGrowthInputSchema)
    .output(cadetGrowthSchema)
    .handler(async ({ context, input }) => {
      try {
        const academics = await loadCadetAcademics(context.db, context.cadet);
        const selectedRecord = findRecord(academics, input.recordId);
        const school = await loadCadetSchool(context.db, context.cadet);
        const scored = new Map(
          academics.records.map((record) => [
            record.recordId,
            scoreReleasedExams(academics, academics.examsOf(record.recordId)).filter((score) => score.overall !== null),
          ]),
        );
        // One averages pass, only where averages are shown: every exam of the
        // selected class and the latest exam of each other class.
        const averaged = school.showClassAverages
          ? await classAverages(
              context.db,
              academics.records.flatMap((record) => {
                const scores = scored.get(record.recordId)!;
                return (record.recordId === selectedRecord?.recordId ? scores : scores.slice(-1)).map((score) => score.exam);
              }),
            )
          : new Map<string, ClassAverages>();
        const classes = academics.records.map((record) => {
          const latest = scored.get(record.recordId)!.at(-1);
          return {
            recordId: record.recordId,
            classLabel: record.classLabel,
            sectionLabel: record.sectionLabel,
            sessionLabel: record.sessionLabel,
            sessionIsActive: record.sessionIsActive,
            latest: latest
              ? { examName: latest.exam.name, percentage: latest.overall!.percentage, classAveragePercentage: averaged.get(latest.exam.examId)?.overall ?? null }
              : null,
          };
        });
        let selected = null;
        if (selectedRecord) {
          const scores = scored.get(selectedRecord.recordId)!;
          const subjects = new Map<string, string>();
          for (const score of scores) for (const subject of score.subjects) subjects.set(subject.subjectId, subject.name);
          selected = {
            recordId: selectedRecord.recordId,
            subjects: [...subjects].map(([subjectId, name]) => ({ subjectId, name })),
            exams: scores.map((score) => ({
              examId: score.exam.examId,
              name: score.exam.name,
              percentage: score.overall!.percentage,
              classAveragePercentage: averaged.get(score.exam.examId)?.overall ?? null,
              subjects: Object.fromEntries(score.subjects.map((subject) => [subject.subjectId, subject.percentage])),
              subjectAverages: toRecord(averaged.get(score.exam.examId)?.subjects ?? null),
            })),
          };
        }
        return { classes, selected, classAveragesShared: school.showClassAverages };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  listRemarks: cadetProcedure
    .route(route('List my teacher remarks', "Teachers' remarks on the student's released examinations, newest exam first, optionally for one class."))
    .meta(readMeta('exams'))
    .input(listCadetRemarksInputSchema)
    .output(listCadetRemarksOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const academics = await loadCadetAcademics(context.db, context.cadet);
        const records = input.filters?.recordId ? [findRecord(academics, input.filters.recordId)!] : academics.records;
        // Records are newest session first; exams within a record oldest first.
        const exams = records.flatMap((record) => [...academics.examsOf(record.recordId)].reverse());
        const remarks = await loadRemarks(context.db, context.cadet, academics, exams);
        return paginate(
          remarks.map(({ exam, remark }) => ({ ...remark, examId: exam.examId, examName: exam.name, recordId: exam.record.recordId, releasedAt: exam.releasedAt! })),
          input,
        );
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
