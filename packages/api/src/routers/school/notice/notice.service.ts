import type { Database, DatabaseExecutor } from '@campuspilot/db';
import { user } from '@campuspilot/db/schema/auth';
import { classTable } from '@campuspilot/db/schema/class';
import {
  noticeBodyModeEnum,
  noticeCadetScopeEnum,
  noticeClassTable,
  noticeStatusEnum,
  noticeTable,
  type NoticeRow,
} from '@campuspilot/db/schema/notice';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';

import { rpcError } from '../../../errors';
import { assertSchoolFeatureEnabled } from '../../../feature-flags/feature-flags.service';
import {
  notifyNoticePublished,
  previewNoticeDelivery,
  resolveNoticeRecipients,
} from '../../../notifications/emitters/notices';
import { handOffNotificationEvents } from '../../../notifications/notification.outbox';
import { createNextPageCursor, createPaginatedResult, resolvePaginationInput } from '../../../paginations';
import { documentDownloadUrl } from '../document/document.storage';
import type { NoticePublishPreview } from './notice-delivery.dto';
import {
  NOTICE_CHANGED_MESSAGE,
  NOTICE_TEMPLATE_CHANGED_MESSAGE,
  type createNoticeInputSchema,
  type listNoticesInputSchema,
  type NOTICE_BODY_MODES,
  type NOTICE_CADET_SCOPES,
  type NOTICE_STATUSES,
  type NoticeCadetScope,
  type NoticeDto,
  type NoticeSummaryDto,
  type previewNoticeInputSchema,
  type publishNoticeInputSchema,
  type updateNoticeInputSchema,
} from './notice.dto';
import {
  asPublishedNotice,
  assertValidNoticeTemplate,
  ensureNoticePdfStored,
  currentNoticeTemplateRevisionId,
  renderNoticeHtml,
  renderPublishedNoticeHtml,
  type NoticeContent,
} from './notice.render';

/**
 * Notice lifecycle and visibility (decisions D5, D6, D7).
 *
 * Visibility for staff: a published notice is visible to every holder of
 * `school.notice.read`, whoever it is addressed to. A draft is visible to
 * its author and to holders of `school.notice.publish`; for anyone else it
 * does not exist (NOT_FOUND, never FORBIDDEN, so a draft's existence is not
 * disclosed). Ownership is the `created_by` fact, never a role.
 *
 * Every query is scoped by `school_id`; the session and every class named
 * by a notice are verified to belong to that school.
 */

// The browser-safe DTO constants must list exactly the database enum values.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _bodyModes: Same<(typeof NOTICE_BODY_MODES)[number], (typeof noticeBodyModeEnum.enumValues)[number]> = true;
const _statuses: Same<(typeof NOTICE_STATUSES)[number], (typeof noticeStatusEnum.enumValues)[number]> = true;
const _cadetScopes: Same<(typeof NOTICE_CADET_SCOPES)[number], (typeof noticeCadetScopeEnum.enumValues)[number]> = true;
void [_bodyModes, _statuses, _cadetScopes];

/** Who is asking, as the handlers establish it. */
export type NoticeViewer = {
  userId: string;
  /** Holds `school.notice.publish` in the notice's school (decided by OPA). */
  canPublish: boolean;
};

const author = alias(user, 'notice_author');
const publisher = alias(user, 'notice_publisher');

/** Rows of the school this viewer may see (see the module comment). */
function visibleTo(schoolId: string, viewer: NoticeViewer): SQL {
  return and(
    eq(noticeTable.schoolId, schoolId),
    viewer.canPublish ? undefined : or(eq(noticeTable.status, 'published'), eq(noticeTable.createdBy, viewer.userId)),
  )!;
}

function viewerFacts(row: Pick<NoticeRow, 'status' | 'createdBy'>, viewer: NoticeViewer) {
  const draft = row.status === 'draft';
  return {
    canEdit: draft && (viewer.canPublish || row.createdBy === viewer.userId),
    canPublish: draft && viewer.canPublish,
  };
}

