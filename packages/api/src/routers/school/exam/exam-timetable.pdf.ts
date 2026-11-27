import type { Database } from '@campuspilot/db';
import { examTimetableTable } from '@campuspilot/db/schema/exam';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { and, eq, isNotNull } from 'drizzle-orm';

import { rpcError } from '../../../errors';
import { buildDocumentContexts } from '../document/document.context';
import { combineDocuments, convertDocumentPdf, renderDocuments } from '../document/document.render';
import type { getSelectedDocumentTemplate } from '../document/document.selected-template';

/**
 * The PDF of one publication of an examination timetable, rendered once and
 * cached in S3. Shared by the Cadet Portal download
 * (`getCadetTimetableDownload`) and the WhatsApp attachment of
 * `exam.timetable_published` (`notifications/documents/timetable.ts`), so a
 * publication sent to every student and downloaded from the portal converts
 * one PDF.
 *
 * The PDF is rendered with the school's selected Timetable template exactly
 * as staff generate it (all classes) and cached under a key that names the
 * timetable, its publication number and the template revision
 * ({@link examTimetablePdfKey}). A published timetable is frozen, so that key
 * fully identifies the document; a re-publication or a template change
 * renders a new object. The letterhead (name, logo) is the school's as it
 * was when the PDF was first rendered.
 *
 * A render reads the timetable in the same repeatable-read snapshot in which
 * it checks that the publication is still the published one, so a
 * withdrawal or re-publication racing a first render can never store one
 * publication's schedule under another's key: it answers NOT_FOUND instead.
 * Within one process concurrent first requests share one render; two
 * processes may both render and store the same document under the same key,
 * which is harmless.
 */

/** One publication of a timetable. */
export type TimetablePublication = { id: string; schoolId: string; sessionId: string; examSlug: string; publicationCount: number };

type SelectedTimetableTemplate = Awaited<ReturnType<typeof getSelectedDocumentTemplate>>;

/** `schools/{schoolId}/exam-timetables/{timetableId}-{publicationCount}-{templateId}.pdf` */
export function examTimetablePdfKey(publication: TimetablePublication, templateRevisionId: string) {
  return `schools/${publication.schoolId}/exam-timetables/${publication.id}-${publication.publicationCount}-${templateRevisionId}.pdf`;
}

function isMissingObject(error: unknown) {
  const name = (error as { name?: string } | null)?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
  return name === 'NoSuchKey' || name === 'NotFound' || status === 404;
}

async function objectExists(key: string) {
  try {
    await getS3Client().send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    return true;
  } catch (error) {
    if (isMissingObject(error)) return false;
    throw error;
  }
}

async function readObject(key: string): Promise<Uint8Array | null> {
  try {
    const result = await getS3Client().send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    return result.Body ? await result.Body.transformToByteArray() : null;
  } catch (error) {
    if (isMissingObject(error)) return null;
    throw error;
  }
}

/** Renders in progress in this process, so concurrent first requests convert once. */
const pdfInFlight = new Map<string, Promise<Uint8Array>>();

/** Renders the publication's PDF and stores it under `key` (one render per process at a time). */
function renderAndStore(db: Database, publication: TimetablePublication, template: SelectedTimetableTemplate, key: string) {
  let pending = pdfInFlight.get(key);
  if (!pending) {
    pending = (async () => {
      const data = await db.transaction(
        async (tx) => {
          const [current] = await tx
            .select({ id: examTimetableTable.id })
            .from(examTimetableTable)
            .where(
              and(
                eq(examTimetableTable.id, publication.id),
                eq(examTimetableTable.schoolId, publication.schoolId),
                eq(examTimetableTable.sessionId, publication.sessionId),
                eq(examTimetableTable.examSlug, publication.examSlug),
                isNotNull(examTimetableTable.publishedAt),
                eq(examTimetableTable.publicationCount, publication.publicationCount),
              ),
            )
            .limit(1);
          if (!current) throw rpcError.notFound('Exam timetable');
          return buildDocumentContexts(tx, publication.schoolId, {
            documentType: 'timetable',
            sessionId: publication.sessionId,
            examSlug: publication.examSlug,
          });
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
      const html = combineDocuments(renderDocuments(template.content, data.contexts), 'timetable', template.row.pageSize);
      const bytes = new Uint8Array(await convertDocumentPdf(html, 'timetable'));
      await getS3Client().send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: bytes, ContentType: 'application/pdf' }));
      return bytes;
    })().finally(() => pdfInFlight.delete(key));
    pdfInFlight.set(key, pending);
  }
  return pending;
}

/** Makes sure the publication's PDF is cached and returns its key (the portal download presigns it). */
export async function ensureExamTimetablePdfStored(db: Database, publication: TimetablePublication, template: SelectedTimetableTemplate) {
  const key = examTimetablePdfKey(publication, template.row.id);
  if (!(await objectExists(key))) await renderAndStore(db, publication, template, key);
  return key;
}

/** The publication's PDF bytes and their cache key: read from the cache, or rendered once and stored. */
export async function readExamTimetablePdf(db: Database, publication: TimetablePublication, template: SelectedTimetableTemplate) {
  const key = examTimetablePdfKey(publication, template.row.id);
  const bytes = (await readObject(key)) ?? (await renderAndStore(db, publication, template, key));
  return { key, bytes };
}
