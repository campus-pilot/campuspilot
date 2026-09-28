import { admissionSettingsSchema } from "@campuspilot/db/schema/jsonb/admission-config";
import { z } from "zod";

export const admissionSettingsInputSchema = z.object({
  schoolId: z.string().min(1),
});

export const admissionSettingsDtoSchema = admissionSettingsInputSchema.extend({
  settings: admissionSettingsSchema,
});

export const updateAdmissionSettingsInputSchema =
  admissionSettingsInputSchema.extend({
    settings: admissionSettingsSchema,
  });
