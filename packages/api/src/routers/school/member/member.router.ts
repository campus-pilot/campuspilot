import { createAuth } from "@campuspilot/auth/server";
import { user } from "@campuspilot/db/schema/auth";
import { schoolTable } from "@campuspilot/db/schema/school";
import { schoolUserRoleTable } from "@campuspilot/db/schema/school-user-role";
import { schoolActions } from "@campuspilot/opa/actions/school";
import { and, asc, eq, notInArray, sql } from "drizzle-orm";

import { rpcError, toRpcError } from "../../../errors";
import { protectedProcedure } from "../../../index";
import { requireSchoolPermission } from "../../../permissions/school";
import {
  inviteSchoolMemberInputSchema,
  schoolMemberDtoSchema,
} from "./member.dto";

export const schoolMemberRouter = {
  inviteMember: protectedProcedure
    .input(inviteSchoolMemberInputSchema)
    .use(requireSchoolPermission(schoolActions.inviteMember))
    .output(schoolMemberDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          const [school] = await transaction
            .select({ id: schoolTable.id })
            .from(schoolTable)
            .where(eq(schoolTable.id, input.schoolId))
            .limit(1);
          if (!school) throw rpcError.notFound("School");

          let invitedUser = await transaction.query.user.findFirst({
            columns: { id: true, name: true, email: true },
            where: eq(user.email, input.email),
          });

          if (!invitedUser) {
            // This auth instance uses the active transaction as its adapter,
            // keeping user provisioning and every role assignment atomic.
            const transactionalAuth = createAuth(transaction);
            const created = await transactionalAuth.api.createUser({
              body: {
                email: input.email,
                name: input.name,
              },
            });
            invitedUser = created.user;
          }

          const requestedRoles = input.roles.map(({ role }) => role);
          // The roles array is the complete desired role set for this school.
          // Removing omitted rows prevents sequential calls from accumulating
          // roles that the latest request did not explicitly include.
          await transaction
            .delete(schoolUserRoleTable)
            .where(
              and(
                eq(schoolUserRoleTable.schoolId, input.schoolId),
                eq(schoolUserRoleTable.userId, invitedUser.id),
                notInArray(schoolUserRoleTable.role, requestedRoles),
              ),
            );

          await transaction
            .insert(schoolUserRoleTable)
            .values(
              input.roles.map(({ role, meta }) => ({
                schoolId: input.schoolId,
                userId: invitedUser.id,
                role,
                meta,
              })),
            )
            // Conflict updates keep role-specific metadata aligned with the
            // complete assignment supplied by this request.
            .onConflictDoUpdate({
              target: [
                schoolUserRoleTable.schoolId,
                schoolUserRoleTable.userId,
                schoolUserRoleTable.role,
              ],
              set: { meta: sql`excluded.meta` },
            });

          const assignedRoles = await transaction
            .select({
              role: schoolUserRoleTable.role,
              meta: schoolUserRoleTable.meta,
            })
            .from(schoolUserRoleTable)
            .where(
              and(
                eq(schoolUserRoleTable.schoolId, input.schoolId),
                eq(schoolUserRoleTable.userId, invitedUser.id),
              ),
            )
            .orderBy(asc(schoolUserRoleTable.role));

          return schoolMemberDtoSchema.parse({
            schoolId: input.schoolId,
            userId: invitedUser.id,
            name: invitedUser.name,
            email: invitedUser.email,
            roles: assignedRoles,
          });
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
