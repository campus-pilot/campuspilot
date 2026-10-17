import { z } from "zod";
/** Explicit printing choices do not change the session's assessment settings,
 * grading calculations, approval facts, or saved result values.
 */
export const reportSectionsSchema = z.object({
  includeModeMarks: z.boolean().default(true),
  includeAttendance: z.boolean().default(true),
  includeCoScholastics: z.boolean().default(true),
  includeGradingScale: z.boolean().default(true),
});
export const DEFAULT_REPORT_SECTIONS = reportSectionsSchema.parse({});
export const reportResultPolicySchema = z.enum([
  "require_all",
  "approved_only",
]);
export const documentGenerationOptionsSchema = z.object({
  reportSections: reportSectionsSchema.optional(),
  resultPolicy: reportResultPolicySchema.optional(),
});
export type DocumentGenerationOptions = z.infer<
  typeof documentGenerationOptionsSchema
>;
