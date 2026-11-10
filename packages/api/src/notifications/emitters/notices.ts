import type { DatabaseExecutor } from '@campuspilot/db';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { noticeClassTable, type NoticeRow } from '@campuspilot/db/schema/notice';
import { schoolMemberTable } from '@campuspilot/db/schema/school-member';
import { schoolTable } from '@campuspilot/db/schema/school';
import { studentTable } from '@campuspilot/db/schema/student';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { rpcError } from '../../errors';
import { forecastDeliveries, resolveAdmissionRecipients, type DeliveryForecast } from '../dispatch';
import { notifyMany, type AnyNotifyInput, type NotifyInput } from '../notify';

/**
 * Notice notifications. Publishing a notice notifies, in the publication's
 * own transaction:
 * - **students** (`notice.published`: inbox, web push, WhatsApp with the
 *   notice PDF): one event per registered student the notice addresses, so
 *   each WhatsApp copy names its student. They are one bulk batch
 *   (`batch = { kind: 'notice', id: noticeId }`): sent after one-off sends,
 *   and WhatsApp failures are reported as one alert per notice;
 * - **staff** (`notice.published_staff`: in-app only): every member of the
 *   school, in events of at most {@link MAX_EVENT_RECIPIENTS} recipients.
 *
 * Recipients are resolved when the notice is published and never again: a
 * student enrolled or a member added later is not notified (they still see
 * the notice). Keys derive from the notice, so a replayed publication can
 * never notify twice.
 */

/** The most recipients one notification event may address (the recipient spec's limit). */
export const MAX_EVENT_RECIPIENTS = 10_000;

/** Event key of one student's copy of a notice. */
export const noticeEventKey = (noticeId: string, admissionId: string) => `notice:${noticeId}:${admissionId}`;

/** Event key of the n-th (0-based) staff chunk of a notice; the first has no suffix. */
export const noticeStaffEventKey = (noticeId: string, chunk: number) => (chunk === 0 ? `notice-staff:${noticeId}` : `notice-staff:${noticeId}:${chunk}`);

/** The audience facts of a notice that decide whom it addresses. */
export type NoticeAudience = Pick<NoticeRow, 'id' | 'schoolId' | 'sessionId' | 'toStaff' | 'cadetScope'>;

/**
 * Registered students a notice addresses, by admission (one enrollment per
 * admission and session), ordered by name:
 * - `all_classes`: every enrollment of the notice's session, placed in a
 *   class or not;
 * - `selected_classes`: enrollments whose class is one of the notice's
 *   classes;
 * - `none`: nobody.
 * Every table is filtered by the notice's school.
 */
export async function noticeCadetRoster(db: DatabaseExecutor, notice: NoticeAudience) {
  if (notice.cadetScope === 'none') return [];
  const noticeClassIds = db
    .select({ classId: noticeClassTable.classId })
    .from(noticeClassTable)
    .where(and(eq(noticeClassTable.noticeId, notice.id), eq(noticeClassTable.schoolId, notice.schoolId)));
  return db
    .select({ admissionId: admissionTable.id, name: admissionTable.name })
    .from(studentTable)
    .innerJoin(admissionTable, and(eq(admissionTable.id, studentTable.admissionId), eq(admissionTable.schoolId, studentTable.schoolId)))
    .where(
      and(
        eq(studentTable.schoolId, notice.schoolId),
        eq(studentTable.sessionId, notice.sessionId),
        eq(admissionTable.registered, true),
        notice.cadetScope === 'selected_classes' ? inArray(studentTable.classId, noticeClassIds) : undefined,
      ),
    )
    .orderBy(asc(admissionTable.name), asc(admissionTable.id));
}

/** Every current member of the school, when the notice addresses staff. */
export async function noticeStaffRecipients(db: DatabaseExecutor, notice: NoticeAudience): Promise<string[]> {
  if (!notice.toStaff) return [];
  const members = await db
    .select({ userId: schoolMemberTable.userId })
    .from(schoolMemberTable)
    .where(eq(schoolMemberTable.schoolId, notice.schoolId))
    .orderBy(asc(schoolMemberTable.userId));
  return members.map((member) => member.userId);
}

