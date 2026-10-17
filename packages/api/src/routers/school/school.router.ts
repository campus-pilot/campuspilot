import { schoolDocumentRouter } from './document/document.router';
import { schoolMemberTable } from "@campuspilot/db/schema/school-member";
import { schoolTable } from "@campuspilot/db/schema/school";
import { SCHOOL_ACTIONS } from "@campuspilot/opa/policies/school";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { rpcError, toRpcError } from "../../errors";
import { protectedProcedure } from "../../index";
import { requireSchoolPermission } from "../../permissions/school";
import { schoolAdmissionSettingsRouter } from "./admission-settings/admission-settings.router";
import { schoolAdmissionRouter } from "./admission/admission.router";
import { schoolClassRouter } from "./class/class.router";
import { schoolSectionRouter } from "./class/section.router";
import { schoolExamRouter } from "./exam/exam.router";
import { schoolLogoRouter } from "./logo/logo.router";
import { schoolMemberRouter } from "./member/member.router";
import {
  mySchoolDtoSchema,
  schoolDetailsDtoSchema,
  schoolDetailsInputSchema,
  updateSchoolDetailsInputSchema,
} from "./school.dto";
import { schoolSessionFinanceRouter } from "./session-finance/session-finance.router";
import { schoolSessionRouter } from "./session/session.router";
import { schoolStudentRouter } from "./student/student.router";

export const schoolRouter = {
  ...schoolDocumentRouter,
  ...schoolExamRouter,
  listMySchools: protectedProcedure
    .route({
      summary: "List my schools",
      description:
        "List every school the authenticated user currently belongs to in deterministic name order.",
      tags: ["School"],
    })
    // This intentionally is not paginated: a user's tenant memberships are a
    // small bounded set and the client needs the complete set for switching.
    .output(z.array(mySchoolDtoSchema))
    .handler(async ({ context }) => {
      try {
        return await context.db
          .select({
            id: schoolTable.id,
            slug: schoolTable.slug,
            name: schoolTable.name,
            location: schoolTable.location,
            logoS3Key: schoolTable.logoS3Key,
          })
          .from(schoolMemberTable)
          .innerJoin(
            schoolTable,
            eq(schoolMemberTable.schoolId, schoolTable.id),
          )
          .where(eq(schoolMemberTable.userId, context.session.user.id))
          .orderBy(asc(schoolTable.name), asc(schoolTable.id));
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  getSchool: protectedProcedure
    .route({
      summary: "Get school details",
      description:
        "Get the identity and organization details for a school. Requires permission to read that school's details.",
      tags: ["School"],
    })
    .input(schoolDetailsInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_DETAILS))
    .output(schoolDetailsDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const [school] = await context.db
          .select({
            id: schoolTable.id,
            slug: schoolTable.slug,
            name: schoolTable.name,
            location: schoolTable.location,
            registrationNo: schoolTable.registrationNo,
            logoS3Key: schoolTable.logoS3Key,
          })
          .from(schoolTable)
          .where(eq(schoolTable.id, input.schoolId))
          .limit(1);
        if (!school) throw rpcError.notFound("School");
        return schoolDetailsDtoSchema.parse(school);
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  updateSchool: protectedProcedure
    .route({
      summary: "Update school details",
      description:
        "Update editable identity and organization details for a school. Requires permission to update that school's details.",
      tags: ["School"],
    })
    .input(updateSchoolDetailsInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.UPDATE_DETAILS))
    .output(schoolDetailsDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const { schoolId, ...changes } = input;
        const [school] = await context.db
          .update(schoolTable)
          .set({ ...changes, updatedAt: new Date() })
          .where(eq(schoolTable.id, schoolId))
          .returning({
            id: schoolTable.id,
            slug: schoolTable.slug,
            name: schoolTable.name,
            location: schoolTable.location,
            registrationNo: schoolTable.registrationNo,
            logoS3Key: schoolTable.logoS3Key,
          });
        if (!school) throw rpcError.notFound("School");
        return schoolDetailsDtoSchema.parse(school);
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  ...schoolAdmissionSettingsRouter,
  ...schoolAdmissionRouter,
  ...schoolLogoRouter,
  ...schoolClassRouter,
  ...schoolSectionRouter,
  ...schoolMemberRouter,
  ...schoolSessionFinanceRouter,
  ...schoolSessionRouter,
  ...schoolStudentRouter,
};
