import { oauthClient } from "@campuspilot/db/schema/auth";
import { admissionTable } from "@campuspilot/db/schema/admission";
import { classTable, sectionTable } from "@campuspilot/db/schema/class";
import { schoolTable } from "@campuspilot/db/schema/school";
import { schoolMemberTable } from "@campuspilot/db/schema/school-member";
import { schoolSessionTable } from "@campuspilot/db/schema/session";
import { studentTable } from "@campuspilot/db/schema/student";
import { SYSTEM_ACTIONS } from "@campuspilot/opa/policies/system";
import { and, asc, count, countDistinct, eq, sql } from "drizzle-orm";

import { rpcError, toRpcError } from "../../../errors";
import { protectedProcedure } from "../../../index";
import { requireSystemPermission } from "../../../permissions/system";
import {
  platformStatsOutputSchema,
  schoolStatsInputSchema,
  schoolStatsOutputSchema,
} from "./stats.dto";

/** Counts rows matching a boolean SQL condition inside an aggregate select. */
function countWhere(condition: ReturnType<typeof sql>) {
  return sql<number>`count(*) filter (where ${condition})`.mapWith(Number);
}

const MCP_META = {
  exposure: "advanced",
  access: "read",
  destructive: false,
  module: "platform",
} as const;

export const statsRouter = {
  getPlatformStats: protectedProcedure
    .route({
      summary: "Read platform statistics (platform admin only)",
      description:
        "Platform-administrator tool. Read aggregate counts across CampusPilot: schools, onboarding and demo status, OAuth clients, staff memberships and registered admissions. Not intended for school users.",
      tags: ["System Admin", "Stats"],
    })
    .meta({ mcp: MCP_META })
    .use(requireSystemPermission(SYSTEM_ACTIONS.READ_PLATFORM_STATS))
    .output(platformStatsOutputSchema)
    .handler(async ({ context }) => {
      try {
        const [[schools], [clients], [members], [admissions]] =
          await Promise.all([
            context.db
              .select({
                total: count(),
                onboarded: countWhere(
                  sql`${schoolTable.hasCompletedOnboarding} = true`,
                ),
                demo: countWhere(sql`${schoolTable.isDemo} = true`),
              })
              .from(schoolTable),
            context.db
              .select({
                total: count(),
                disabled: countWhere(sql`${oauthClient.disabled} = true`),
              })
              .from(oauthClient),
            context.db
              .select({ total: countDistinct(schoolMemberTable.userId) })
              .from(schoolMemberTable),
            context.db
              .select({ total: count() })
              .from(admissionTable)
              .where(eq(admissionTable.registered, true)),
          ]);

        return {
          schools: {
            total: schools?.total ?? 0,
            onboarded: schools?.onboarded ?? 0,
            demo: schools?.demo ?? 0,
          },
          oauthClients: {
            total: clients?.total ?? 0,
            disabled: clients?.disabled ?? 0,
          },
          staffMembers: members?.total ?? 0,
          registeredAdmissions: admissions?.total ?? 0,
        };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getSchoolStats: protectedProcedure
    .route({
      summary: "Read school statistics (platform admin only)",
      description:
        "Platform-administrator tool. Read aggregate counts for one school: admissions (registered and unregistered), staff, classes, sections, sessions and active-session enrolment by class. Returns counts only, never student records. Not intended for school users.",
      tags: ["System Admin", "Stats"],
    })
    .meta({ mcp: MCP_META })
    .input(schoolStatsInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.READ_SCHOOL_STATS))
    .output(schoolStatsOutputSchema)
    .handler(async ({ context, input }) => {
      const { schoolId } = input;
      try {
        const [school] = await context.db
          .select({ id: schoolTable.id })
          .from(schoolTable)
          .where(eq(schoolTable.id, schoolId))
          .limit(1);
        if (!school) throw rpcError.notFound("School");

        const [
          [admissions],
          [members],
          [classes],
          [sections],
          [sessions],
          [activeSession],
        ] = await Promise.all([
          context.db
            .select({
              total: count(),
              registered: countWhere(
                sql`${admissionTable.registered} = true`,
              ),
              unregistered: countWhere(
                sql`${admissionTable.registered} = false`,
              ),
            })
            .from(admissionTable)
            .where(eq(admissionTable.schoolId, schoolId)),
          context.db
            .select({ total: count() })
            .from(schoolMemberTable)
            .where(eq(schoolMemberTable.schoolId, schoolId)),
          context.db
            .select({ total: count() })
            .from(classTable)
            .where(eq(classTable.schoolId, schoolId)),
          context.db
            .select({ total: count() })
            .from(sectionTable)
            .where(eq(sectionTable.schoolId, schoolId)),
          context.db
            .select({ total: count() })
            .from(schoolSessionTable)
            .where(eq(schoolSessionTable.schoolId, schoolId)),
          context.db
            .select({
              id: schoolSessionTable.id,
              sessionStartYear: schoolSessionTable.sessionStartYear,
              sessionEndYear: schoolSessionTable.sessionEndYear,
            })
            .from(schoolSessionTable)
            .where(
              and(
                eq(schoolSessionTable.schoolId, schoolId),
                eq(schoolSessionTable.isActive, true),
              ),
            )
            .limit(1),
        ]);

        return {
          admissions: {
            total: admissions?.total ?? 0,
            registered: admissions?.registered ?? 0,
            unregistered: admissions?.unregistered ?? 0,
          },
          staffMembers: members?.total ?? 0,
          classes: classes?.total ?? 0,
          sections: sections?.total ?? 0,
          sessions: sessions?.total ?? 0,
          activeSession: activeSession
            ? {
                ...activeSession,
                ...(await readSessionEnrolment(
                  context.db,
                  schoolId,
                  activeSession.id,
                )),
              }
            : null,
        };
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};

/**
 * Counts students enrolled in one session. Only students whose admission is
 * still registered count as enrolled, matching the invariant that student
 * rows are only meaningful while their admission stays registered.
 */
async function readSessionEnrolment(
  db: typeof import("@campuspilot/db").db,
  schoolId: string,
  sessionId: string,
) {
  const enrolledStudents = and(
    eq(studentTable.schoolId, schoolId),
    eq(studentTable.sessionId, sessionId),
    eq(admissionTable.registered, true),
  );

  const [[totals], byClass] = await Promise.all([
    db
      .select({
        enrolled: count(),
        withoutClass: countWhere(sql`${studentTable.classId} is null`),
      })
      .from(studentTable)
      .innerJoin(admissionTable, eq(admissionTable.id, studentTable.admissionId))
      .where(enrolledStudents),
    db
      .select({
        classId: classTable.id,
        label: classTable.label,
        // The admission join only matches registered admissions, so this
        // counts registered students while keeping empty classes listed.
        students: count(admissionTable.id),
      })
      .from(classTable)
      .leftJoin(
        studentTable,
        and(
          eq(studentTable.classId, classTable.id),
          eq(studentTable.sessionId, sessionId),
        ),
      )
      .leftJoin(
        admissionTable,
        and(
          eq(admissionTable.id, studentTable.admissionId),
          eq(admissionTable.registered, true),
        ),
      )
      .where(eq(classTable.schoolId, schoolId))
      .groupBy(classTable.id, classTable.label, classTable.displayOrder)
      .orderBy(asc(classTable.displayOrder)),
  ]);

  return {
    enrolledStudents: totals?.enrolled ?? 0,
    studentsWithoutClass: totals?.withoutClass ?? 0,
    studentsByClass: byClass,
  };
}
