import type { DatabaseExecutor } from "@campuspilot/db";
import { user } from "@campuspilot/db/schema/auth";
import { schoolTable } from "@campuspilot/db/schema/school";
import {
  schoolCreationRequestTable,
  schoolCreationTable,
} from "@campuspilot/db/schema/school-creation";
import { SYSTEM_ACTIONS } from "@campuspilot/opa/policies/system";
import { asc, count, desc, eq, inArray, sql } from "drizzle-orm";

import { rpcError, toRpcError } from "../../../errors";
import { platformAdminProcedure } from "../../../index";
import {
  createNextPageCursor,
  createPaginatedResult,
  resolvePaginationInput,
} from "../../../paginations";
import { requireSystemPermission } from "../../../permissions/system";
import { lockUser } from "../../../school-creation/school-creation.service";
import { staffIdentityColumns, toStaffIdentity } from "../../../users/staff-identity";
import {
  countPendingSchoolCreationRequestsOutputSchema,
  decideSchoolCreationRequestInputSchema,
  listSchoolCreationRequestsInputSchema,
  listSchoolCreationRequestsOutputSchema,
  schoolCreationRequestDtoSchema,
} from "./school-creation-request.dto";

/** The schools each person created, oldest first, keyed by person. */
async function createdSchoolsByUser(db: DatabaseExecutor, userIds: string[]) {
  const rows =
    userIds.length === 0
      ? []
      : await db
          .select({
            userId: schoolCreationTable.userId,
            schoolId: schoolCreationTable.schoolId,
            name: schoolTable.name,
            createdAt: schoolCreationTable.createdAt,
          })
          .from(schoolCreationTable)
          .leftJoin(schoolTable, eq(schoolTable.id, schoolCreationTable.schoolId))
          .where(inArray(schoolCreationTable.userId, userIds))
          .orderBy(asc(schoolCreationTable.createdAt), asc(schoolCreationTable.id));
  const byUser = new Map<string, Array<{ schoolId: string | null; name: string | null; createdAt: Date }>>();
  for (const { userId, ...school } of rows) {
    byUser.set(userId, [...(byUser.get(userId) ?? []), school]);
  }
  return byUser;
}

/**
 * Requests from staff to create more schools than their allowance
 * (docs/school-creation.md), for the admin app's School requests page. Hidden
 * from MCP: how many schools someone may open is a human platform decision.
 */