type NoticeClass = { classId: string | null; name: string };

/**
 * The class rows per notice, in class display order with deleted classes
 * last (tenant-scoped on both tables). `name` is the class's current label
 * while it exists and the recorded name once it is gone; `recordedName` is
 * the snapshot itself (what a published notice shows, see `notice_class`).
 */
async function classesByNotice(db: DatabaseExecutor, schoolId: string, noticeIds: string[]) {
  const byNotice = new Map<string, { classId: string | null; currentName: string; recordedName: string }[]>();
  if (noticeIds.length === 0) return byNotice;
  const rows = await db
    .select({
      noticeId: noticeClassTable.noticeId,
      classId: classTable.id,
      currentName: sql<string>`coalesce(${classTable.label}, ${noticeClassTable.className})`,
      recordedName: noticeClassTable.className,
    })
    .from(noticeClassTable)
    .leftJoin(classTable, and(eq(classTable.id, noticeClassTable.classId), eq(classTable.schoolId, schoolId)))
    .where(and(eq(noticeClassTable.schoolId, schoolId), inArray(noticeClassTable.noticeId, noticeIds)))
    .orderBy(sql`${classTable.displayOrder} asc nulls last`, asc(noticeClassTable.className), asc(noticeClassTable.id));
  for (const row of rows) byNotice.set(row.noticeId, [...(byNotice.get(row.noticeId) ?? []), row]);
  return byNotice;
}

type NoticeWithNames = { notice: NoticeRow; createdByName: string | null; publishedByName: string | null };
type NoticeClassRows = NonNullable<ReturnType<Awaited<ReturnType<typeof classesByNotice>>['get']>>;

function toSummary({ notice, createdByName, publishedByName }: NoticeWithNames, classRows: NoticeClassRows, viewer: NoticeViewer): NoticeSummaryDto {
  const published = notice.status === 'published';
  const classes: NoticeClass[] = classRows.map((row) => ({ classId: row.classId, name: published ? row.recordedName : row.currentName }));
  return {
    id: notice.id,
    schoolId: notice.schoolId,
    sessionId: notice.sessionId,
    title: notice.title,
    bodyMode: notice.bodyMode,
    status: notice.status,
    toStaff: notice.toStaff,
    cadetScope: notice.cadetScope,
    classIds: classRows.flatMap((row) => (row.classId ? [row.classId] : [])),
    classes,
    version: notice.version,
    createdBy: notice.createdBy,
    createdByName,
    createdAt: notice.createdAt,
    updatedAt: notice.updatedAt,
    publishedBy: notice.publishedBy,
    publishedByName,
    publishedAt: notice.publishedAt,
    issuedOn: notice.issuedOn,
    publishedStaffCount: notice.publishedStaffCount,
    publishedCadetCount: notice.publishedCadetCount,
    viewer: viewerFacts(notice, viewer),
  };
}

function withNames(db: DatabaseExecutor) {
  return db
    .select({ notice: noticeTable, createdByName: author.name, publishedByName: publisher.name })
    .from(noticeTable)
    .leftJoin(author, eq(author.id, noticeTable.createdBy))
    .leftJoin(publisher, eq(publisher.id, noticeTable.publishedBy));
}

/** One visible notice with its body, or NOT_FOUND. */
export async function getNotice(db: DatabaseExecutor, input: { schoolId: string; noticeId: string }, viewer: NoticeViewer): Promise<NoticeDto> {
  const [row] = await withNames(db)
    .where(and(eq(noticeTable.id, input.noticeId), visibleTo(input.schoolId, viewer)))
    .limit(1);
  if (!row) throw rpcError.notFound('Notice');
  const classes = (await classesByNotice(db, input.schoolId, [row.notice.id])).get(row.notice.id) ?? [];
  return { ...toSummary(row, classes, viewer), body: row.notice.body, templateRevisionId: row.notice.templateRevisionId };
}

