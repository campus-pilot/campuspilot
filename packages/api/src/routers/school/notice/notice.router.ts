import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';
import { z } from 'zod';

import type { Context } from '../../../context';
import { rpcError, toRpcError } from '../../../errors';
import { protectedProcedure } from '../../../index';
import { assertPermission, checkPermissions } from '../../../permissions/authorization';
import { requireSchoolFeature } from '../../../permissions/feature';
import { requireSchoolPermission } from '../../../permissions/school';
import { noticePublishPreviewSchema } from './notice-delivery.dto';
import {
  createNoticeInputSchema,
  listNoticesInputSchema,
  listNoticesOutputSchema,
  noticeDownloadOutputSchema,
  noticeDtoSchema,
  noticePreviewOutputSchema,
  noticeScopeInputSchema,
  publishNoticeInputSchema,
  previewNoticeInputSchema,
  updateNoticeInputSchema,
} from './notice.dto';
import {
  createNotice,
  deleteNotice,
  getNotice,
  getNoticeDownload,
  listNotices,
  previewNotice,
  previewNoticePublish,
  publishNotice,
  updateNotice,
  type NoticeViewer,
} from './notice.service';

const route = (summary: string, description: string) => ({ summary, description, tags: ['School', 'Notices'] });
/**
 * Every notice tool is `advanced`: the core listing is a fixed, tested budget
 * (36 tools), and notices are reached through the meta tools like the other
 * communication tools.
 */
const meta = (access: 'read' | 'write', destructive: boolean) =>
  ({ mcp: { exposure: 'advanced', access, destructive, module: 'notices' } }) as const;

/**
 * Who is asking: their account and whether OPA grants them
 * `school.notice.publish` in this school. That grant, not a role, decides
 * whether they see and manage other people's drafts.
 */
async function noticeViewer(context: Context, schoolId: string, signal?: AbortSignal): Promise<NoticeViewer> {
  const userId = context.session?.user.id;
  if (!userId) throw rpcError.unauthorized();
  const [canPublish] = await checkPermissions(context, [{ action: SCHOOL_ACTIONS.PUBLISH_NOTICE, resource: { kind: 'school', schoolId } }], signal);
  return { userId, canPublish: canPublish === true };
}

/**
 * School notices (decisions D4-D9). Every procedure checks its permission
 * first and then the school's `notices` feature, so a caller without access
 * cannot probe whether a school has notices. Addressing students also needs
 * the school's `cadet` feature, checked when a draft is saved and again when
 * it is published.
 */
export const schoolNoticeRouter = {
  listNotices: protectedProcedure
    .route(route('List notices', "Page through one academic session's notices: every published notice plus the caller's own drafts (every draft for someone who may publish). Searchable by title, filterable by status and audience."))
    .meta(meta('read', false))
    .input(listNoticesInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_NOTICE))
    .use(requireSchoolFeature('notices'))
    .output(listNoticesOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        return await listNotices(context.db, input, await noticeViewer(context, input.schoolId, signal));
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getNotice: protectedProcedure
    .route(route('Get a notice', 'Read one notice with its text, audience, author and publication facts. A draft is visible only to its author and to staff who may publish.'))
    .meta(meta('read', false))
    .input(noticeScopeInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_NOTICE))
    .use(requireSchoolFeature('notices'))
    .output(noticeDtoSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        return await getNotice(context.db, input, await noticeViewer(context, input.schoolId, signal));
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  createNotice: protectedProcedure
    .route(route('Create a notice draft', 'Save a new draft notice for one academic session with its title, text (plain text or a complete Handlebars document) and audience (staff, students of every class, or students of chosen classes). Nothing is sent until it is published.'))
    .meta(meta('write', false))
    .input(createNoticeInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.DRAFT_NOTICE))
    .use(requireSchoolFeature('notices'))
    .output(noticeDtoSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        return await createNotice(context.db, input, await noticeViewer(context, input.schoolId, signal));
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  updateNotice: protectedProcedure
    .route(route('Update a notice draft', "Replace a draft's title, text and audience. Authors change their own drafts; staff who may publish change any draft. A published notice cannot be changed."))
    .meta(meta('write', true))
    .input(updateNoticeInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.DRAFT_NOTICE))
    .use(requireSchoolFeature('notices'))
    .output(noticeDtoSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        return await updateNotice(context.db, input, await noticeViewer(context, input.schoolId, signal));
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  deleteNotice: protectedProcedure
    .route(route('Delete a notice draft', 'Delete a draft. Authors delete their own drafts; staff who may publish delete any draft. A published notice cannot be deleted.'))
    .meta(meta('write', true))
    .input(noticeScopeInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.DRAFT_NOTICE))
    .use(requireSchoolFeature('notices'))
    .output(z.object({ deleted: z.literal(true) }))
    .handler(async ({ context, input, signal }) => {
      try {
        await deleteNotice(context.db, input, await noticeViewer(context, input.schoolId, signal));
        return { deleted: true as const };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  previewNotice: protectedProcedure
    .route(route('Preview a notice', "Render a saved notice, or unsaved title and text, to sanitized network-free HTML with the school's letterhead, and say which notice version and school Notice template revision were rendered. A published notice renders exactly as published. Saves nothing."))
    .meta(meta('read', false))
    .input(previewNoticeInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_NOTICE))
    .use(requireSchoolFeature('notices'))
    .output(noticePreviewOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        // Rendering unsaved content is part of writing a draft.
        if (input.source.kind === 'unsaved') {
          await assertPermission(context, { action: SCHOOL_ACTIONS.DRAFT_NOTICE, resource: { kind: 'school', schoolId: input.schoolId } }, signal);
        }
        return await previewNotice(context.db, input, await noticeViewer(context, input.schoolId, signal));
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  previewNoticePublish: protectedProcedure
    .route(route('Preview publishing a notice', 'Say whom publishing a draft would notify: the school members who get the in-app notification and, for students, the number addressed with the copies owed and skipped by reason on device notifications and WhatsApp. Writes nothing.'))
    .meta(meta('read', false))
    .input(noticeScopeInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.PUBLISH_NOTICE))
    .use(requireSchoolFeature('notices'))
    .output(noticePublishPreviewSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        return await previewNoticePublish(context.db, input, await noticeViewer(context, input.schoolId, signal));
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  publishNotice: protectedProcedure
    .route(route('Publish a notice', 'Publish a draft, once and irreversibly: it becomes visible to its audience, can no longer be changed, and its recipients are notified (staff in the app; students in the Cadet Portal, by device notification and by WhatsApp with the notice PDF). Send expectedVersion and expectedTemplateRevisionId, the version and template revision of the preview you reviewed (previewNotice or previewNoticePublish): a notice edited since, a school Notice template replaced since, or a notice already published is refused with CONFLICT.'))
    .meta(meta('write', true))
    .input(publishNoticeInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.PUBLISH_NOTICE))
    .use(requireSchoolFeature('notices'))
    .output(noticeDtoSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        return await publishNotice(context.db, input, await noticeViewer(context, input.schoolId, signal));
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getNoticeDownload: protectedProcedure
    .route(route('Download a notice as PDF', "Issue a five-minute download URL for a published notice's PDF. Drafts have no PDF."))
    .meta(meta('read', false))
    .input(noticeScopeInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_NOTICE))
    .use(requireSchoolFeature('notices'))
    .output(noticeDownloadOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        return await getNoticeDownload(context.db, input, await noticeViewer(context, input.schoolId, signal));
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
