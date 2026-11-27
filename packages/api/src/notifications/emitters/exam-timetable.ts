import type { DatabaseExecutor } from '@campuspilot/db';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { schoolMemberTable } from '@campuspilot/db/schema/school-member';
import { examClassTable } from '@campuspilot/db/schema/exam';
import { studentTable } from '@campuspilot/db/schema/student';
import { and, asc, eq } from 'drizzle-orm';

import { isSchoolFeatureEnabled } from '../../feature-flags/feature-flags.service';
import { forecastDeliveries, resolveAdmissionRecipients, type DeliveryForecast } from '../dispatch';
import { schoolDeliveryFacts } from '../features';
import { notifyMany, type AnyNotifyInput, type NotifyInput } from '../notify';
import { MAX_EVENT_RECIPIENTS } from './notices';

/**
 * Examination timetable notifications. Publishing a timetable notifies, in
 * the publication's own transaction:
 * - **staff** (`exam.timetable_published_staff`: in-app only): every member
 *   of the school, in events of at most {@link MAX_EVENT_RECIPIENTS};
 * - **students** (`exam.timetable_published`: inbox, web push, WhatsApp),
 *   only while the school has the `cadet` feature: one event per registered
 *   student enrolled in the timetable's session whose class takes part in the
 *   examination (`exam_class`), the students who may open it in the Cadet
 *   Portal; they may read every class taking part. A student of an excluded
 *   class is not notified. They are bulk sends.
 *
 * With the `cadet` feature off, only the staff event is emitted; switching it
 * on later notifies nobody retroactively. Recipients are resolved when the
 * timetable is published and never again.
 *
 * Every publication is its own event: the keys name the timetable and its
 * publication number (`exam_timetable.publication_count`), so a replayed
 * publication never notifies twice, while publishing again after a
 * withdrawal notifies again.
 */

/** Event key of one student's copy of a publication. */
export const timetableEventKey = (timetableId: string, publicationNumber: number, admissionId: string) =>
  `exam-timetable:${timetableId}:${publicationNumber}:${admissionId}`;

/** Event key of the n-th (0-based) staff chunk of a publication; the first has no chunk suffix. */
export const timetableStaffEventKey = (timetableId: string, publicationNumber: number, chunk: number) =>
  chunk === 0
    ? `exam-timetable-staff:${timetableId}:${publicationNumber}`
    : `exam-timetable-staff:${timetableId}:${publicationNumber}:${chunk}`;

export type TimetableAudienceScope = { schoolId: string; sessionId: string; examSlug: string };

/**
 * Registered students enrolled in the session in a class taking part in the
 * examination, by admission, ordered by name.
 */
async function timetableCadetRoster(db: DatabaseExecutor, scope: TimetableAudienceScope) {
  return db
    .select({ admissionId: admissionTable.id, name: admissionTable.name })
    .from(studentTable)
    .innerJoin(admissionTable, and(eq(admissionTable.id, studentTable.admissionId), eq(admissionTable.schoolId, studentTable.schoolId)))
    .innerJoin(
      examClassTable,
      and(
        eq(examClassTable.sessionId, studentTable.sessionId),
        eq(examClassTable.examSlug, scope.examSlug),
        eq(examClassTable.classId, studentTable.classId),
      ),
    )
    .where(and(eq(studentTable.schoolId, scope.schoolId), eq(studentTable.sessionId, scope.sessionId), eq(admissionTable.registered, true)))
    .orderBy(asc(admissionTable.name), asc(admissionTable.id));
}

/** Every current member of the school. */
async function timetableStaffRecipients(db: DatabaseExecutor, schoolId: string): Promise<string[]> {
  const members = await db
    .select({ userId: schoolMemberTable.userId })
    .from(schoolMemberTable)
    .where(eq(schoolMemberTable.schoolId, schoolId))
    .orderBy(asc(schoolMemberTable.userId));
  return members.map((member) => member.userId);
}

/** Whom publishing would notify now; `cadetForecast` is null while the school has no Cadet Portal. */
export type TimetablePublishPreview = { staffRecipientCount: number; cadetForecast: DeliveryForecast | null };

/** What publishing the timetable would notify right now. Read-only. */
export async function previewTimetableDelivery(db: DatabaseExecutor, scope: TimetableAudienceScope): Promise<TimetablePublishPreview> {
  const staff = await timetableStaffRecipients(db, scope.schoolId);
  if (!(await isSchoolFeatureEnabled(db, scope.schoolId, 'cadet'))) return { staffRecipientCount: staff.length, cadetForecast: null };
  const roster = await timetableCadetRoster(db, scope);
  const recipients = await resolveAdmissionRecipients(db, scope.schoolId, roster.map((row) => row.admissionId));
  return {
    staffRecipientCount: staff.length,
    cadetForecast: forecastDeliveries('exam.timetable_published', await schoolDeliveryFacts(db, scope.schoolId, 'exam.timetable_published'), recipients),
  };
}

/**
 * Emits the notifications of a timetable that is being published, inside the
 * publishing transaction (the caller holds the timetable's row lock and has
 * just set its publication). Returns the event IDs to hand over after commit.
 */
export async function notifyTimetablePublished(
  tx: DatabaseExecutor,
  timetable: { id: string; schoolId: string; sessionId: string; examSlug: string; examName: string; publicationNumber: number },
  publishedBy: string,
): Promise<string[]> {
  const staff = await timetableStaffRecipients(tx, timetable.schoolId);
  const roster = (await isSchoolFeatureEnabled(tx, timetable.schoolId, 'cadet')) ? await timetableCadetRoster(tx, timetable) : [];
  const inputs: AnyNotifyInput[] = roster.map(
    (student) =>
      ({
        type: 'exam.timetable_published',
        schoolId: timetable.schoolId,
        key: timetableEventKey(timetable.id, timetable.publicationNumber, student.admissionId),
        createdBy: publishedBy,
        sendPriority: 'bulk',
        recipients: { kind: 'admissions', admissionIds: [student.admissionId] },
        data: {
          sessionId: timetable.sessionId,
          examSlug: timetable.examSlug,
          examName: timetable.examName,
          admissionId: student.admissionId,
          studentName: student.name,
          timetableId: timetable.id,
          publicationNumber: timetable.publicationNumber,
        },
      }) satisfies NotifyInput<'exam.timetable_published'>,
  );
  for (let start = 0, chunk = 0; start < staff.length; start += MAX_EVENT_RECIPIENTS, chunk += 1) {
    inputs.push({
      type: 'exam.timetable_published_staff',
      schoolId: timetable.schoolId,
      key: timetableStaffEventKey(timetable.id, timetable.publicationNumber, chunk),
      createdBy: publishedBy,
      sendPriority: 'immediate',
      recipients: { kind: 'staff_users', userIds: staff.slice(start, start + MAX_EVENT_RECIPIENTS) },
      data: { sessionId: timetable.sessionId, examSlug: timetable.examSlug, examName: timetable.examName },
    } satisfies NotifyInput<'exam.timetable_published_staff'>);
  }
  const results = await notifyMany(tx, inputs);
  return results.map((result) => result.eventId);
}