async function assertSessionOfSchool(db: DatabaseExecutor, schoolId: string, sessionId: string) {
  const [session] = await db
    .select({ id: schoolSessionTable.id })
    .from(schoolSessionTable)
    .where(and(eq(schoolSessionTable.id, sessionId), eq(schoolSessionTable.schoolId, schoolId)))
    .limit(1);
  if (!session) throw rpcError.notFound('School session');
}

/** One page of the session's notices the viewer may see. */
export async function listNotices(db: DatabaseExecutor, input: z.infer<typeof listNoticesInputSchema>, viewer: NoticeViewer) {
  await assertSessionOfSchool(db, input.schoolId, input.sessionId);
  const { status, toStaff, toCadets } = input.filters;
  const where = and(
    visibleTo(input.schoolId, viewer),
    eq(noticeTable.sessionId, input.sessionId),
    status ? eq(noticeTable.status, status) : undefined,
    toStaff === undefined ? undefined : eq(noticeTable.toStaff, toStaff),
    toCadets === undefined ? undefined : toCadets ? ne(noticeTable.cadetScope, 'none') : eq(noticeTable.cadetScope, 'none'),
    input.searchQuery ? ilike(noticeTable.title, `%${input.searchQuery.replace(/[\\%_]/g, '\\$&')}%`) : undefined,
  );
  const direction = input.orderBy.direction === 'asc' ? asc : desc;
  const order =
    input.orderBy.field === 'title'
      ? [direction(noticeTable.title)]
      : input.orderBy.field === 'publishedAt'
        ? // Drafts have no publication time: they follow every published notice in either direction.
          [sql`${noticeTable.publishedAt} ${sql.raw(input.orderBy.direction)} nulls last`]
        : [direction(noticeTable.createdAt)];
  const { currentPage, pageSize, offset } = resolvePaginationInput(input);
  const [rows, [total]] = await Promise.all([
    withNames(db).where(where).orderBy(...order, asc(noticeTable.id)).limit(pageSize).offset(offset),
    db.select({ value: count() }).from(noticeTable).where(where),
  ]);
  const classes = await classesByNotice(db, input.schoolId, rows.map((row) => row.notice.id));
  const totalItems = total?.value ?? 0;
  const totalPages = Math.ceil(totalItems / pageSize);
  return createPaginatedResult({
    items: rows.map((row) => toSummary(row, classes.get(row.notice.id) ?? [], viewer)),
    nextCursor: createNextPageCursor(currentPage, totalPages),
    currentPage,
    totalPages,
    totalItems,
    pageSize,
  });
}

type AudienceInput = { toStaff: boolean; cadetScope: NoticeCadetScope; classIds: string[] };

/**
 * Checks an audience against the school: any student scope needs the
 * school's `cadet` feature (decision D1: the flag is "the school has the
 * Cadet Portal"), and every class named must be a class of this school.
 * Returns the named classes with their current labels (the name recorded
 * with the audience).
 */
async function assertAudienceAllowed(db: DatabaseExecutor, schoolId: string, audience: AudienceInput) {
  if (audience.cadetScope !== 'none') await assertSchoolFeatureEnabled(db, schoolId, 'cadet');
  if (audience.classIds.length === 0) return [];
  const found = await db
    .select({ id: classTable.id, label: classTable.label })
    .from(classTable)
    .where(and(eq(classTable.schoolId, schoolId), inArray(classTable.id, audience.classIds)));
  if (found.length !== audience.classIds.length) throw rpcError.notFound('School class');
  return found;
}

async function replaceNoticeClasses(tx: DatabaseExecutor, schoolId: string, noticeId: string, classes: { id: string; label: string }[]) {
  await tx.delete(noticeClassTable).where(and(eq(noticeClassTable.noticeId, noticeId), eq(noticeClassTable.schoolId, schoolId)));
  if (classes.length > 0) {
    await tx.insert(noticeClassTable).values(classes.map((schoolClass) => ({ noticeId, classId: schoolClass.id, className: schoolClass.label, schoolId })));
  }
}

