import { cadetProcedure } from '../../cadet/procedure';
import { toRpcError } from '../../errors';
import {
  cadetNoticeDownloadSchema,
  cadetTimetableSchema,
  getCadetTimetableInputSchema,
  listCadetTimetablesInputSchema,
  listCadetTimetablesOutputSchema,
} from './cadet.dto';
import { getCadetTimetable, getCadetTimetableDownload, listCadetTimetables } from './cadet-timetables.service';

const route = (summary: string, description: string) => ({ summary, description, tags: ['Cadet'] });

/**
 * The signed-in student's examination timetables. As everywhere in the Cadet
 * Portal, the school and admission come from the login, never from input. Only
 * published timetables of sessions the student is enrolled in exist here
 * (`cadet-timetables.service.ts`); `cadetProcedure` has already required the
 * school's `cadet` feature. Timetables belong to examinations, so they have no
 * feature of their own.
 */
export const cadetTimetablesRouter = {
  listTimetables: cadetProcedure
    .route(route('List published exam timetables', "The school's published examination timetables for the sessions the signed-in student is enrolled in, newest first."))
    .meta({ mcp: { exposure: 'core', access: 'read', destructive: false, module: 'exams' } })
    .input(listCadetTimetablesInputSchema)
    .output(listCadetTimetablesOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        return await listCadetTimetables(context.db, context.cadet, input);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getTimetable: cadetProcedure
    .route(route('Get an exam timetable', 'One published examination timetable with the schedule of every class: dates, times, subjects and modes.'))
    .meta({ mcp: { exposure: 'core', access: 'read', destructive: false, module: 'exams' } })
    .input(getCadetTimetableInputSchema)
    .output(cadetTimetableSchema)
    .handler(async ({ context, input }) => {
      try {
        return await getCadetTimetable(context.db, context.cadet, input);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getTimetableDownload: cadetProcedure
    .route(route('Download an exam timetable as PDF', 'Issue a five-minute download URL for the PDF of a published examination timetable (all classes).'))
    // Hidden from the cadet MCP: a signed URL has no agent value (`getTimetable` carries the schedule).
    // `read`: it changes no record; the first call may store a derived PDF.
    .meta({ mcp: { exposure: 'hidden', access: 'read', destructive: false, module: 'exams' } })
    .input(getCadetTimetableInputSchema)
    .output(cadetNoticeDownloadSchema)
    .handler(async ({ context, input }) => {
      try {
        return await getCadetTimetableDownload(context.db, context.cadet, input);
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
