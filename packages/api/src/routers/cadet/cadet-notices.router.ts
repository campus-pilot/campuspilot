import { cadetProcedure } from '../../cadet/procedure';
import type { CadetContext } from '../../cadet/context';
import { toRpcError } from '../../errors';
import { assertSchoolFeatureEnabled } from '../../feature-flags/feature-flags.service';
import {
  cadetNoticeDownloadSchema,
  cadetNoticeSchema,
  getCadetNoticeInputSchema,
  listCadetNoticesInputSchema,
  listCadetNoticesOutputSchema,
} from './cadet.dto';
import { getCadetNotice, getCadetNoticeDownload, listCadetNotices } from './cadet-notices.service';

const route = (summary: string, description: string) => ({ summary, description, tags: ['Cadet'] });

/**
 * `cadetProcedure` has already required the school's `cadet` feature; the
 * notice procedures also need its `notices` feature. Switching notices off
 * hides them from students at once, with the same disabled-feature error
 * (`feature: 'notices'`) the staff procedures give.
 */
function assertNoticesEnabled(context: Pick<CadetContext, 'db'>, schoolId: string) {
  return assertSchoolFeatureEnabled(context.db, schoolId, 'notices');
}

/**
 * The signed-in student's notices. As everywhere in the Cadet Portal, the
 * school and admission come from the login, never from input; a notice id
 * is looked up only among the notices addressed to that student
 * (`cadet-notices.service.ts`), so anything else is NOT_FOUND.
 */
export const cadetNoticesRouter = {
  listNotices: cadetProcedure
    .route(route('List my notices', "The school's published notices addressed to the signed-in student (the whole session or the student's class), newest first."))
    .meta({ mcp: { exposure: 'core', access: 'read', destructive: false, module: 'notices' } })
    .input(listCadetNoticesInputSchema)
    .output(listCadetNoticesOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        await assertNoticesEnabled(context, context.cadet.schoolId);
        return await listCadetNotices(context.db, context.cadet, input);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getNotice: cadetProcedure
    .route(route('Get a notice', 'One notice addressed to the signed-in student: its title, publication time, plain text when it was written as text, and the rendered notice.'))
    .meta({ mcp: { exposure: 'core', access: 'read', destructive: false, module: 'notices' } })
    .input(getCadetNoticeInputSchema)
    .output(cadetNoticeSchema)
    .handler(async ({ context, input }) => {
      try {
        await assertNoticesEnabled(context, context.cadet.schoolId);
        return await getCadetNotice(context.db, context.cadet, input.noticeId);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getNoticeDownload: cadetProcedure
    .route(route('Download a notice as PDF', 'Issue a five-minute download URL for the PDF of a notice addressed to the signed-in student.'))
    // Hidden from the cadet MCP: a signed URL has no agent value (`getNotice`
    // carries the text). `read`: it changes no record; the first call may
    // store the notice's cached PDF, a derived copy of an immutable notice.
    .meta({ mcp: { exposure: 'hidden', access: 'read', destructive: false, module: 'notices' } })
    .input(getCadetNoticeInputSchema)
    .output(cadetNoticeDownloadSchema)
    .handler(async ({ context, input }) => {
      try {
        await assertNoticesEnabled(context, context.cadet.schoolId);
        return await getCadetNoticeDownload(context.db, context.cadet, input.noticeId);
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
