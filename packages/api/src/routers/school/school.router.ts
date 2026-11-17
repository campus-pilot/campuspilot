import { schoolDocumentRouter } from './document/document.router';
import { schoolDashboardRouter } from './dashboard/dashboard.router';
import type { DatabaseExecutor } from "@campuspilot/db";
import { activeSchoolTrialCondition } from "@campuspilot/db/feature-flags/store";
import { schoolMemberTable } from "@campuspilot/db/schema/school-member";
import { schoolTable } from "@campuspilot/db/schema/school";
import { schoolTrialTable } from "@campuspilot/db/schema/school-trial";
import { SCHOOL_ACTIONS } from "@campuspilot/opa/policies/school";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { rpcError, toRpcError } from "../../errors";
import { protectedProcedure } from "../../index";
import { schoolPlanFactsOf } from "../../school-access/school-access.service";
import { gateRouterOnSchoolFeature } from "../../permissions/feature";
import { requireSchoolPermission } from "../../permissions/school";
import { schoolAdmissionSettingsRouter } from "./admission-settings/admission-settings.router";
import { schoolCadetSettingsRouter } from "./cadet-settings/cadet-settings.router";
import { schoolAdmissionRouter } from "./admission/admission.router";
import { schoolBillingRouter } from "./billing/billing.router";
import { schoolClassRouter } from "./class/class.router";
import { schoolSectionRouter } from "./class/section.router";
import { schoolFeatureFlagsRouter } from "./feature-flags/feature-flags.router";
import { schoolAssistantAccessRouter } from "./assistant-access/assistant-access.router";
import { schoolExamRouter } from "./exam/exam.router";
import { schoolLogoRouter } from "./logo/logo.router";
import { schoolMemberRouter } from "./member/member.router";
import { schoolNoticeRouter } from "./notice/notice.router";
import { schoolNotificationRouter } from "./notification/notification.router";
import { schoolNotificationLogRouter } from "./notification/notification-log.router";
import {
  mySchoolDtoSchema,
  schoolDetailsDtoSchema,
  schoolDetailsInputSchema,
  updateSchoolDetailsInputSchema,
} from "./school.dto";
import { schoolSessionFinanceRouter } from "./session-finance/session-finance.router";
import { schoolSessionRouter } from "./session/session.router";
import { schoolStudentRouter } from "./student/student.router";

/**
 * The columns every school-facing school DTO reads, with the active trial
 * left joined (at most one per school) for {@link withPlanFacts}.
 */
const mySchoolColumns = {
  id: schoolTable.id,
  slug: schoolTable.slug,
  name: schoolTable.name,
  location: schoolTable.location,
  logoS3Key: schoolTable.logoS3Key,
  isDemo: schoolTable.isDemo,
  isSuspended: sql<boolean>`${schoolTable.suspendedAt} is not null`,
  subscribedTier: schoolTable.tier,
  trialTier: schoolTrialTable.tier,
  trialEndsAt: schoolTrialTable.endsAt,
};

const activeTrialJoin = and(eq(schoolTrialTable.schoolId, schoolTable.id), activeSchoolTrialCondition());

/** A row of {@link mySchoolColumns} with the plan facts the apps show instead of the plan's raw columns. */
function withPlanFacts<T extends { subscribedTier: SchoolTierValue; trialTier: SchoolTierValue; trialEndsAt: Date | null }>(row: T) {
  const { subscribedTier, trialTier, trialEndsAt, ...school } = row;
  const trial = trialTier !== null && trialEndsAt !== null ? { tier: trialTier, endsAt: trialEndsAt } : null;
  return { ...school, ...schoolPlanFactsOf({ subscribedTier, trial }) };
}

type SchoolTierValue = (typeof schoolTable.$inferSelect)["tier"];

