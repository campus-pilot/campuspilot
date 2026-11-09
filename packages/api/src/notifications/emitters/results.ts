import { db as defaultDb, type Database, type DatabaseExecutor } from '@campuspilot/db';
import { generateId } from '@campuspilot/db/id';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { examLifecycleTable, examPlanTable } from '@campuspilot/db/schema/exam';
import {
  examResultPublicationTable,
  type ExamResultPublicationRow,
  type ResultPublicationOutcome,
} from '@campuspilot/db/schema/exam-result-publication';
import { notificationDeliveryTable, notificationEventTable, notificationTable } from '@campuspilot/db/schema/notification';
import { schoolTable } from '@campuspilot/db/schema/school';
import { studentTable } from '@campuspilot/db/schema/student';
import { createHash } from 'node:crypto';
import { and, asc, count, eq, inArray, isNull, lt, sql } from 'drizzle-orm';

import { isRetryableTransactionError, rpcError } from '../../errors';
import { getExam, type ExamScope } from '../../routers/school/exam/exam.service';
import { lifecycleWhere } from '../../routers/school/exam/exam.scope';
import { forecastDeliveries, resolveAdmissionRecipients, type DeliveryForecast } from '../dispatch';
import { buildStudentReportCardContexts } from '../documents/report-card';
import { handOffNotificationEvents } from '../notification.outbox';
import { notify, notifyMany, type NotifyInput } from '../notify';
import { stuckSendingCutoff } from '../stuck-sending';
import { MAX_NOTIFICATION_DISPATCH_ATTEMPTS } from '../../workflows/notification/constants';
import { log } from '../../workflows/notification/log';

/**
 * Result notifications (Phase 6, D-10, D-26, D-30, D-43):
 * - **Release**: the examination's first release to the Cadet Portal
 *   (`releaseExamToCadet`) notifies every registered student of its classes
 *   with one `exam.results_published`, in the release's own transaction
 *   ({@link notifyFirstResultRelease}). The recipients and their per-channel
 *   forecast are stored on the `exam_result_publication` row, which is also
 *   what makes it once per exam: a withdraw and a later re-release notify
 *   nobody again.
 * - **Single send**: one student's result for any started exam at any time
 *   (not tied to the release), as often as staff choose; each press is its
 *   own event (client idempotency key). Corrections after a release use it.
 * - **Finished**: once every delivery of a release batch settled, the
 *   releaser gets `exam.results_publish_finished` ({@link sweepResultPublications}).
 * Delivery is the ordinary durable, bounded fan-out (retries with backoff).
 */

/** Event key of one student's copy of a publication. */
export const resultPublicationEventKey = (publicationId: string, admissionId: string) =>
  `exam-results:${publicationId}:${admissionId}`;

/**
 * Registered students of the exam's classes, by admission (one enrollment
 * per session), with the enrollment and its class: the class whose plan the
 * student's results of this exam belong to.
 */
async function publicationRoster(db: DatabaseExecutor, scope: ExamScope) {
  const classIds = db
    .selectDistinct({ classId: examPlanTable.classId })
    .from(examPlanTable)
    .where(and(eq(examPlanTable.schoolId, scope.schoolId), eq(examPlanTable.sessionId, scope.sessionId), eq(examPlanTable.examSlug, scope.examSlug)));
  const rows = await db
    .select({ admissionId: admissionTable.id, name: admissionTable.name, studentId: studentTable.id, classId: studentTable.classId })
    .from(studentTable)
    .innerJoin(admissionTable, and(eq(admissionTable.id, studentTable.admissionId), eq(admissionTable.schoolId, studentTable.schoolId)))
    .where(
      and(
        eq(studentTable.schoolId, scope.schoolId),
        eq(studentTable.sessionId, scope.sessionId),
        eq(admissionTable.registered, true),
        inArray(studentTable.classId, classIds),
      ),
    )
    .orderBy(asc(admissionTable.name), asc(admissionTable.id));
  // `inArray` above already excludes enrollments without a class.
  return rows.flatMap((row) => (row.classId ? [{ ...row, classId: row.classId }] : []));
}