/** Creates a draft owned by the caller. */
export async function createNotice(db: Database, input: z.infer<typeof createNoticeInputSchema>, viewer: NoticeViewer): Promise<NoticeDto> {
  if (input.bodyMode === 'template') assertValidNoticeTemplate(input.body);
  const noticeId = await db.transaction(async (tx) => {
    await assertSessionOfSchool(tx, input.schoolId, input.sessionId);
    const classes = await assertAudienceAllowed(tx, input.schoolId, input);
    const [row] = await tx
      .insert(noticeTable)
      .values({
        schoolId: input.schoolId,
        sessionId: input.sessionId,
        title: input.title,
        bodyMode: input.bodyMode,
        body: input.body,
        toStaff: input.toStaff,
        cadetScope: input.cadetScope,
        createdBy: viewer.userId,
      })
      .returning({ id: noticeTable.id });
    await replaceNoticeClasses(tx, input.schoolId, row!.id, classes);
    return row!.id;
  });
  return getNotice(db, { schoolId: input.schoolId, noticeId }, viewer);
}

/**
 * Locks a notice the viewer may see and requires it to be an editable
 * draft. A published notice is CONFLICT; a draft the viewer may not see is
 * NOT_FOUND (so it can never be FORBIDDEN here: whoever sees a draft may
 * edit it).
 */
async function lockEditableDraft(tx: DatabaseExecutor, input: { schoolId: string; noticeId: string }, viewer: NoticeViewer, action: string) {
  const [row] = await tx
    .select()
    .from(noticeTable)
    .where(and(eq(noticeTable.id, input.noticeId), visibleTo(input.schoolId, viewer)))
    .for('update')
    .limit(1);
  if (!row) throw rpcError.notFound('Notice');
  if (row.status !== 'draft') throw rpcError.conflict(`A published notice cannot be ${action}.`);
  return row;
}

/**
 * Replaces a draft's content and audience. The caller names the version
 * they edited (`expectedVersion`); when someone else saved in between, the
 * write is refused with CONFLICT instead of silently overwriting their
 * change. Checked under the row lock, so two simultaneous saves of one
 * version cannot both succeed.
 */
export async function updateNotice(db: Database, input: z.infer<typeof updateNoticeInputSchema>, viewer: NoticeViewer): Promise<NoticeDto> {
  if (input.bodyMode === 'template') assertValidNoticeTemplate(input.body);
  await db.transaction(async (tx) => {
    const row = await lockEditableDraft(tx, input, viewer, 'changed');
    if (row.version !== input.expectedVersion) throw rpcError.conflict(NOTICE_CHANGED_MESSAGE);
    const classes = await assertAudienceAllowed(tx, input.schoolId, input);
    const [updated] = await tx
      .update(noticeTable)
      .set({
        title: input.title,
        bodyMode: input.bodyMode,
        body: input.body,
        toStaff: input.toStaff,
        cadetScope: input.cadetScope,
        version: row.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(noticeTable.id, input.noticeId), eq(noticeTable.schoolId, input.schoolId), eq(noticeTable.status, 'draft')))
      .returning({ id: noticeTable.id });
    if (!updated) throw rpcError.conflict('A published notice cannot be changed.');
    await replaceNoticeClasses(tx, input.schoolId, input.noticeId, classes);
  });
  return getNotice(db, input, viewer);
}

/** Deletes a draft (its class rows cascade). */
export async function deleteNotice(db: Database, input: { schoolId: string; noticeId: string }, viewer: NoticeViewer) {
  await db.transaction(async (tx) => {
    await lockEditableDraft(tx, input, viewer, 'deleted');
    const deleted = await tx
      .delete(noticeTable)
      .where(and(eq(noticeTable.id, input.noticeId), eq(noticeTable.schoolId, input.schoolId), eq(noticeTable.status, 'draft')))
      .returning({ id: noticeTable.id });
    if (deleted.length === 0) throw rpcError.conflict('A published notice cannot be deleted.');
  });
}

