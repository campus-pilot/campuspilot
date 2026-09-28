import { createAuth } from "@campuspilot/auth/server";
import type { DatabaseExecutor } from "@campuspilot/db";
import { user } from "@campuspilot/db/schema/auth";
import { schoolMemberTable } from "@campuspilot/db/schema/school-member";
import { schoolTable } from "@campuspilot/db/schema/school";
import { schoolUserRoleTable } from "@campuspilot/db/schema/school-user-role";
import { SCHOOL_ACTIONS } from "@campuspilot/opa/policies/school";
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  notExists,
  or,
  sql,
} from "drizzle-orm";

import { rpcError, toRpcError } from "../../../errors";
import { protectedProcedure } from "../../../index";
import {
  createNextPageCursor,
  createPaginatedResult,
  resolvePaginationInput,
} from "../../../paginations";
import { requireSchoolPermission } from "../../../permissions/school";
import { createProfileImageUrl } from "../../auth/profile-image";
import {
  inviteSchoolMemberInputSchema,
  listSchoolMembersInputSchema,
  listSchoolMembersOutputSchema,
  schoolMemberDtoSchema,
  schoolMemberIdInputSchema,
  updateSchoolMemberRolesInputSchema,
  type SchoolMemberDto,
} from "./member.dto";

/**
 * Reads the explicit membership and all role assignments within one school.
 * Membership existence and its added timestamp do not depend on role history.
 */
async function findSchoolMember(
  db: DatabaseExecutor,
  schoolId: string,
  userId: string,
): Promise<SchoolMemberDto | null> {
  const [member] = await db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      profileImageS3Key: user.profileImageS3Key,
      addedAt: schoolMemberTable.addedAt,
    })
    .from(schoolMemberTable)
    .innerJoin(user, eq(schoolMemberTable.userId, user.id))
    .where(
      and(
        eq(schoolMemberTable.schoolId, schoolId),
        eq(schoolMemberTable.userId, userId),
      ),
    )
    .limit(1);

  if (!member) return null;
  const { profileImageS3Key, ...memberDetails } = member;

  const roles = await db
    .select({
      role: schoolUserRoleTable.role,
      meta: schoolUserRoleTable.meta,
    })
    .from(schoolUserRoleTable)
    .where(
      and(
        eq(schoolUserRoleTable.schoolId, schoolId),
        eq(schoolUserRoleTable.userId, userId),
      ),
    )
    .orderBy(asc(schoolUserRoleTable.role));

  return schoolMemberDtoSchema.parse({
    schoolId,
    ...memberDetails,
    profileImageUrl: profileImageS3Key
      ? await createProfileImageUrl(profileImageS3Key)
      : null,
    roles,
  });
}