/** One school's details as the school's own staff read them; null when it does not exist. */
async function readSchoolDetails(db: DatabaseExecutor, schoolId: string) {
  const [school] = await db
    .select({ ...mySchoolColumns, registrationNo: schoolTable.registrationNo })
    .from(schoolTable)
    .leftJoin(schoolTrialTable, activeTrialJoin)
    .where(eq(schoolTable.id, schoolId))
    .limit(1);
  return school ? schoolDetailsDtoSchema.parse(withPlanFacts(school)) : null;
}

export const schoolRouter = {
  ...schoolDashboardRouter,
  ...schoolDocumentRouter,
  ...schoolExamRouter,
  ...schoolNotificationRouter,
  // Every delivery in the log is a student notification (admission, billing run, exam, notice).
  ...gateRouterOnSchoolFeature("studentManagement", schoolNotificationLogRouter),
  ...schoolFeatureFlagsRouter,
  ...schoolAssistantAccessRouter,
  ...schoolNoticeRouter,
  listMySchools: protectedProcedure
    .route({
      summary: "List my schools",
      description:
        "List every school the authenticated user currently belongs to in deterministic name order.",
      tags: ["School"],
    })
    .meta({
      mcp: {
        exposure: "core",
        access: "read",
        destructive: false,
        module: "schools",
      },
    })
    // This intentionally is not paginated: a user's tenant memberships are a
    // small bounded set and the client needs the complete set for switching.
    .output(z.array(mySchoolDtoSchema))
    .handler(async ({ context }) => {
      // This procedure takes no schoolId, so the assistant's school check in
      // `assertAssistantToolPolicy` has nothing to compare. An assistant
      // conversation belongs to one school and must not learn the user's
      // other schools, so for it the list is that one school.
      const assistantSchoolId =
        context.principal.authMethod === "assistant"
          ? context.principal.assistantRun.schoolId
          : undefined;
      try {
        const schools = await context.db
          .select(mySchoolColumns)
          .from(schoolMemberTable)
          .innerJoin(
            schoolTable,
            eq(schoolMemberTable.schoolId, schoolTable.id),
          )
          .leftJoin(schoolTrialTable, activeTrialJoin)
          .where(
            and(
              eq(schoolMemberTable.userId, context.session.user.id),
              assistantSchoolId === undefined
                ? undefined
                : eq(schoolTable.id, assistantSchoolId),
            ),
          )
          .orderBy(asc(schoolTable.name), asc(schoolTable.id));
        return schools.map(withPlanFacts);
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
    .meta({
      mcp: {
        exposure: "core",
        access: "read",
        destructive: false,
        module: "schools",
      },
    })
    .input(schoolDetailsInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_DETAILS))
    .output(schoolDetailsDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const school = await readSchoolDetails(context.db, input.schoolId);
        if (!school) throw rpcError.notFound("School");
        return school;
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
    .meta({
      mcp: {
        exposure: "advanced",
        access: "write",
        destructive: true,
        module: "schools",
      },
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
          .returning({ id: schoolTable.id });
        if (!school) throw rpcError.notFound("School");
        const details = await readSchoolDetails(context.db, school.id);
        if (!details) throw rpcError.notFound("School");
        return details;
      } catch (error) {
        throw toRpcError(error);
      }
    }),
  // Admissions, students and fees belong wholly to student management
  // (docs/feature-flags.md); each gate runs after the procedure's permission.
  ...gateRouterOnSchoolFeature("studentManagement", schoolAdmissionSettingsRouter),
  ...schoolCadetSettingsRouter,
  ...gateRouterOnSchoolFeature("studentManagement", schoolAdmissionRouter),
  ...gateRouterOnSchoolFeature("studentManagement", schoolBillingRouter),
  ...schoolLogoRouter,
  ...schoolClassRouter,
  ...schoolSectionRouter,
  ...schoolMemberRouter,
  ...gateRouterOnSchoolFeature("studentManagement", schoolSessionFinanceRouter),
  ...schoolSessionRouter,
  ...gateRouterOnSchoolFeature("studentManagement", schoolStudentRouter),
};
