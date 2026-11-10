import { db as defaultDb, type Database, type DatabaseExecutor } from '@campuspilot/db';
import { studentTable } from '@campuspilot/db/schema/student';
import { and, eq } from 'drizzle-orm';

import { rpcError } from '../../errors';
import { buildDocumentContexts } from '../../routers/school/document/document.context';
import { documentSourceSchema } from '../../routers/school/document/document.dto';
import { selectedDocumentTemplateTypes } from '../../routers/school/document/document.selected-template';
import type { WhatsAppDocumentSource } from '../channels/whatsapp/documents';
import { renderNotificationDocument } from './render';

/**
 * Builds the report-card context of exactly one student of an examination,
 * as `generateDocument` would for an explicit one-student selection: the
 * admission's enrollment in the session and its class, `require_all`
 * results policy (every included subject approved, never partial marks)
 * and the default report sections (print choices are not stored per
 * school; staff choose them per export). Throws the document system's own
 * 4xx errors when the student or results do not qualify (ready exam,
 * unregistered, unapproved results).
 */
export async function buildStudentReportCardContexts(
  db: DatabaseExecutor,
  schoolId: string,
  input: { sessionId: string; examSlug: string; admissionId: string },
) {
  const [enrollment] = await db
    .select({ id: studentTable.id, classId: studentTable.classId })
    .from(studentTable)
    .where(and(eq(studentTable.schoolId, schoolId), eq(studentTable.sessionId, input.sessionId), eq(studentTable.admissionId, input.admissionId)))
    .limit(1);
  if (!enrollment?.classId) throw rpcError.notFound('Student enrollment');
  const source = documentSourceSchema.parse({
    documentType: 'report_card',
    sessionId: input.sessionId,
    classId: enrollment.classId,
    studentIds: [enrollment.id],
    examSlug: input.examSlug,
    resultPolicy: 'require_all',
    reportSections: {},
  });
  return buildDocumentContexts(db, schoolId, source);
}

/**
 * The report card attached to an `exam.results_published` WhatsApp message
 * (D-9): one student's report card rendered with the school's selected
 * report-card template. Results that no longer qualify (the exam was
 * reopened and a result unapproved) produce no PDF and the delivery fails
 * with `document_unavailable`.
 */
export function createReportCardDocumentSource(db: Database = defaultDb): WhatsAppDocumentSource<'report_card'> {
  return {
    available: async ({ schoolId }) => (await selectedDocumentTemplateTypes(db, schoolId, ['report_card'])).has('report_card'),
    produce: (request, { schoolId }) =>
      renderNotificationDocument(
        {
          schoolId,
          documentType: 'report_card',
          buildContexts: async (database) => {
            const data = await database.transaction(
              (tx) => buildStudentReportCardContexts(tx, schoolId, request),
              { isolationLevel: 'repeatable read', accessMode: 'read only' },
            );
            return data.contexts;
          },
        },
        db,
      ),
  };
}
