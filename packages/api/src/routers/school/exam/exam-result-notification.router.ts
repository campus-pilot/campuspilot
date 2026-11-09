import { CLASS_ACTIONS } from '@campuspilot/opa/policies/class';
import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';
import { z } from 'zod';

import { toRpcError } from '../../../errors';
import { protectedProcedure } from '../../../index';
import {
  getResultPublication,
  previewResultPublication,
  previewStudentResult,
  publishResults,
  sendStudentResult,
} from '../../../notifications/emitters/results';
import { requireClassPermission } from '../../../permissions/class';
import { requireSchoolPermission } from '../../../permissions/school';
import { route } from './exam.pagination';
import * as dto from './exam-result-notification.dto';

function publicationDto(row: NonNullable<Awaited<ReturnType<typeof getResultPublication>>>) {
  return {
    id: row.id,
    examName: row.examName,
    publishedAt: row.publishedAt,
    publishedBy: row.publishedBy,
    snapshot: dto.deliveryForecastSchema.parse(row.snapshot),
    finishedAt: row.finishedAt,
    outcome: row.outcome ?? null,
  };
}

/**
 * Result notifications (D-10, D-26, D-35). Publishing is school-wide
 * (`school.notification.send`); sending one student's result is
 * class-scoped (`class.notification.result.send`), so a teacher may send
 * only for assigned classes. Both also need exam/result read access.
 */
export const schoolExamResultNotificationRouter = {
  getExamResultPublication: protectedProcedure
    .route(route('Get an examination results publication', 'Read whether and when the results of an examination were published to its students, the per-channel forecast taken at that moment, and the settled WhatsApp outcome once every delivery finished. Null when not published.'))
    .meta({ mcp: { exposure: 'advanced', access: 'read', destructive: false, module: 'exams' } })
    .input(dto.examResultPublicationInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_EXAMS))
    .output(dto.resultPublicationSchema.nullable())
    .handler(async ({ context, input }) => {
      try {
        const row = await getResultPublication(context.db, input);
        return row ? publicationDto(row) : null;
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  previewExamResultPublication: protectedProcedure
    .route(route('Preview publishing examination results', 'Count the registered students a publication would address now and, per channel, the copies owed and skipped by reason. Only for a completed, not yet published examination. Writes nothing.'))
    .meta({ mcp: { exposure: 'advanced', access: 'read', destructive: false, module: 'exams' } })
    .input(dto.examResultPublicationInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_EXAM_RESULTS))
    .use(requireSchoolPermission(SCHOOL_ACTIONS.SEND_NOTIFICATIONS))
    .output(dto.deliveryForecastSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction((tx) => previewResultPublication(tx, input), { isolationLevel: 'repeatable read', accessMode: 'read only' });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  publishExamResults: protectedProcedure
    .route(route('Publish examination results', 'Once per completed examination, notify every registered student of its classes (in-app, device push and WhatsApp with the report card where allowed). Recipients and the per-channel forecast are snapshotted and returned. Reopening the examination later retracts nothing.'))
    .meta({ mcp: { exposure: 'advanced', access: 'write', destructive: false, module: 'exams' } })
    .input(dto.examResultPublicationInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_EXAM_RESULTS))
    .use(requireSchoolPermission(SCHOOL_ACTIONS.SEND_NOTIFICATIONS))
    .output(dto.resultPublicationSchema)
    .handler(async ({ context, input }) => {
      try {
        return publicationDto(await publishResults(context.db, input, context.session.user.id));
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  previewStudentResultNotification: protectedProcedure
    .route(route("Preview sending one student's result", "Check that the student's results can be sent (examination started, every subject approved) and count the copies per channel that would be owed or skipped. Writes nothing."))
    .meta({ mcp: { exposure: 'advanced', access: 'read', destructive: false, module: 'exams' } })
    .input(dto.studentResultNotificationInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_EXAM_RESULTS))
    .use(requireClassPermission(CLASS_ACTIONS.SEND_RESULT_NOTIFICATION))
    .output(dto.deliveryForecastSchema)
    .handler(async ({ context, input }) => {
      try {
        return await previewStudentResult(context.db, input);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  sendStudentResultNotification: protectedProcedure
    .route(route("Send one student's result", "Notify one student (and guardian on WhatsApp, with the report card where allowed) of an examination's results, for any started examination and independently of publication. Each new idempotency key sends again; retries with the same key send once."))
    .meta({ mcp: { exposure: 'advanced', access: 'write', destructive: false, module: 'exams' } })
    .input(dto.sendStudentResultNotificationInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_EXAM_RESULTS))
    .use(requireClassPermission(CLASS_ACTIONS.SEND_RESULT_NOTIFICATION))
    .output(z.object({ forecast: dto.deliveryForecastSchema }))
    .handler(async ({ context, input }) => {
      try {
        const { forecast } = await sendStudentResult(context.db, input, context.session.user.id);
        return { forecast };
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
