import type { Database, DatabaseExecutor } from '@campuspilot/db';
import { classTable } from '@campuspilot/db/schema/class';
import { examTimetableTable } from '@campuspilot/db/schema/exam';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { sessionConfigSchema } from '@campuspilot/db/schema/jsonb/session-config';
import { studentTable } from '@campuspilot/db/schema/student';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { and, count, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';

import { rpcError } from '../../errors';
import { createNextPageCursor, createPaginatedResult, resolvePaginationInput } from '../../paginations';
import { buildDocumentContexts } from '../school/document/document.context';
import { combineDocuments, convertDocumentPdf, renderDocuments } from '../school/document/document.render';
import { getSelectedDocumentTemplate } from '../school/document/document.selected-template';
import { documentDownloadUrl } from '../school/document/document.storage';
import type { CadetScope } from './cadet-notices.service';

/**
 * Examination timetables in the Cadet Portal. A student sees a timetable only
 * when it is **published** (a draft never leaves the staff app) and the
 * student is enrolled in its session; the timetable is examination-wide, so
 * once visible it shows every class, not only the student's own. Visibility is
 * evaluated when the student asks: withdrawing a timetable hides it again at
 * once, while the notifications already sent keep their link and then answer
 * NOT_FOUND. Anything else is NOT_FOUND, like an unknown timetable.
 * `cadetProcedure` has already required the school's `cadet` feature.
 */
type TimetableKey = { sessionId: string; examSlug: string };

const publishedTo = (cadet: CadetScope) =>
  and(
    eq(examTimetableTable.schoolId, cadet.schoolId),
    isNotNull(examTimetableTable.publishedAt),
    sql`exists (
      select 1 from ${studentTable}
      where ${studentTable.schoolId} = ${examTimetableTable.schoolId}
        and ${studentTable.sessionId} = ${examTimetableTable.sessionId}
        and ${studentTable.admissionId} = ${cadet.admissionId}
    )`,
  )!;

/** A session's exam names by slug; a slug no longer configured keeps the slug as its name. */
const examNameOf = (config: unknown, examSlug: string) => {
  const exams = sessionConfigSchema.parse(config ?? {}).examConfig;
  return Object.hasOwn(exams, examSlug) ? exams[examSlug]!.name : examSlug;
};

/** One page of the published timetables the student can open, newest publication first. */
export async function listCadetTimetables(db: DatabaseExecutor, cadet: CadetScope, input: { cursor?: string; page?: number; limit: number }) {
  const { currentPage, pageSize, offset } = resolvePaginationInput(input);
  const where = publishedTo(cadet);
  const [rows, [total]] = await Promise.all([
    db
      .select({
        sessionId: examTimetableTable.sessionId,
        examSlug: examTimetableTable.examSlug,
        publishedAt: examTimetableTable.publishedAt,
        sessionConfig: schoolSessionTable.sessionConfig,
      })
      .from(examTimetableTable)
      .innerJoin(schoolSessionTable, eq(schoolSessionTable.id, examTimetableTable.sessionId))
      .where(where)
      .orderBy(desc(examTimetableTable.publishedAt), desc(examTimetableTable.id))
      .limit(pageSize)
      .offset(offset),
    db.select({ value: count() }).from(examTimetableTable).where(where),
  ]);
  const totalItems = total?.value ?? 0;
  const totalPages = Math.ceil(totalItems / pageSize);
  return createPaginatedResult({
    items: rows.flatMap((row) =>
      row.publishedAt
        ? [{ sessionId: row.sessionId, examSlug: row.examSlug, examName: examNameOf(row.sessionConfig, row.examSlug), publishedAt: row.publishedAt }]
        : [],
    ),
    nextCursor: createNextPageCursor(currentPage, totalPages),
    currentPage,
    totalPages,
    totalItems,
    pageSize,
  });
}

/** The published timetable the student may open, or NOT_FOUND. */
async function publishedTimetable(db: DatabaseExecutor, cadet: CadetScope, key: TimetableKey) {
  const [row] = await db
    .select({ timetable: examTimetableTable, sessionConfig: schoolSessionTable.sessionConfig })
    .from(examTimetableTable)
    .innerJoin(schoolSessionTable, eq(schoolSessionTable.id, examTimetableTable.sessionId))
    .where(and(eq(examTimetableTable.sessionId, key.sessionId), eq(examTimetableTable.examSlug, key.examSlug), publishedTo(cadet)))
    .limit(1);
  if (!row || !row.timetable.publishedAt) throw rpcError.notFound('Exam timetable');
  return { ...row.timetable, publishedAt: row.timetable.publishedAt, examName: examNameOf(row.sessionConfig, key.examSlug) };
}

/** One published timetable with every class's schedule, rows in date and time order. */
export async function getCadetTimetable(db: DatabaseExecutor, cadet: CadetScope, key: TimetableKey) {
  const timetable = await publishedTimetable(db, cadet, key);
  const { columns, rows } = timetable.config;
  const classes = columns.length
    ? await db
        .select()
        .from(classTable)
        .where(and(eq(classTable.schoolId, cadet.schoolId), inArray(classTable.id, columns)))
    : [];
  const classById = new Map(classes.map((entry) => [entry.id, entry]));
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id));
  return {
    sessionId: timetable.sessionId,
    examSlug: timetable.examSlug,
    examName: timetable.examName,
    publishedAt: timetable.publishedAt,
    columns: columns.flatMap((classId) => {
      const entry = classById.get(classId);
      return entry ? [{ classId, label: entry.label }] : [];
    }),
    rows: sorted.map((row) => ({
      id: row.id,
      date: row.date,
      startTime: row.startTime,
      endTime: row.endTime,
      entries: columns.flatMap((classId) => {
        const entry = classById.get(classId);
        if (!entry) return [];
        const cell = row.cells[classId];
        return [
          {
            classId,
            subjects: (cell ? (Array.isArray(cell) ? cell : [cell]) : []).map((paper) => {
              const subject = Object.hasOwn(entry.config.subjects, paper.subjectSlug) ? entry.config.subjects[paper.subjectSlug] : undefined;
              const mode = subject && Object.hasOwn(subject.examModes, paper.modeSlug) ? subject.examModes[paper.modeSlug] : undefined;
              return { subjectName: subject?.name ?? paper.subjectSlug, modeName: mode?.name ?? paper.modeSlug };
            }),
          },
        ];
      }),
    })),
  };
}

