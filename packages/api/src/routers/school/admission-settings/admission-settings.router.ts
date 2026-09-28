import { schoolTable } from "@campuspilot/db/schema/school";
import { SCHOOL_ACTIONS } from "@campuspilot/opa/policies/school";
import { eq } from "drizzle-orm";

import { rpcError, toRpcError } from "../../../errors";
import { protectedProcedure } from "../../../index";
import { requireSchoolPermission } from "../../../permissions/school";
import {
  admissionSettingsDtoSchema,
  admissionSettingsInputSchema,
  updateAdmissionSettingsInputSchema,
} from "./admission-settings.dto";

export const schoolAdmissionSettingsRouter = {
  getAdmissionSettings: protectedProcedure
    .route({
      summary: "Get admission settings",
      description:
        "Get the school's advisory document types for admissions. These settings do not block admission creation.",
      tags: ["School", "Admission Settings"],
    })
    .input(admissionSettingsInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_ADMISSION_SETTINGS))
    .output(admissionSettingsDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const [school] = await context.db
          .select({ settings: schoolTable.admissionSettings })
          .from(schoolTable)
          .where(eq(schoolTable.id, input.schoolId))
          .limit(1);
        if (!school) throw rpcError.notFound("School");
        return admissionSettingsDtoSchema.parse({
          schoolId: input.schoolId,
          settings: school.settings,
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  updateAdmissionSettings: protectedProcedure
    .route({
      summary: "Update admission settings",
      description:
        "Replace the school's advisory admission document types. Existing admissions and attachments are not constrained by this list.",
      tags: ["School", "Admission Settings"],
    })
    .input(updateAdmissionSettingsInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.UPDATE_ADMISSION_SETTINGS))
    .output(admissionSettingsDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const [school] = await context.db
          .update(schoolTable)
          .set({
            admissionSettings: input.settings,
            updatedAt: new Date(),
          })
          .where(eq(schoolTable.id, input.schoolId))
          .returning({ settings: schoolTable.admissionSettings });
        if (!school) throw rpcError.notFound("School");
        return admissionSettingsDtoSchema.parse({
          schoolId: input.schoolId,
          settings: school.settings,
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
