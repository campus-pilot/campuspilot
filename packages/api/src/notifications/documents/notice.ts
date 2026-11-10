import { db as defaultDb, type Database } from '@campuspilot/db';
import { noticeTable } from '@campuspilot/db/schema/notice';
import { ORPCError } from '@orpc/server';
import { and, eq } from 'drizzle-orm';

import { readNoticePdf } from '../../routers/school/notice/notice.render';
import type { WhatsAppDocumentSource } from '../channels/whatsapp/documents';

/**
 * The notice PDF attached to a `notice.published` WhatsApp message.
 *
 * Unlike receipts and report cards, this PDF is the same for every
 * recipient and its notice is immutable once published, so it is rendered
 * once and reused: the bytes come from the notice's cached object
 * (`schools/{schoolId}/notices/{noticeId}.pdf`, decision D9), which also
 * backs the staff and Cadet Portal downloads. A publication to thousands of
 * students therefore converts one PDF, not thousands.
 *
 * `available` is always true: a notice needs no selected school template
 * (a plain notice falls back to the built-in default design, a template
 * notice is its own document), so there is never a reason to send text
 * instead. A notice that is gone, belongs to another school or is not
 * published, and a notice whose template no longer renders (a 4xx from the
 * renderer), can never produce a PDF: `null`, which fails the delivery
 * visibly. Anything else (database, S3 or Gotenberg unavailable) is thrown
 * and retried.
 */
export function createNoticeDocumentSource(db: Database = defaultDb): WhatsAppDocumentSource<'notice'> {
  return {
    available: async () => true,
    produce: async (request, { schoolId }) => {
      const [notice] = await db
        .select()
        .from(noticeTable)
        .where(and(eq(noticeTable.id, request.noticeId), eq(noticeTable.schoolId, schoolId)))
        .limit(1);
      if (!notice || notice.status !== 'published' || !notice.publishedAt) return null;
      try {
        const bytes = await readNoticePdf(db, { ...notice, publishedAt: notice.publishedAt });
        return { bytes, mimeType: 'application/pdf', templateRevisionId: notice.templateRevisionId };
      } catch (error) {
        if (error instanceof ORPCError && error.status >= 400 && error.status < 500) return null;
        throw error;
      }
    },
  };
}
