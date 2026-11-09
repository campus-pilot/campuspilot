import { z } from "zod";

export const cadetPortalSettingsInputSchema = z.object({
  schoolId: z.string().min(1),
});

export const cadetPortalSettingsDtoSchema = z.object({
  schoolId: z.string(),
  /** Whether students see class averages next to their own released results. */
  showClassAverages: z.boolean(),
});

export type CadetPortalSettingsDto = z.infer<typeof cadetPortalSettingsDtoSchema>;

export const updateCadetPortalSettingsInputSchema = cadetPortalSettingsInputSchema.extend({
  showClassAverages: z
    .boolean()
    .describe("Show class averages next to students' own released results in the Cadet Portal."),
});
