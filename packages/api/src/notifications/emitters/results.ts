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
import { and, asc, eq, inArray, isNull, lt } from 'drizzle-orm';

import { rpcError } from '../../errors';
import { getExam, type ExamScope } from '../../routers/school/exam/exam.service';
import { lifecycleWhere } from '../../routers/school/exam/exam.scope';
import { forecastDeliveries, resolveAdmissionRecipients, type DeliveryForecast } from '../dispatch';
import { buildStudentReportCardContexts } from '../documents/report-card';
import { handOffNotificationEvents } from '../notification.outbox';
import { notify, notifyMany, type NotifyInput } from '../notify';
import { MAX_NOTIFICATION_DISPATCH_ATTEMPTS } from '../../workflows/notification/constants';
import { log } from '../../workflows/notification/log';

/**
 * Result notifications (Phase 6, D-10, D-26, D-30):
 * - **Publish**: once per examination, only while it is completed, every
 *   registered student of the examination's classes gets one
 *   `exam.results_published`. The recipients are resolved and their
 *   per-channel forecast computed when staff press the button, stored on the
 *   `exam_result_publication` row and returned.
 * - **Single send**: one student's result for any started exam at any time
 *   (not tied to publication), as often as staff choose; each press is its
 *   own event (client idempotency key).
 * - **Finished**: once every delivery of a publication settled, the
 *   publisher gets `exam.results_publish_finished` ({@link sweepResultPublications}).
 * Delivery is the ordinary durable, bounded fan-out (retries with backoff).
 */

/** Event key of one student's copy of a publication. */
export const resultPublicationEventKey = (publicationId: string, admissionId: string) =>
  `exam-results:${publicationId}:${admissionId}`;

/** Registered students of the exam's classes, by admission (one enrollment per session). */
async function publicationRoster(db: DatabaseExecutor, scope: ExamScope) {
  const classIds = db
    .selectDistinct({ classId: examPlanTable.classId })
    .from(examPlanTable)
    .where(and(eq(examPlanTable.schoolId, scope.schoolId), eq(examPlanTable.sessionId, scope.sessionId), eq(examPlanTable.examSlug, scope.examSlug)));
  return db
    .select({ admissionId: admissionTable.id, name: admissionTable.name })
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
}

async function isDemoSchool(db: DatabaseExecutor, schoolId: string) {
  const [school] = await db.select({ isDemo: schoolTable.isDemo }).from(schoolTable).where(eq(schoolTable.id, schoolId)).limit(1);
  if (!school) throw rpcError.notFound('School');
  return school.isDemo;
}