async function visibleRow(db: DatabaseExecutor, input: { schoolId: string; noticeId: string }, viewer: NoticeViewer) {
  const [row] = await db
    .select()
    .from(noticeTable)
    .where(and(eq(noticeTable.id, input.noticeId), visibleTo(input.schoolId, viewer)))
    .limit(1);
  if (!row) throw rpcError.notFound('Notice');
  return row;
}

/**
 * Renders a notice to sanitized HTML without persisting anything: a saved
 * notice as stored (a published one from what was fixed at publication, a
 * draft with the school's current template and today's date), or unsaved
 * content.
 */
export async function previewNotice(db: DatabaseExecutor, input: z.infer<typeof previewNoticeInputSchema>, viewer: NoticeViewer) {
  const draftOptions = { generatedAt: new Date(), issuedOn: null, template: { kind: 'current' } } as const;
  if (input.source.kind === 'saved') {
    const row = await visibleRow(db, { schoolId: input.schoolId, noticeId: input.source.noticeId }, viewer);
    const published = asPublishedNotice(row);
    const rendered = published ? await renderPublishedNoticeHtml(db, published) : await renderNoticeHtml(db, row, draftOptions);
    // The version and template revision of exactly this render: what a publisher who reads it confirms.
    return { html: rendered.html, version: row.version, templateRevisionId: rendered.templateRevisionId };
  }
  const content: NoticeContent = { schoolId: input.schoolId, sessionId: input.source.sessionId, title: input.source.title, bodyMode: input.source.bodyMode, body: input.source.body };
  const rendered = await renderNoticeHtml(db, content, draftOptions);
  return { html: rendered.html, version: null, templateRevisionId: rendered.templateRevisionId };
}

/**
 * A selected-classes draft needs at least one class that still exists: a
 * class deleted since the draft was saved addresses nobody.
 */
async function assertHasAudienceClasses(db: DatabaseExecutor, notice: Pick<NoticeRow, 'id' | 'schoolId' | 'cadetScope'>) {
  if (notice.cadetScope !== 'selected_classes') return;
  const [row] = await db
    .select({ value: count() })
    .from(noticeClassTable)
    .where(and(eq(noticeClassTable.noticeId, notice.id), eq(noticeClassTable.schoolId, notice.schoolId), isNotNull(noticeClassTable.classId)));
  if (!row || row.value === 0) throw rpcError.badRequest('Choose at least one class before publishing this notice.');
}

/**
 * Makes a draft's class rows the audience record of its publication: rows
 * whose class was deleted since the draft was saved are dropped (that class
 * is not addressed), and every remaining row takes its class's name as it
 * is now. From here on the rows are never rewritten; `class_id` only goes
 * null if the class is deleted later.
 */
async function recordPublishedClasses(tx: DatabaseExecutor, notice: Pick<NoticeRow, 'id' | 'schoolId'>) {
  const ofNotice = and(eq(noticeClassTable.noticeId, notice.id), eq(noticeClassTable.schoolId, notice.schoolId));
  await tx.delete(noticeClassTable).where(and(ofNotice, isNull(noticeClassTable.classId)));
  await tx
    .update(noticeClassTable)
    .set({ className: classTable.label })
    .from(classTable)
    .where(and(ofNotice, eq(classTable.id, noticeClassTable.classId), eq(classTable.schoolId, notice.schoolId)));
}

/**
 * What publishing would notify (the caller holds the publish permission, so
 * every draft is visible). `version` and `templateRevisionId` say what this
 * forecast was made for: the dialog compares them with the preview the
 * publisher is looking at.
 */
export async function previewNoticePublish(db: DatabaseExecutor, input: { schoolId: string; noticeId: string }, viewer: NoticeViewer): Promise<NoticePublishPreview> {
  const row = await visibleRow(db, input, viewer);
  if (row.status === 'published' && row.publishedAt) return { kind: 'already_published', publishedAt: row.publishedAt };
  if (row.cadetScope !== 'none') await assertSchoolFeatureEnabled(db, input.schoolId, 'cadet');
  await assertHasAudienceClasses(db, row);
  const delivery = await previewNoticeDelivery(db, row);
  return { kind: 'ready', version: row.version, templateRevisionId: await currentNoticeTemplateRevisionId(db, row), toStaff: row.toStaff, cadetScope: row.cadetScope, ...delivery };
}