async function objectExists(key: string) {
  try {
    await getS3Client().send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    return true;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || (error as { name?: string }).name === 'NotFound') return false;
    throw error;
  }
}

/** Renders in progress in this process, so concurrent first requests convert once. */
const pdfInFlight = new Map<string, Promise<void>>();

/**
 * A five-minute download URL of the timetable's PDF, rendered with the
 * school's selected Timetable template exactly as staff generate it (all
 * classes) and cached under a key that names the timetable, its publication
 * number and the template revision. A published timetable is frozen, so that
 * key fully identifies the document; a re-publication or a template change
 * renders a new object. The letterhead (name, logo) is the school's as it was
 * when the PDF was first rendered. NOT_FOUND when no template is selected.
 */
export async function getCadetTimetableDownload(db: Database, cadet: CadetScope, key: TimetableKey) {
  const timetable = await publishedTimetable(db, cadet, key);
  const template = await getSelectedDocumentTemplate(db, { schoolId: cadet.schoolId, documentType: 'timetable' });
  const objectKey = `schools/${cadet.schoolId}/exam-timetables/${timetable.id}-${timetable.publicationCount}-${template.row.id}.pdf`;
  if (!(await objectExists(objectKey))) {
    let pending = pdfInFlight.get(objectKey);
    if (!pending) {
      pending = (async () => {
        const data = await db.transaction(
          (tx) => buildDocumentContexts(tx, cadet.schoolId, { documentType: 'timetable', sessionId: key.sessionId, examSlug: key.examSlug }),
          { isolationLevel: 'repeatable read', accessMode: 'read only' },
        );
        const html = combineDocuments(renderDocuments(template.content, data.contexts), 'timetable', template.row.pageSize);
        const bytes = await convertDocumentPdf(html, 'timetable');
        await getS3Client().send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: objectKey, Body: bytes, ContentType: 'application/pdf' }));
      })().finally(() => pdfInFlight.delete(objectKey));
      pdfInFlight.set(objectKey, pending);
    }
    await pending;
  }
  return { url: await documentDownloadUrl(objectKey, `${timetable.examName} timetable`), expiresIn: 300 };
}