async function isDemoSchool(db: DatabaseExecutor, schoolId: string) {
  const [school] = await db.select({ isDemo: schoolTable.isDemo }).from(schoolTable).where(eq(schoolTable.id, schoolId)).limit(1);
  if (!school) throw rpcError.notFound('School');
  return school.isDemo;
}

/** Whom publishing would notify now, with the students' per-channel forecast (null when no student scope). */
export type NoticeDeliveryPreview = { staffRecipientCount: number; cadetForecast: DeliveryForecast | null };

/** What publishing the notice would notify right now. Read-only. */
export async function previewNoticeDelivery(db: DatabaseExecutor, notice: NoticeAudience): Promise<NoticeDeliveryPreview> {
  const staff = await noticeStaffRecipients(db, notice);
  if (notice.cadetScope === 'none') return { staffRecipientCount: staff.length, cadetForecast: null };
  const roster = await noticeCadetRoster(db, notice);
  const recipients = await resolveAdmissionRecipients(db, notice.schoolId, roster.map((row) => row.admissionId));
  return { staffRecipientCount: staff.length, cadetForecast: forecastDeliveries('notice.published', await isDemoSchool(db, notice.schoolId), recipients) };
}

/** The recipients of a publication, resolved once by the publishing transaction. */
export type NoticeRecipients = {
  roster: Awaited<ReturnType<typeof noticeCadetRoster>>;
  staff: string[];
};

/** Resolves whom a notice addresses right now (see the module comment). */
export async function resolveNoticeRecipients(db: DatabaseExecutor, notice: NoticeAudience): Promise<NoticeRecipients> {
  return { roster: await noticeCadetRoster(db, notice), staff: await noticeStaffRecipients(db, notice) };
}

/**
 * Emits the notifications of a notice that is being published, inside the
 * publishing transaction (the caller holds the notice's row lock and flips
 * it to `published` conditionally, so this runs once per notice; the keys
 * deduplicate besides). `recipients` are the ones the caller resolved and
 * recorded on the notice. Returns the event IDs to hand over after commit.
 */
export async function notifyNoticePublished(
  tx: DatabaseExecutor,
  notice: NoticeAudience & { title: string },
  { roster, staff }: NoticeRecipients,
  publishedBy: string,
): Promise<string[]> {
  const inputs: AnyNotifyInput[] = roster.map(
    (student) =>
      ({
        type: 'notice.published',
        schoolId: notice.schoolId,
        key: noticeEventKey(notice.id, student.admissionId),
        createdBy: publishedBy,
        sendPriority: 'bulk',
        batch: { kind: 'notice', id: notice.id },
        recipients: { kind: 'admissions', admissionIds: [student.admissionId] },
        data: { noticeId: notice.id, sessionId: notice.sessionId, noticeTitle: notice.title, admissionId: student.admissionId, studentName: student.name },
      }) satisfies NotifyInput<'notice.published'>,
  );
  for (let start = 0, chunk = 0; start < staff.length; start += MAX_EVENT_RECIPIENTS, chunk += 1) {
    inputs.push({
      type: 'notice.published_staff',
      schoolId: notice.schoolId,
      key: noticeStaffEventKey(notice.id, chunk),
      createdBy: publishedBy,
      // Staff types have no remote copies; the inbox row is written at once.
      sendPriority: 'immediate',
      recipients: { kind: 'staff_users', userIds: staff.slice(start, start + MAX_EVENT_RECIPIENTS) },
      data: { noticeId: notice.id, sessionId: notice.sessionId, noticeTitle: notice.title },
    } satisfies NotifyInput<'notice.published_staff'>);
  }
  const results = await notifyMany(tx, inputs);
  return results.map((result) => result.eventId);
}