async function isDemoSchool(db: DatabaseExecutor, schoolId: string) {
  const [school] = await db.select({ isDemo: schoolTable.isDemo }).from(schoolTable).where(eq(schoolTable.id, schoolId)).limit(1);
  if (!school) throw rpcError.notFound('School');
  return school.isDemo;
}

async function lifecycleStatus(db: DatabaseExecutor, scope: ExamScope) {
  const [row] = await db.select({ status: examLifecycleTable.status }).from(examLifecycleTable).where(lifecycleWhere(scope)).limit(1);
  return row?.status ?? null;
}

/** The publication of an exam, or null. */
export async function getResultPublication(db: DatabaseExecutor, scope: ExamScope) {
  const [row] = await db
    .select()
    .from(examResultPublicationTable)
    .where(
      and(
        eq(examResultPublicationTable.schoolId, scope.schoolId),
        eq(examResultPublicationTable.sessionId, scope.sessionId),
        eq(examResultPublicationTable.examSlug, scope.examSlug),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * What releasing the exam to the Cadet Portal would notify (D-43): on a
 * first release, the per-channel forecast for its registered students; once
 * a release batch exists, nothing (`already_notified`). Read-only; whether
 * the release itself is allowed is decided by the release.
 */
export type ResultReleasePreview =
  | { kind: 'first_release'; forecast: DeliveryForecast }
  | { kind: 'already_notified'; notifiedAt: Date };

export async function previewResultRelease(db: DatabaseExecutor, scope: ExamScope): Promise<ResultReleasePreview> {
  await getExam(db, scope);
  const existing = await getResultPublication(db, scope);
  if (existing) return { kind: 'already_notified', notifiedAt: existing.publishedAt };
  const roster = await publicationRoster(db, scope);
  const recipients = await resolveAdmissionRecipients(db, scope.schoolId, roster.map((row) => row.admissionId));
  return { kind: 'first_release', forecast: forecastDeliveries('exam.results_published', await isDemoSchool(db, scope.schoolId), recipients) };
}

/**
 * Notifies the students of an exam's first Cadet release (see the module
 * comment). Runs inside the release's transaction, after the release write,
 * while that transaction holds the lifecycle row lock (`setExamCadetRelease`),
 * so concurrent releases serialize; the batch row is unique per exam besides.
 * Writes the batch row and one event per student, or nothing when a batch
 * already exists (a re-release after a withdraw) or no registered student is
 * addressed. Returns the event IDs for the caller to hand over after commit.
 */
export async function notifyFirstResultRelease(tx: DatabaseExecutor, scope: ExamScope, releasedBy: string): Promise<string[]> {
  if (await getResultPublication(tx, scope)) return [];
  const { exam } = await getExam(tx, scope);
  const roster = await publicationRoster(tx, scope);
  if (roster.length === 0) return [];
  const recipients = await resolveAdmissionRecipients(tx, scope.schoolId, roster.map((row) => row.admissionId));
  const forecast = forecastDeliveries('exam.results_published', await isDemoSchool(tx, scope.schoolId), recipients);
  const id = generateId('examResultPublication');
  await tx.insert(examResultPublicationTable).values({
    id,
    schoolId: scope.schoolId,
    sessionId: scope.sessionId,
    examSlug: scope.examSlug,
    examName: exam.name,
    publishedBy: releasedBy,
    admissionIds: roster.map((row) => row.admissionId),
    snapshot: forecast,
  });
  const inputs: NotifyInput<'exam.results_published'>[] = roster.map((student) => ({
    type: 'exam.results_published',
    schoolId: scope.schoolId,
    key: resultPublicationEventKey(id, student.admissionId),
    createdBy: releasedBy,
    sendPriority: 'bulk',
    batch: { kind: 'result_publication', id },
    recipients: { kind: 'admissions', admissionIds: [student.admissionId] },
    data: {
      sessionId: scope.sessionId,
      examSlug: scope.examSlug,
      examName: exam.name,
      admissionId: student.admissionId,
      studentId: student.studentId,
      classId: student.classId,
      studentName: student.name,
    },
  }));
  const results = await notifyMany(tx, inputs);
  return results.map((result) => result.eventId);
}

/** One student of an exam, as the single-send procedures address them. */
export type StudentResultScope = ExamScope & { classId: string; studentId: string };

/**
 * Resolves the enrollment (by its ID within the class, session and school)
 * to its admission, and checks the student's results qualify for sending:
 * the exam has started and the student's report card can be built (all
 * included subjects approved, registered). Sending results that could not
 * be printed would announce marks nobody approved.
 */
async function studentForResult(db: DatabaseExecutor, scope: StudentResultScope) {
  const { exam } = await getExam(db, scope);
  const status = await lifecycleStatus(db, scope);
  if (status === null || status === 'ready') throw rpcError.badRequest('Results can be sent once the examination has started.');
  const [student] = await db
    .select({ admissionId: admissionTable.id, name: admissionTable.name })
    .from(studentTable)
    .innerJoin(admissionTable, and(eq(admissionTable.id, studentTable.admissionId), eq(admissionTable.schoolId, studentTable.schoolId)))
    .where(
      and(
        eq(studentTable.id, scope.studentId),
        eq(studentTable.schoolId, scope.schoolId),
        eq(studentTable.sessionId, scope.sessionId),
        eq(studentTable.classId, scope.classId),
      ),
    )
    .limit(1);
  if (!student) throw rpcError.notFound('Student enrollment');
  await buildStudentReportCardContexts(db, scope.schoolId, { sessionId: scope.sessionId, examSlug: scope.examSlug, admissionId: student.admissionId });
  return { exam, student };
}

/** What sending one student's result would do now (read-only). */
export async function previewStudentResult(db: Database, scope: StudentResultScope): Promise<DeliveryForecast> {
  return db.transaction(
    async (tx) => {
      const { student } = await studentForResult(tx, scope);
      const recipients = await resolveAdmissionRecipients(tx, scope.schoolId, [student.admissionId]);
      return forecastDeliveries('exam.results_published', await isDemoSchool(tx, scope.schoolId), recipients);
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}

/**
 * Event key of one single-result send: a SHA-256 of the exam, student and
 * client idempotency key, so it stays within `notify()`'s 300-character
 * limit however long the exam slug and client key are.
 */
export function studentResultEventKey(scope: { sessionId: string; examSlug: string; idempotencyKey: string }, admissionId: string) {
  const digest = createHash('sha256').update(JSON.stringify([scope.sessionId, scope.examSlug, admissionId, scope.idempotencyKey])).digest('hex');
  return `exam-result:${digest}`;
}

/** Transaction attempts of a single send (a concurrent retry of the same press is a serialization failure). */
const SEND_RESULT_ATTEMPTS = 3;

/**
 * Sends one student's result. Each press is its own event, keyed by the
 * client's idempotency key, so a retried request sends once and a later
 * deliberate press sends again. Returns the forecast taken at press time.
 *
 * Repeatable read keeps the eligibility check, forecast and event facts on
 * one snapshot. A concurrent request with the same key that commits first
 * makes this transaction's insert a serialization failure (the row is not
 * in its snapshot); the whole transaction is then run again, and the new
 * snapshot finds the existing event and returns it.
 */
export async function sendStudentResult(db: Database, scope: StudentResultScope & { idempotencyKey: string }, sentBy: string) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await sendStudentResultOnce(db, scope, sentBy);
    } catch (error) {
      if (attempt >= SEND_RESULT_ATTEMPTS || !isRetryableTransactionError(error)) throw error;
    }
  }
}

async function sendStudentResultOnce(db: Database, scope: StudentResultScope & { idempotencyKey: string }, sentBy: string) {
  const { eventId, forecast, created } = await db.transaction(
    async (tx) => {
      const { exam, student } = await studentForResult(tx, scope);
      const recipients = await resolveAdmissionRecipients(tx, scope.schoolId, [student.admissionId]);
      const forecast = forecastDeliveries('exam.results_published', await isDemoSchool(tx, scope.schoolId), recipients);
      const result = await notify(tx, {
        type: 'exam.results_published',
        schoolId: scope.schoolId,
        key: studentResultEventKey(scope, student.admissionId),
        createdBy: sentBy,
        sendPriority: 'immediate',
        // A single send is the sender's own request: they hear if it fails (D-38).
        alertCreatorOnFailure: true,
        recipients: { kind: 'admissions', admissionIds: [student.admissionId] },
        data: { sessionId: scope.sessionId, examSlug: scope.examSlug, examName: exam.name, admissionId: student.admissionId, studentId: scope.studentId, classId: scope.classId, studentName: student.name },
      });
      return { ...result, forecast };
    },
    { isolationLevel: 'repeatable read' },
  );
  if (created) handOffNotificationEvents([eventId]);
  return { eventId, forecast };
}

/**
 * A publication with deliveries still open after this long is settled
 * anyway: beyond the longest WhatsApp retry path (a day-later retry on each
 * of three days for a reached daily limit, D-41) plus margin.
 */
const SETTLE_DEADLINE_MS = 4 * 24 * 60 * 60 * 1000;
const KEY_CHUNK = 1000;

/**
 * The settled WhatsApp outcome of a publication, or null while it is still
 * in progress. Settled when every student's event was fanned out or failed
 * for good, and no WhatsApp delivery is still owed or freshly claimed; or
 * once {@link SETTLE_DEADLINE_MS} passed regardless. Counts are per
 * student (each has exactly one WhatsApp delivery row): `sent` includes
 * delivered/read, `skipped` the skipped copies, and `failed` everything
 * else (failed sends, failed fan-outs, unresolved claims).
 */
export async function settleResultPublication(
  db: DatabaseExecutor,
  publication: Pick<ExamResultPublicationRow, 'id' | 'schoolId' | 'admissionIds' | 'publishedAt'>,
  now: Date = new Date(),
): Promise<ResultPublicationOutcome | null> {
  const overdue = now.getTime() - publication.publishedAt.getTime() > SETTLE_DEADLINE_MS;
  const keys = publication.admissionIds.map((admissionId) => resultPublicationEventKey(publication.id, admissionId));
  const events: { id: string; status: string; failureRetryable: boolean | null; dispatchAttempt: number }[] = [];
  for (let start = 0; start < keys.length; start += KEY_CHUNK) {
    events.push(
      ...(await db
        .select({
          id: notificationEventTable.id,
          status: notificationEventTable.status,
          failureRetryable: notificationEventTable.failureRetryable,
          dispatchAttempt: notificationEventTable.dispatchAttempt,
        })
        .from(notificationEventTable)
        .where(and(eq(notificationEventTable.schoolId, publication.schoolId), inArray(notificationEventTable.key, keys.slice(start, start + KEY_CHUNK))))),
    );
  }
  const eventOpen = events.some(
    (event) => event.status === 'pending' || (event.status === 'failed' && event.failureRetryable === true && event.dispatchAttempt < MAX_NOTIFICATION_DISPATCH_ATTEMPTS),
  );
  if (eventOpen && !overdue) return null;
  const deliveries: { status: string; claimedAt: Date | null }[] = [];
  const eventIds = events.map((event) => event.id);
  for (let start = 0; start < eventIds.length; start += KEY_CHUNK) {
    deliveries.push(
      ...(await db
        .select({ status: notificationDeliveryTable.status, claimedAt: notificationDeliveryTable.claimedAt })
        .from(notificationDeliveryTable)
        .innerJoin(notificationTable, eq(notificationTable.id, notificationDeliveryTable.notificationId))
        .where(
          and(
            inArray(notificationTable.eventId, eventIds.slice(start, start + KEY_CHUNK)),
            eq(notificationDeliveryTable.channel, 'whatsapp'),
            // First copies only: a staff resend is a later, separate attempt.
            isNull(notificationDeliveryTable.resendOfDeliveryId),
          ),
        )),
    );
  }
  const deliveryOpen = deliveries.some(
    (delivery) => delivery.status === 'owed' || (delivery.status === 'sending' && (delivery.claimedAt?.getTime() ?? 0) > stuckSendingCutoff(now).getTime()),
  );
  if (deliveryOpen && !overdue) return null;
  const recipientCount = publication.admissionIds.length;
  const sentCount = deliveries.filter((delivery) => ['sent', 'delivered', 'read'].includes(delivery.status)).length;
  const skippedCount = deliveries.filter((delivery) => delivery.status === 'skipped').length;
  return { recipientCount, sentCount, skippedCount, failedCount: Math.max(0, recipientCount - sentCount - skippedCount) };
}

/**
 * Students of a publication whose inbox row exists: the in-app copy every
 * fanned-out student gets, whatever WhatsApp did (counted from the rows,
 * not assumed from the recipient count).
 */
async function publicationInboxCount(db: DatabaseExecutor, publication: Pick<ExamResultPublicationRow, 'id' | 'schoolId' | 'admissionIds'>) {
  const keys = publication.admissionIds.map((admissionId) => resultPublicationEventKey(publication.id, admissionId));
  let total = 0;
  for (let start = 0; start < keys.length; start += KEY_CHUNK) {
    const [row] = await db
      .select({ value: count() })
      .from(notificationTable)
      .innerJoin(notificationEventTable, eq(notificationEventTable.id, notificationTable.eventId))
      .where(and(eq(notificationEventTable.schoolId, publication.schoolId), inArray(notificationEventTable.key, keys.slice(start, start + KEY_CHUNK))));
    total += row?.value ?? 0;
  }
  return total;
}

/**
 * Checks one publication (recording the check for the sweep's rotation) and
 * finishes it when settled. Returns undefined when it is not finished by
 * this call, else the publisher's event ID (null without a publisher).
 */
async function finishResultPublicationIfSettled(db: Database, publication: ExamResultPublicationRow, now: Date): Promise<string | null | undefined> {
  await db.update(examResultPublicationTable).set({ settleCheckedAt: now }).where(eq(examResultPublicationTable.id, publication.id));
  const outcome = await settleResultPublication(db, publication, now);
  if (!outcome) return undefined;
  const eventId = await db.transaction(async (tx) => {
    const [finished] = await tx
      .update(examResultPublicationTable)
      .set({ finishedAt: now, outcome })
      .where(and(eq(examResultPublicationTable.id, publication.id), isNull(examResultPublicationTable.finishedAt)))
      .returning({ id: examResultPublicationTable.id });
    if (!finished) return undefined;
    if (!publication.publishedBy) return null;
    const inAppCount = await publicationInboxCount(tx, publication);
    const result = await notify(tx, {
      type: 'exam.results_publish_finished',
      schoolId: publication.schoolId,
      key: `exam-results-finished:${publication.id}`,
      sendPriority: 'immediate',
      recipients: { kind: 'staff_users', userIds: [publication.publishedBy] },
      data: { sessionId: publication.sessionId, examSlug: publication.examSlug, examName: publication.examName, ...outcome, inAppCount },
    });
    return result.eventId;
  });
  if (eventId !== undefined) log.info({ publicationId: publication.id, ...outcome }, 'notification.results.finished');
  return eventId;
}

/** Unfinished publications checked per sweep. */
const PUBLICATION_SWEEP_LIMIT = 20;

/**
 * Finishes publications whose deliveries settled (on the API's 30 s loop),
 * least recently checked first (`settle_checked_at`, set on every check), so
 * publications still waiting for retries rotate to the back instead of
 * filling every sweep and starving newer ones:
 * records the outcome and, in the same transaction, notifies the publisher
 * with `exam.results_publish_finished` (D-30). Conditional on the row still
 * being unfinished, so replicas finish each publication once; the event key
 * `exam-results-finished:<id>` deduplicates besides. A publisher whose
 * account was deleted gets nothing; the outcome is still recorded.
 */
export async function sweepResultPublications(db: Database = defaultDb, now: Date = new Date()) {
  const open = await db
    .select()
    .from(examResultPublicationTable)
    .where(and(isNull(examResultPublicationTable.finishedAt), lt(examResultPublicationTable.publishedAt, now)))
    .orderBy(sql`${examResultPublicationTable.settleCheckedAt} asc nulls first`, asc(examResultPublicationTable.publishedAt))
    .limit(PUBLICATION_SWEEP_LIMIT);
  const eventIds: string[] = [];
  let finishedCount = 0;
  for (const publication of open) {
    // One publication failing (e.g. a lost connection) never stops the others.
    try {
      const eventId = await finishResultPublicationIfSettled(db, publication, now);
      if (eventId === undefined) continue;
      finishedCount += 1;
      if (eventId) eventIds.push(eventId);
    } catch (error) {
      log.error({ publicationId: publication.id, err: error instanceof Error ? { name: error.name, message: error.message } : String(error) }, 'notification.results.settle.error');
    }
  }
  handOffNotificationEvents(eventIds);
  return { finished: finishedCount };
}