async function lifecycleStatus(db: DatabaseExecutor, scope: ExamScope, lock: boolean) {
  const query = db.select({ status: examLifecycleTable.status }).from(examLifecycleTable).where(lifecycleWhere(scope)).limit(1);
  const [row] = await (lock ? query.for('update') : query);
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

function requirePublishable(status: string | null, existing: ExamResultPublicationRow | null) {
  if (existing) throw rpcError.conflict('The results of this examination were already published.');
  if (status !== 'completed') throw rpcError.badRequest('Only a completed examination can publish its results.');
}

/**
 * What publishing would do now: the students it would address and the
 * per-channel forecast. Read-only; refuses when publishing is not allowed.
 */
export async function previewResultPublication(db: DatabaseExecutor, scope: ExamScope): Promise<DeliveryForecast> {
  await getExam(db, scope);
  requirePublishable(await lifecycleStatus(db, scope, false), await getResultPublication(db, scope));
  const roster = await publicationRoster(db, scope);
  const recipients = await resolveAdmissionRecipients(db, scope.schoolId, roster.map((row) => row.admissionId));
  return forecastDeliveries('exam.results_published', await isDemoSchool(db, scope.schoolId), recipients);
}

/**
 * Publishes an exam's results (see the module comment). One transaction:
 * the exam lifecycle row is locked so the exam cannot be reopened in
 * between, the publication row is written (unique per exam, a concurrent
 * second press fails with CONFLICT) and one event per student is emitted.
 * Events are handed over after commit.
 */
export async function publishResults(db: Database, scope: ExamScope, publishedBy: string) {
  const { publication, eventIds } = await db.transaction(async (tx) => {
    // No session lock: results of a historical session's exam may be published too.
    // The lifecycle row lock below keeps the exam from being reopened meanwhile.
    const { exam } = await getExam(tx, scope);
    const status = await lifecycleStatus(tx, scope, true);
    requirePublishable(status, await getResultPublication(tx, scope));
    const roster = await publicationRoster(tx, scope);
    if (roster.length === 0) throw rpcError.badRequest('This examination has no registered students to publish results to.');
    const recipients = await resolveAdmissionRecipients(tx, scope.schoolId, roster.map((row) => row.admissionId));
    const forecast = forecastDeliveries('exam.results_published', await isDemoSchool(tx, scope.schoolId), recipients);
    const id = generateId('examResultPublication');
    const [publication] = await tx
      .insert(examResultPublicationTable)
      .values({
        id,
        schoolId: scope.schoolId,
        sessionId: scope.sessionId,
        examSlug: scope.examSlug,
        examName: exam.name,
        publishedBy,
        admissionIds: roster.map((row) => row.admissionId),
        snapshot: forecast,
      })
      .returning();
    const inputs: NotifyInput<'exam.results_published'>[] = roster.map((student) => ({
      type: 'exam.results_published',
      schoolId: scope.schoolId,
      key: resultPublicationEventKey(id, student.admissionId),
      createdBy: publishedBy,
      recipients: { kind: 'admissions', admissionIds: [student.admissionId] },
      data: { sessionId: scope.sessionId, examSlug: scope.examSlug, examName: exam.name, admissionId: student.admissionId, studentName: student.name },
    }));
    const results = await notifyMany(tx, inputs);
    return { publication: publication!, eventIds: results.map((result) => result.eventId) };
  });
  handOffNotificationEvents(eventIds);
  return publication;
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
  const status = await lifecycleStatus(db, scope, false);
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
 * Sends one student's result. Each press is its own event, keyed by the
 * client's idempotency key, so a retried request sends once and a later
 * deliberate press sends again. Returns the forecast taken at press time.
 */
export async function sendStudentResult(db: Database, scope: StudentResultScope & { idempotencyKey: string }, sentBy: string) {
  const { eventId, forecast, created } = await db.transaction(
    async (tx) => {
      const { exam, student } = await studentForResult(tx, scope);
      const recipients = await resolveAdmissionRecipients(tx, scope.schoolId, [student.admissionId]);
      const forecast = forecastDeliveries('exam.results_published', await isDemoSchool(tx, scope.schoolId), recipients);
      const result = await notify(tx, {
        type: 'exam.results_published',
        schoolId: scope.schoolId,
        key: `exam-result:${scope.sessionId}:${scope.examSlug}:${student.admissionId}:${scope.idempotencyKey}`,
        createdBy: sentBy,
        recipients: { kind: 'admissions', admissionIds: [student.admissionId] },
        data: { sessionId: scope.sessionId, examSlug: scope.examSlug, examName: exam.name, admissionId: student.admissionId, studentName: student.name },
      });
      return { ...result, forecast };
    },
    { isolationLevel: 'repeatable read' },
  );
  if (created) handOffNotificationEvents([eventId]);
  return { eventId, forecast };
}

/** A publication with deliveries still open after this long is settled anyway (beyond the ~18 h retry window). */
const SETTLE_DEADLINE_MS = 48 * 60 * 60 * 1000;
/** A delivery claimed this long ago without an outcome is counted as failed (the worker died mid-send). */
const STUCK_SENDING_MS = 60 * 60 * 1000;
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
        .where(and(inArray(notificationTable.eventId, eventIds.slice(start, start + KEY_CHUNK)), eq(notificationDeliveryTable.channel, 'whatsapp')))),
    );
  }
  const deliveryOpen = deliveries.some(
    (delivery) => delivery.status === 'owed' || (delivery.status === 'sending' && (delivery.claimedAt?.getTime() ?? 0) > now.getTime() - STUCK_SENDING_MS),
  );
  if (deliveryOpen && !overdue) return null;
  const recipientCount = publication.admissionIds.length;
  const sentCount = deliveries.filter((delivery) => ['sent', 'delivered', 'read'].includes(delivery.status)).length;
  const skippedCount = deliveries.filter((delivery) => delivery.status === 'skipped').length;
  return { recipientCount, sentCount, skippedCount, failedCount: Math.max(0, recipientCount - sentCount - skippedCount) };
}

/** Unfinished publications checked per sweep. */
const PUBLICATION_SWEEP_LIMIT = 20;

/**
 * Finishes publications whose deliveries settled (on the API's 30 s loop):
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
    .orderBy(asc(examResultPublicationTable.publishedAt))
    .limit(PUBLICATION_SWEEP_LIMIT);
  const eventIds: string[] = [];
  let finishedCount = 0;
  for (const publication of open) {
    const outcome = await settleResultPublication(db, publication, now);
    if (!outcome) continue;
    const eventId = await db.transaction(async (tx) => {
      const [finished] = await tx
        .update(examResultPublicationTable)
        .set({ finishedAt: now, outcome })
        .where(and(eq(examResultPublicationTable.id, publication.id), isNull(examResultPublicationTable.finishedAt)))
        .returning({ id: examResultPublicationTable.id });
      if (!finished) return null;
      finishedCount += 1;
      if (!publication.publishedBy) return null;
      const result = await notify(tx, {
        type: 'exam.results_publish_finished',
        schoolId: publication.schoolId,
        key: `exam-results-finished:${publication.id}`,
        recipients: { kind: 'staff_users', userIds: [publication.publishedBy] },
        data: { sessionId: publication.sessionId, examSlug: publication.examSlug, examName: publication.examName, ...outcome },
      });
      return result.eventId;
    });
    if (eventId) eventIds.push(eventId);
    log.info({ publicationId: publication.id, ...outcome }, 'notification.results.finished');
  }
  handOffNotificationEvents(eventIds);
  return { finished: finishedCount };
}
