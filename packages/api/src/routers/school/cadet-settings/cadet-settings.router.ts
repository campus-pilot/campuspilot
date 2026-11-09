import { schoolTable } from "@campuspilot/db/schema/school";
import { SCHOOL_ACTIONS } from "@campuspilot/opa/policies/school";
import { eq } from "drizzle-orm";

import { rpcError, toRpcError } from "../../../errors";
import { protectedProcedure } from "../../../index";
import { requireSchoolPermission } from "../../../permissions/school";
import {
  cadetPortalSettingsDtoSchema,
  cadetPortalSettingsInputSchema,
  updateCadetPortalSettingsInputSchema,
} from "./cadet-settings.dto";

/**
 * School-level Cadet Portal settings. They are school details, so they use
 * the school details read/update permissions.
 */
export const schoolCadetSettingsRouter = {
  getCadetPortalSettings: protectedProcedure
    .route({
      summary: "Get Cadet Portal settings",
      description:
        "Read what the school shares with students in the Cadet Portal beyond their own records, such as class averages.",
      tags: ["School", "Cadet Portal"],
    })
    .meta({
      mcp: {
        exposure: "advanced",
        access: "read",
        destructive: false,
        module: "schools",
      },
    })
    .input(cadetPortalSettingsInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_DETAILS))
    .output(cadetPortalSettingsDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const [school] = await context.db
          .select({ showClassAverages: schoolTable.cadetShowClassAverages })
          .from(schoolTable)
          .where(eq(schoolTable.id, input.schoolId))
          .limit(1);
        if (!school) throw rpcError.notFound("School");
        return { schoolId: input.schoolId, ...school };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  updateCadetPortalSettings: protectedProcedure
    .route({
      summary: "Update Cadet Portal settings",
      description:
        "Choose whether students see class averages next to their own released results in the Cadet Portal. Off by default.",
      tags: ["School", "Cadet Portal"],
    })
    .meta({
      mcp: {
        exposure: "advanced",
        access: "write",
        destructive: true,
        module: "schools",
      },
    })
    .input(updateCadetPortalSettingsInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.UPDATE_DETAILS))
    .output(cadetPortalSettingsDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const [school] = await context.db
          .update(schoolTable)
          .set({ cadetShowClassAverages: input.showClassAverages, updatedAt: new Date() })
          .where(eq(schoolTable.id, input.schoolId))
          .returning({ showClassAverages: schoolTable.cadetShowClassAverages });
        if (!school) throw rpcError.notFound("School");
        return { schoolId: input.schoolId, ...school };
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