/**
 * Publishes a draft, once, and only what the publisher reviewed.
 *
 * One transaction: lock the notice row, refuse an already published notice
 * with CONFLICT, refuse with CONFLICT when the draft is no longer the
 * `expectedVersion` (its author may keep editing while a publisher reads
 * it; publication is irreversible, so it must never send text or an
 * audience nobody approved), re-check the audience against the school as it
 * is now (the `cadet` feature may have been switched off since the draft
 * was saved), render it once to prove it renders and to learn the template
 * revision to pin and the issued-on date to store, refuse with CONFLICT
 * when that revision is not the `expectedTemplateRevisionId` (a plain
 * notice is printed inside the school's Notice template, which a template
 * manager may have replaced since the publisher's preview; the revision
 * compared is the one this very render used and pins, so no change of the
 * selection can slip between the check and the publication), resolve the
 * recipients,
 * flip `draft -> published` conditionally and emit one notification event
 * per student plus the staff events. The row lock serializes a double click
 * and concurrent publishers: the second finds the notice published and gets
 * CONFLICT, so there is exactly one fan-out (the event keys would
 * deduplicate besides). The events commit with the publication and are
 * handed over only after the commit.
 */
export async function publishNotice(db: Database, input: z.infer<typeof publishNoticeInputSchema>, viewer: NoticeViewer): Promise<NoticeDto> {
  const eventIds = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(noticeTable)
      .where(and(eq(noticeTable.id, input.noticeId), visibleTo(input.schoolId, viewer)))
      .for('update')
      .limit(1);
    if (!row) throw rpcError.notFound('Notice');
    if (row.status !== 'draft') throw rpcError.conflict('This notice is already published.');
    if (row.version !== input.expectedVersion) throw rpcError.conflict(NOTICE_CHANGED_MESSAGE);
    if (row.cadetScope !== 'none') await assertSchoolFeatureEnabled(tx, input.schoolId, 'cadet');
    await assertHasAudienceClasses(tx, row);
    await recordPublishedClasses(tx, row);
    const publishedAt = new Date();
    const rendered = await renderNoticeHtml(tx, row, { generatedAt: publishedAt, issuedOn: null, template: { kind: 'current' } });
    if (rendered.templateRevisionId !== input.expectedTemplateRevisionId) throw rpcError.conflict(NOTICE_TEMPLATE_CHANGED_MESSAGE);
    const recipients = await resolveNoticeRecipients(tx, row);
    const [published] = await tx
      .update(noticeTable)
      .set({
        status: 'published',
        publishedAt,
        issuedOn: rendered.issuedOn,
        publishedBy: viewer.userId,
        templateRevisionId: rendered.templateRevisionId,
        publishedStaffCount: recipients.staff.length,
        publishedCadetCount: recipients.roster.length,
        version: row.version + 1,
        updatedAt: publishedAt,
      })
      .where(and(eq(noticeTable.id, input.noticeId), eq(noticeTable.schoolId, input.schoolId), eq(noticeTable.status, 'draft')))
      .returning({ id: noticeTable.id });
    if (!published) throw rpcError.conflict('This notice is already published.');
    return notifyNoticePublished(tx, row, recipients, viewer.userId);
  });
  handOffNotificationEvents(eventIds);
  return getNotice(db, input, viewer);
}

/** A five-minute download URL of a published notice's PDF (rendered and cached on first use). */
export async function getNoticeDownload(db: Database, input: { schoolId: string; noticeId: string }, viewer: NoticeViewer) {
  const row = await visibleRow(db, input, viewer);
  const published = asPublishedNotice(row);
  if (!published) throw rpcError.conflict('Publish the notice to download its PDF.');
  const key = await ensureNoticePdfStored(db, published);
  return { url: await documentDownloadUrl(key, `Notice ${row.title}`), expiresIn: 300 };
}