export const schoolCreationRequestRouter = {
  listSchoolCreationRequests: platformAdminProcedure
    .route({
      summary: "List school creation requests",
      description:
        "List requests to create more schools, newest first, optionally only those in one state, with each person's current allowance and the schools they created. Requires system-administrator permission.",
      tags: ["System Admin", "Schools"],
    })
    .meta({ mcp: { exposure: "hidden", access: "read", destructive: false, module: "platform" } })
    .input(listSchoolCreationRequestsInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.LIST_SCHOOL_CREATION_REQUESTS))
    .output(listSchoolCreationRequestsOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const { currentPage, pageSize, offset } = resolvePaginationInput(input);
        const where = input.status ? eq(schoolCreationRequestTable.status, input.status) : undefined;
        const [rows, totalRows] = await Promise.all([
          context.db
            .select({
              id: schoolCreationRequestTable.id,
              userId: schoolCreationRequestTable.userId,
              name: user.name,
              ...staffIdentityColumns,
              requestedLimit: schoolCreationRequestTable.requestedLimit,
              reason: schoolCreationRequestTable.reason,
              status: schoolCreationRequestTable.status,
              grantedLimit: schoolCreationRequestTable.grantedLimit,
              decisionNote: schoolCreationRequestTable.decisionNote,
              decidedAt: schoolCreationRequestTable.decidedAt,
              createdAt: schoolCreationRequestTable.createdAt,
              currentLimit: user.schoolCreationLimit,
            })
            .from(schoolCreationRequestTable)
            .innerJoin(user, eq(user.id, schoolCreationRequestTable.userId))
            .where(where)
            .orderBy(desc(schoolCreationRequestTable.createdAt), desc(schoolCreationRequestTable.id))
            .limit(pageSize)
            .offset(offset),
          context.db.select({ totalItems: count() }).from(schoolCreationRequestTable).where(where),
        ]);
        const created = await createdSchoolsByUser(
          context.db,
          [...new Set(rows.map(({ userId }) => userId))],
        );
        const totalItems = totalRows[0]?.totalItems ?? 0;
        const totalPages = Math.ceil(totalItems / pageSize);
        return createPaginatedResult({
          items: rows.map(({ email, emailIsPlaceholder, phoneNumber, ...row }) =>
            schoolCreationRequestDtoSchema.parse({
              ...row,
              ...toStaffIdentity({ email, emailIsPlaceholder, phoneNumber }),
              createdSchools: created.get(row.userId) ?? [],
            }),
          ),
          nextCursor: createNextPageCursor(currentPage, totalPages),
          currentPage,
          totalPages,
          totalItems,
          pageSize,
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  countPendingSchoolCreationRequests: platformAdminProcedure
    .route({
      summary: "Count pending school creation requests",
      description: "How many requests to create more schools wait for a decision. Requires system-administrator permission.",
      tags: ["System Admin", "Schools"],
    })
    .meta({ mcp: { exposure: "hidden", access: "read", destructive: false, module: "platform" } })
    .use(requireSystemPermission(SYSTEM_ACTIONS.LIST_SCHOOL_CREATION_REQUESTS))
    .output(countPendingSchoolCreationRequestsOutputSchema)
    .handler(async ({ context }) => {
      try {
        const [row] = await context.db
          .select({ pending: count() })
          .from(schoolCreationRequestTable)
          .where(eq(schoolCreationRequestTable.status, "pending"));
        return { pending: row?.pending ?? 0 };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  decideSchoolCreationRequest: platformAdminProcedure
    .route({
      summary: "Decide a school creation request",
      description:
        "Approve a pending request to create more schools, raising the person's allowance to the granted total (above their current allowance), or reject it, with an optional note the person sees. A request that is no longer pending cannot be decided again (CONFLICT). Requires system-administrator permission.",
      tags: ["System Admin", "Schools"],
    })
    .meta({ mcp: { exposure: "hidden", access: "write", destructive: true, module: "platform" } })
    .input(decideSchoolCreationRequestInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.DECIDE_SCHOOL_CREATION_REQUEST))
    .output(schoolCreationRequestDtoSchema.pick({ id: true, status: true, grantedLimit: true }))
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          const [request] = await transaction
            .select({ userId: schoolCreationRequestTable.userId, status: schoolCreationRequestTable.status })
            .from(schoolCreationRequestTable)
            .where(eq(schoolCreationRequestTable.id, input.id))
            .for("update")
            .limit(1);
          if (!request) throw rpcError.notFound("School creation request");
          if (request.status !== "pending") throw rpcError.conflict("This request was already decided.");

          const grantedLimit = input.decision === "approve" ? input.grantedLimit : null;
          if (grantedLimit !== null) {
            // The person's own creations run under this lock too, so the
            // allowance read here is the one the approval replaces.
            await lockUser(transaction, request.userId);
            const [account] = await transaction
              .select({ limit: user.schoolCreationLimit })
              .from(user)
              .where(eq(user.id, request.userId))
              .limit(1);
            const currentLimit = account?.limit ?? 0;
            // An approval only ever raises the allowance: granting less than
            // they may already create would quietly take schools away.
            if (grantedLimit <= currentLimit) {
              throw rpcError.badRequest(
                `This person may already create ${currentLimit} school${currentLimit === 1 ? "" : "s"}; grant more than that, or reject the request.`,
              );
            }
            await transaction.update(user).set({ schoolCreationLimit: grantedLimit }).where(eq(user.id, request.userId));
          }
          const [decided] = await transaction
            .update(schoolCreationRequestTable)
            .set({
              status: input.decision === "approve" ? "approved" : "rejected",
              grantedLimit,
              decisionNote: input.note || null,
              decidedBy: context.session.user.id,
              decidedAt: sql`now()`,
              updatedAt: sql`now()`,
            })
            .where(eq(schoolCreationRequestTable.id, input.id))
            .returning({
              id: schoolCreationRequestTable.id,
              status: schoolCreationRequestTable.status,
              grantedLimit: schoolCreationRequestTable.grantedLimit,
            });
          if (!decided) throw rpcError.internal();
          return decided;
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