export const schoolMemberRouter = {
  listMembers: protectedProcedure
    .route({
      summary: "List school members",
      description:
        "List a school's members and all of their role assignments with pagination, name or email search, and deterministic sorting. Requires permission to list members in that school.",
      tags: ["School", "Members"],
    })
    .input(listSchoolMembersInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.LIST_MEMBERS))
    .output(listSchoolMembersOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const { currentPage, pageSize, offset } = resolvePaginationInput(input);
        const searchCondition = input.searchQuery
          ? or(
              ilike(user.name, `%${input.searchQuery}%`),
              ilike(user.email, `%${input.searchQuery}%`),
            )
          : undefined;
        const roleCondition = input.filters?.role
          ? exists(
              context.db
                .select({ value: sql`1` })
                .from(schoolUserRoleTable)
                .where(
                  and(
                    eq(schoolUserRoleTable.schoolId, input.schoolId),
                    eq(
                      schoolUserRoleTable.userId,
                      schoolMemberTable.userId,
                    ),
                    eq(schoolUserRoleTable.role, input.filters.role),
                  ),
                ),
            )
          : undefined;
        const classCondition = input.filters?.classId
          ? exists(
              context.db
                .select({ value: sql`1` })
                .from(schoolUserRoleTable)
                .where(
                  and(
                    eq(schoolUserRoleTable.schoolId, input.schoolId),
                    eq(
                      schoolUserRoleTable.userId,
                      schoolMemberTable.userId,
                    ),
                    eq(schoolUserRoleTable.role, "teacher"),
                    sql`${schoolUserRoleTable.meta} -> 'classIds' ? ${input.filters.classId}`,
                  ),
                ),
            )
          : undefined;
        const excludeClassCondition = input.filters?.excludeClassId
          ? notExists(
              context.db
                .select({ value: sql`1` })
                .from(schoolUserRoleTable)
                .where(
                  and(
                    eq(schoolUserRoleTable.schoolId, input.schoolId),
                    eq(
                      schoolUserRoleTable.userId,
                      schoolMemberTable.userId,
                    ),
                    eq(schoolUserRoleTable.role, "teacher"),
                    sql`${schoolUserRoleTable.meta} -> 'classIds' ? ${input.filters.excludeClassId}`,
                  ),
                ),
            )
          : undefined;
        const where = and(
          eq(schoolMemberTable.schoolId, input.schoolId),
          searchCondition,
          roleCondition,
          classCondition,
          excludeClassCondition,
        );
        const orderByColumn = {
          name: user.name,
          email: user.email,
          addedAt: schoolMemberTable.addedAt,
        }[input.orderBy.field];
        const orderDirection = input.orderBy.direction === "asc" ? asc : desc;

        const [members, totalRows] = await Promise.all([
          context.db
            .select({
              userId: user.id,
              name: user.name,
              email: user.email,
              profileImageS3Key: user.profileImageS3Key,
              addedAt: schoolMemberTable.addedAt,
            })
            .from(schoolMemberTable)
            .innerJoin(user, eq(schoolMemberTable.userId, user.id))
            .where(where)
            .orderBy(orderDirection(orderByColumn), orderDirection(user.id))
            .limit(pageSize)
            .offset(offset),
          context.db
            .select({ totalItems: count() })
            .from(schoolMemberTable)
            .innerJoin(user, eq(schoolMemberTable.userId, user.id))
            .where(where),
        ]);

        const memberIds = members.map(({ userId }) => userId);
        const roleRows =
          memberIds.length === 0
            ? []
            : await context.db
                .select({
                  userId: schoolUserRoleTable.userId,
                  role: schoolUserRoleTable.role,
                  meta: schoolUserRoleTable.meta,
                })
                .from(schoolUserRoleTable)
                .where(
                  and(
                    eq(schoolUserRoleTable.schoolId, input.schoolId),
                    inArray(schoolUserRoleTable.userId, memberIds),
                  ),
                )
                .orderBy(
                  asc(schoolUserRoleTable.userId),
                  asc(schoolUserRoleTable.role),
                );
        const rolesByUserId = new Map<
          string,
          Array<(typeof roleRows)[number]>
        >();
        for (const assignment of roleRows) {
          const assignments = rolesByUserId.get(assignment.userId) ?? [];
          assignments.push(assignment);
          rolesByUserId.set(assignment.userId, assignments);
        }

        const totalItems = totalRows[0]?.totalItems ?? 0;
        const totalPages = Math.ceil(totalItems / pageSize);
        return createPaginatedResult({
          items: await Promise.all(
            members.map(async (member) => {
              const { profileImageS3Key, ...memberDetails } = member;
              return schoolMemberDtoSchema.parse({
                schoolId: input.schoolId,
                ...memberDetails,
                profileImageUrl: profileImageS3Key
                  ? await createProfileImageUrl(profileImageS3Key)
                  : null,
                roles: (rolesByUserId.get(member.userId) ?? []).map(
                  ({ role, meta }) => ({ role, meta }),
                ),
              });
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

  getMember: protectedProcedure
    .route({
      summary: "Get a school member",
      description:
        "Get one school member and all role assignments by school and user identifier. Requires permission to read members in that school.",
      tags: ["School", "Members"],
    })
    .input(schoolMemberIdInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_MEMBER))
    .output(schoolMemberDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const member = await findSchoolMember(
          context.db,
          input.schoolId,
          input.userId,
        );
        if (!member) throw rpcError.notFound("School member");
        return member;
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  inviteMember: protectedProcedure
    .route({
      summary: "Invite a school member",
      description:
        "Atomically provision a user when needed, add the user to a school, and create the complete requested role-assignment set. Requires permission to invite members in that school.",
      tags: ["School", "Members"],
    })
    .input(inviteSchoolMemberInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.INVITE_MEMBER))
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

          if (invitedUser) {
            const existingMember = await findSchoolMember(
              transaction,
              input.schoolId,
              invitedUser.id,
            );
            if (existingMember) {
              throw rpcError.conflict("That user is already a member of this school.");
            }
          } else {
            // The Better Auth admin plugin provisions the user inside the same
            // transaction; there is intentionally no invitation lifecycle.
            const transactionalAuth = createAuth(transaction);
            const created = await transactionalAuth.api.createUser({
              // Better Auth requires the column, but the invited person owns
              // their display name and supplies it during account setup.
              // A school invitation is also the administrator's explicit
              // verification of this address. This allows Better Auth to link
              // the new user to a trusted Google identity with the same email.
              body: {
                email: input.email,
                name: "",
                data: { emailVerified: true },
              },
            });
            invitedUser = created.user;
          }

          await transaction.insert(schoolMemberTable).values({
            schoolId: input.schoolId,
            userId: invitedUser.id,
          });
          await transaction.insert(schoolUserRoleTable).values(
            input.roles.map(({ role, meta }) => ({
              schoolId: input.schoolId,
              userId: invitedUser.id,
              role,
              meta,
            })),
          );

          const member = await findSchoolMember(
            transaction,
            input.schoolId,
            invitedUser.id,
          );
          if (!member) throw rpcError.internal();
          return member;
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  updateMemberRoles: protectedProcedure
    .route({
      summary: "Replace school member roles",
      description:
        "Atomically replace a school member's complete role-assignment set; roles omitted from the request are removed. Requires permission to update member roles in that school.",
      tags: ["School", "Members"],
    })
    .input(updateSchoolMemberRolesInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.UPDATE_MEMBER_ROLES))
    .output(schoolMemberDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          const existingMember = await findSchoolMember(
            transaction,
            input.schoolId,
            input.userId,
          );
          if (!existingMember) throw rpcError.notFound("School member");

          // The supplied array is the complete desired assignment set. This
          // keeps omitted roles from lingering after an update.
          await transaction
            .delete(schoolUserRoleTable)
            .where(
              and(
                eq(schoolUserRoleTable.schoolId, input.schoolId),
                eq(schoolUserRoleTable.userId, input.userId),
              ),
            );
          await transaction.insert(schoolUserRoleTable).values(
            input.roles.map(({ role, meta }) => ({
              schoolId: input.schoolId,
              userId: input.userId,
              role,
              meta,
            })),
          );

          const member = await findSchoolMember(
            transaction,
            input.schoolId,
            input.userId,
          );
          if (!member) throw rpcError.internal();
          return member;
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  removeMember: protectedProcedure
    .route({
      summary: "Remove a school member",
      description:
        "Remove a member and that school's role assignments while retaining the global user account and memberships in other schools. Requires permission to remove members in that school.",
      tags: ["School", "Members"],
    })
    .input(schoolMemberIdInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.REMOVE_MEMBER))
    .output(schoolMemberDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          const member = await findSchoolMember(
            transaction,
            input.schoolId,
            input.userId,
          );
          if (!member) throw rpcError.notFound("School member");

          // The composite foreign key cascades only the school's role rows. The
          // global auth user remains because they may belong to other schools.
          await transaction
            .delete(schoolMemberTable)
            .where(
              and(
                eq(schoolMemberTable.schoolId, input.schoolId),
                eq(schoolMemberTable.userId, input.userId),
              ),
            );
          return member;
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
