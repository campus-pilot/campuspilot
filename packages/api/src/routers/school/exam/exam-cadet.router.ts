import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';

import { toRpcError } from '../../../errors';
import { protectedProcedure } from '../../../index';
import { requireSchoolPermission } from '../../../permissions/school';
import * as dto from './exam.dto';
import {
  getStudentExamRemark,
  saveStudentExamRemark,
  setExamCadetRelease,
} from './exam-cadet.service';
import { route } from './exam.pagination';
import { handOffNotificationEvents } from '../../../notifications/notification.outbox';
import { notifyFirstResultRelease, previewResultRelease } from '../../../notifications/emitters/results';
import { resultReleasePreviewSchema } from './exam-result-notification.dto';

/**
 * Staff controls for what the Cadet Portal shows of an examination: the
 * explicit release of its results and per-student teacher remarks. Release
 * and withdrawal are lifecycle governance, so they reuse the exam transition
 * permission; remarks reuse result entry permissions. The first release also
 * notifies the students (D-43) without any further permission.
 */
export const schoolExamCadetRouter = {
  releaseExamToCadet: protectedProcedure
    .route(
      route(
        'Release examination results to the Cadet Portal',
        'Make a completed examination’s results, remarks and co-scholastic grades visible to its students in the Cadet Portal. Records who released it and when. Reopening is refused while released. The first release also notifies every registered student (inbox, web push, WhatsApp); a re-release after a withdraw notifies nobody again.',
      ),
    )
    .meta({
      mcp: {
        exposure: 'advanced',
        access: 'write',
        destructive: true,
        module: 'exams',
      },
    })
    .input(dto.examScopeSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.TRANSITION_EXAM_PLAN))
    .output(dto.examOverviewSchema)
    .handler(async ({ context, input }) => {
      try {
        const userId = context.session.user.id;
        // The release and its first-release notification commit together.
        const { overview, eventIds } = await context.db.transaction(async (tx) => {
          const overview = await setExamCadetRelease(tx, input, { userId });
          return { overview, eventIds: await notifyFirstResultRelease(tx, input, userId) };
        });
        handOffNotificationEvents(eventIds);
        return overview;
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  previewExamCadetRelease: protectedProcedure
    .route(
      route(
        'Preview releasing examination results to the Cadet Portal',
        'Say what releasing the examination would notify: on its first release, the registered students addressed and, per channel, the copies owed and skipped by reason; after an earlier release, that nobody is notified again. Writes nothing.',
      ),
    )
    .meta({
      mcp: {
        exposure: 'advanced',
        access: 'read',
        destructive: false,
        module: 'exams',
      },
    })
    .input(dto.examScopeSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.TRANSITION_EXAM_PLAN))
    .output(resultReleasePreviewSchema)
    .handler(async ({ context, input }) => {
      try {
        return await previewResultRelease(context.db, input);
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  withdrawExamFromCadet: protectedProcedure
    .route(
      route(
        'Withdraw examination results from the Cadet Portal',
        'Hide a released examination from students in the Cadet Portal again. Saved results and remarks are unchanged.',
      ),
    )
    .meta({
      mcp: {
        exposure: 'advanced',
        access: 'write',
        destructive: true,
        module: 'exams',
      },
    })
    .input(dto.examScopeSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.TRANSITION_EXAM_PLAN))
    .output(dto.examOverviewSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction((tx) =>
          setExamCadetRelease(tx, input, null),
        );
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  getStudentExamRemark: protectedProcedure
    .route(
      route(
        'Get a student’s examination remark',
        'Read the teacher remark written for one registered student in one class examination, with its author and timestamps, or null when none is written.',
      ),
    )
    .meta({
      mcp: {
        exposure: 'advanced',
        access: 'read',
        destructive: false,
        module: 'exams',
      },
    })
    .input(dto.examStudentScopeSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_EXAM_RESULTS))
    .output(dto.studentExamRemarkSchema.nullable())
    .handler(async ({ context, input }) => {
      try {
        return await getStudentExamRemark(context.db, input);
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  saveStudentExamRemark: protectedProcedure
    .route(
      route(
        'Save a student’s examination remark',
        'Write, replace or (with blank text) remove the teacher remark for one student’s examination. Allowed once the examination has started, in the active session, and only while its results are not released to the Cadet Portal.',
      ),
    )
    .meta({
      mcp: {
        exposure: 'advanced',
        access: 'write',
        destructive: true,
        module: 'exams',
      },
    })
    .input(dto.saveStudentExamRemarkInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.WRITE_EXAM_RESULTS))
    .output(dto.studentExamRemarkSchema.nullable())
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction((tx) =>
          saveStudentExamRemark(tx, input, context.session.user.id),
        );
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
