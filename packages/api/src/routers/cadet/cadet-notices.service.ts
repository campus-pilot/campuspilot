import type { Database, DatabaseExecutor } from '@campuspilot/db';
import { noticeClassTable, noticeTable } from '@campuspilot/db/schema/notice';
import { studentTable } from '@campuspilot/db/schema/student';
import { and, count, desc, eq, ne, sql, type SQL } from 'drizzle-orm';

import { rpcError } from '../../errors';
import { createNextPageCursor, createPaginatedResult, resolvePaginationInput } from '../../paginations';
import { documentDownloadUrl } from '../school/document/document.storage';
import {
  asPublishedNotice,
  ensureNoticePdfStored,
  renderPublishedNoticeHtml,
  renderPublishedNoticeText,
  type PublishedNotice,
} from '../school/notice/notice.render';

/**
 * Notices in the Cadet Portal. A student sees a notice only when all of
 * these hold, each checked in the query itself:
 * - it belongs to the student's school and is **published** (a draft never
 *   leaves the staff app);
 * - it addresses students at all (`cadet_scope <> 'none'`: a staff-only
 *   notice does not exist here);
 * - the student is enrolled in the notice's session, and for
 *   `selected_classes` that enrollment's class is one of the notice's
 *   classes.
 * Membership is evaluated when the student asks, not frozen at publication:
 * a student who joins a class later sees its notices, and one who is moved
 * out stops seeing them. (Who was *notified* is a separate fact, fixed when
 * the notice was published.) Any other notice id is NOT_FOUND, exactly like
 * an unknown one.
 */
export type CadetScope = { schoolId: string; admissionId: string };

/** The predicate above, for queries on `notice`. */
function addressedTo(cadet: CadetScope): SQL {
  return and(
    eq(noticeTable.schoolId, cadet.schoolId),
    eq(noticeTable.status, 'published'),
    ne(noticeTable.cadetScope, 'none'),
    sql`exists (
      select 1 from ${studentTable}
      where ${studentTable.schoolId} = ${noticeTable.schoolId}
        and ${studentTable.sessionId} = ${noticeTable.sessionId}
        and ${studentTable.admissionId} = ${cadet.admissionId}
        and (
          ${noticeTable.cadetScope} = 'all_classes'
          or (
            ${noticeTable.cadetScope} = 'selected_classes'
            and exists (
              select 1 from ${noticeClassTable}
              where ${noticeClassTable.noticeId} = ${noticeTable.id}
                and ${noticeClassTable.schoolId} = ${noticeTable.schoolId}
                and ${noticeClassTable.classId} = ${studentTable.classId}
            )
          )
        )
    )`,
  )!;
}

/** One page of the notices addressed to the student, newest publication first. */
export async function listCadetNotices(db: DatabaseExecutor, cadet: CadetScope, input: { cursor?: string; page?: number; limit: number }) {
  const { currentPage, pageSize, offset } = resolvePaginationInput(input);
  const where = addressedTo(cadet);
  const [rows, [total]] = await Promise.all([
    db
      .select({ noticeId: noticeTable.id, title: noticeTable.title, publishedAt: noticeTable.publishedAt })
      .from(noticeTable)
      .where(where)
      .orderBy(desc(noticeTable.publishedAt), desc(noticeTable.id))
      .limit(pageSize)
      .offset(offset),
    db.select({ value: count() }).from(noticeTable).where(where),
  ]);
  const totalItems = total?.value ?? 0;
  const totalPages = Math.ceil(totalItems / pageSize);
  return createPaginatedResult({
    // `published_at` is set for every published row (table check constraint).
    items: rows.flatMap((row) => (row.publishedAt ? [{ ...row, publishedAt: row.publishedAt }] : [])),
    nextCursor: createNextPageCursor(currentPage, totalPages),
    currentPage,
    totalPages,
    totalItems,
    pageSize,
  });
}

/** A notice addressed to the student, or NOT_FOUND. */
async function addressedNotice(db: DatabaseExecutor, cadet: CadetScope, noticeId: string): Promise<PublishedNotice> {
  const [row] = await db
    .select()
    .from(noticeTable)
    .where(and(eq(noticeTable.id, noticeId), addressedTo(cadet)))
    .limit(1);
  const published = row ? asPublishedNotice(row) : null;
  if (!published) throw rpcError.notFound('Notice');
  return published;
}

/**
 * One notice as content: its facts and its wording as text, never HTML. A
 * plain notice returns what staff wrote without rendering anything; a
 * custom-template notice is rendered (without the logo) and reduced to its
 * text, so an AI app reading it over the Cadet MCP gets sentences, not
 * megabytes of markup and base64.
 */
export async function getCadetNotice(db: DatabaseExecutor, cadet: CadetScope, noticeId: string) {
  const notice = await addressedNotice(db, cadet, noticeId);
  return {
    noticeId: notice.id,
    title: notice.title,
    publishedAt: notice.publishedAt,
    bodyMode: notice.bodyMode,
    text: notice.bodyMode === 'plain' ? notice.body : await renderPublishedNoticeText(db, notice),
  };
}

/** The printed page of one notice (with the letterhead), for the portal's sandboxed preview. */
export async function getCadetNoticeDocument(db: DatabaseExecutor, cadet: CadetScope, noticeId: string) {
  const notice = await addressedNotice(db, cadet, noticeId);
  return { noticeId: notice.id, html: (await renderPublishedNoticeHtml(db, notice)).html };
}

/** A five-minute download URL of the notice's cached PDF (the same file staff download). */
export async function getCadetNoticeDownload(db: Database, cadet: CadetScope, noticeId: string) {
  const notice = await addressedNotice(db, cadet, noticeId);
  const key = await ensureNoticePdfStored(db, notice);
  return { url: await documentDownloadUrl(key, `Notice ${notice.title}`), expiresIn: 300 };
}
