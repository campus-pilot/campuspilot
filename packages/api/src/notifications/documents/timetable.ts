import { db as defaultDb, type Database } from '@campuspilot/db';
import { examTimetableTable } from '@campuspilot/db/schema/exam';
import { ORPCError } from '@orpc/server';
import { and, eq, isNotNull } from 'drizzle-orm';

import { getSelectedDocumentTemplate, selectedDocumentTemplateTypes } from '../../routers/school/document/document.selected-template';
import { readExamTimetablePdf } from '../../routers/school/exam/exam-timetable.pdf';
import { DOCUMENT_TEMPLATE_UNAVAILABLE, type WhatsAppDocumentSource } from '../channels/whatsapp/documents';
import { disabledFeatureOf } from '../features';

/**
 * The timetable PDF attached to an `exam.timetable_published` WhatsApp
 * message.
 *
 * The PDF is the same for every student, so it is the publication's cached
 * PDF (`readExamTimetablePdf`), which also backs the Cadet Portal download:
 * a publication to thousands of students converts one PDF, and its object
 * key is the document's `shareKey`, so it is uploaded to WhatsApp once too.
 *
 * `available` is whether the school has selected a Timetable template;
 * without one the message is the `timetable_published` text.
 *
 * The PDF is of the publication the message is about (the event's
 * `timetableId` and `publicationNumber`): while the timetable is withdrawn,
 * or once it has been published again, that publication is no longer the
 * published one and nothing is produced (`null`, the delivery fails
 * visibly) rather than a PDF of a draft or of a later publication. A
 * template that no longer renders (a 4xx from the renderer) and a school
 * that no longer has a feature the notification needs give `null` too. A
 * template deselected since `available` gives
 * {@link DOCUMENT_TEMPLATE_UNAVAILABLE} (the text goes out). Anything else
 * (database, S3 or Gotenberg unavailable) is thrown and retried.
 */
export function createTimetableDocumentSource(db: Database = defaultDb): WhatsAppDocumentSource<'timetable'> {
  return {
    available: async ({ schoolId }) => (await selectedDocumentTemplateTypes(db, schoolId, ['timetable'])).has('timetable'),
    produce: async (request, { schoolId }) => {
      // The sender already skips a copy whose type's feature is off; this is
      // the same rule at the document itself, as for notices.
      if (await disabledFeatureOf(db, schoolId, 'exam.timetable_published')) return null;
      // Checked before the cache is read: a cached PDF of a publication that
      // was withdrawn since is never sent. (A first render checks again in
      // its own snapshot.)
      const [current] = await db
        .select({ id: examTimetableTable.id })
        .from(examTimetableTable)
        .where(
          and(
            eq(examTimetableTable.id, request.timetableId),
            eq(examTimetableTable.schoolId, schoolId),
            eq(examTimetableTable.sessionId, request.sessionId),
            eq(examTimetableTable.examSlug, request.examSlug),
            isNotNull(examTimetableTable.publishedAt),
            eq(examTimetableTable.publicationCount, request.publicationNumber),
          ),
        )
        .limit(1);
      if (!current) return null;
      let template: Awaited<ReturnType<typeof getSelectedDocumentTemplate>>;
      try {
        template = await getSelectedDocumentTemplate(db, { schoolId, documentType: 'timetable' });
      } catch (error) {
        if (error instanceof ORPCError && error.status === 404) return DOCUMENT_TEMPLATE_UNAVAILABLE;
        throw error;
      }
      const publication = {
        id: request.timetableId,
        schoolId,
        sessionId: request.sessionId,
        examSlug: request.examSlug,
        publicationCount: request.publicationNumber,
      };
      try {
        const { key, bytes } = await readExamTimetablePdf(db, publication, template);
        return { bytes, mimeType: 'application/pdf', templateRevisionId: template.row.id, shareKey: key };
      } catch (error) {
        if (error instanceof ORPCError && error.status >= 400 && error.status < 500) return null;
        throw error;
      }
    },
  };
}
