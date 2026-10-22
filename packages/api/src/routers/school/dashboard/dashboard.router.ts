import { SCHOOL_ACTIONS } from "@campuspilot/opa/policies/school";

import { toRpcError } from "../../../errors";
import { protectedProcedure } from "../../../index";
import { checkPermissions } from "../../../permissions/authorization";
import { requireSchoolPermission } from "../../../permissions/school";
import { dashboardInputSchema, dashboardOutputSchema } from "./dashboard.dto";
import { readDashboard } from "./dashboard-read";

const dashboardPermissionActions = [
  SCHOOL_ACTIONS.LIST_ADMISSIONS,
  SCHOOL_ACTIONS.LIST_CLASSES,
  SCHOOL_ACTIONS.LIST_STUDENTS,
  SCHOOL_ACTIONS.READ_BILLING_REPORTS,
  SCHOOL_ACTIONS.READ_EXAMS,
  SCHOOL_ACTIONS.CREATE_ADMISSION,
  SCHOOL_ACTIONS.RECORD_PAYMENT,
  SCHOOL_ACTIONS.WRITE_EXAM_RESULTS,
  SCHOOL_ACTIONS.LIST_SESSIONS,
  SCHOOL_ACTIONS.READ_ADMISSION_LEDGER,
  SCHOOL_ACTIONS.READ_SESSION_FINANCE,
] as const;

export const schoolDashboardRouter = {
  getDashboard: protectedProcedure
    .route({
      summary: "Read the session dashboard",
      description:
        "Read one permission-composed school-session dashboard. Unauthorized domains are returned as null and unauthorized common jobs as false.",
      tags: ["School", "Dashboard"],
    })
    .input(dashboardInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_SESSION))
    .output(dashboardOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        const decisions = await checkPermissions(
          context,
          dashboardPermissionActions.map((action) => ({
            action,
            resource: { kind: "school" as const, schoolId: input.schoolId },
          })),
          signal,
        );
        return await readDashboard(
          context.db,
          input,
          context.session.user.id,
          {
            admissions: decisions[0] === true,
            classes: decisions[1] === true,
            students: decisions[2] === true,
            billing: decisions[3] === true,
            examinations: decisions[4] === true,
            createAdmission:
              decisions[5] === true &&
              decisions[0] === true &&
              decisions[1] === true &&
              decisions[8] === true,
            recordPayment:
              decisions[6] === true &&
              decisions[9] === true &&
              decisions[10] === true,
            enterResults: decisions[7] === true && decisions[4] === true,
          },
        );
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
