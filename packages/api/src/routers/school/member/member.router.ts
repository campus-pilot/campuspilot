import { createAuth } from "@campuspilot/auth/server";
import {
  generateStaffPassword,
  revokeStaffAccess,
  setStaffPassword,
  staffPlaceholderEmail,
} from "@campuspilot/auth/staff-login";
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
  inArray,
  ne,
  notExists,
  sql,
} from "drizzle-orm";

import { rpcError, toRpcError } from "../../../errors";
import { protectedProcedure } from "../../../index";
import {
  createNextPageCursor,
  createPaginatedResult,
  resolvePaginationInput,
} from "../../../paginations";
import { assertPermission } from "../../../permissions/authorization";
import { requireSchoolPermission } from "../../../permissions/school";
import {
  staffIdentityColumns,
  staffIdentitySearch,
  staffSignInSortKey,
  toStaffIdentity,
} from "../../../users/staff-identity";
import { createProfileImageUrl } from "../../auth/profile-image";
import {
  inviteSchoolMemberInputSchema,
  inviteSchoolMemberOutputSchema,
  issuedStaffPasswordSchema,
  listSchoolMembersInputSchema,
  listSchoolMembersOutputSchema,
  schoolMemberDtoSchema,
  schoolMemberIdInputSchema,
  updateSchoolMemberRolesInputSchema,
  type SchoolMemberDto,
} from "./member.dto";
import {
  grantsPrincipalRole,
  mayReceiveIssuedPassword,
} from "./member-password-policy";

/**
 * The one sign-in identifier an invitation names. The input schema already
 * guarantees exactly one is present.
 */
function inviteIdentityOf(input: { email?: string; phoneNumber?: string }) {
  if (input.phoneNumber !== undefined) {
    return { kind: "phone" as const, phoneNumber: input.phoneNumber };
  }
  if (input.email !== undefined) {
    return { kind: "email" as const, email: input.email };
  }
  throw rpcError.badRequest("Provide either an email address or a phone number.");
}

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
      ...staffIdentityColumns,
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
  const {
    profileImageS3Key,
    email,
    emailIsPlaceholder,
    phoneNumber,
    ...memberDetails
  } = member;

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
    ...toStaffIdentity({ email, emailIsPlaceholder, phoneNumber }),
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
        "List a school's members and all of their role assignments with pagination, name, email or phone-number search, and deterministic sorting. Requires permission to list members in that school.",
      tags: ["School", "Members"],
    })
    .meta({
      mcp: {
        exposure: "core",
        access: "read",
        destructive: false,
        module: "members",
      },
    })
    .input(listSchoolMembersInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.LIST_MEMBERS))
    .output(listSchoolMembersOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const { currentPage, pageSize, offset } = resolvePaginationInput(input);
        const searchCondition = input.searchQuery
          ? staffIdentitySearch(input.searchQuery)
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
          // The "Signs in with" column: never the hidden placeholder.
          email: staffSignInSortKey,
          addedAt: schoolMemberTable.addedAt,
        }[input.orderBy.field];
        const orderDirection = input.orderBy.direction === "asc" ? asc : desc;

        const [members, totalRows] = await Promise.all([
          context.db
            .select({
              userId: user.id,
              name: user.name,
              ...staffIdentityColumns,
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
              const {
                profileImageS3Key,
                email,
                emailIsPlaceholder,
                phoneNumber,
                ...memberDetails
              } = member;
              return schoolMemberDtoSchema.parse({
                schoolId: input.schoolId,
                ...memberDetails,
                ...toStaffIdentity({ email, emailIsPlaceholder, phoneNumber }),
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
    .meta({
      mcp: {
        exposure: "core",
        access: "read",
        destructive: false,
        module: "members",
      },
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
        "Atomically provision a user when needed, add the user to a school, and create the complete requested role-assignment set. Invite by exactly one of email or phone number. A new phone-number account is issued a password, returned once as issuedPassword. Requires permission to invite members in that school, and for phone numbers also permission to issue member passwords.",
      tags: ["School", "Members"],
    })
    .meta({
      mcp: {
        exposure: "advanced",
        access: "write",
        destructive: false,
        module: "members",
      },
    })
    .input(inviteSchoolMemberInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.INVITE_MEMBER))
    .output(inviteSchoolMemberOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        const identity = inviteIdentityOf(input);
        // A phone-number account can only sign in with a password, so
        // inviting by phone may issue one: that is its own permission,
        // checked in addition to inviting and before anything is written.
        // So is appointing a principal, who would hold that permission.
        // The password is returned in the result, so only a signed-in
        // person may receive it (this procedure is also an MCP tool).
        if (identity.kind === "phone" && !mayReceiveIssuedPassword(context.principal)) {
          throw rpcError.forbidden(
            "Invite staff by phone number from CampusPilot itself: it issues a password that only a signed-in person may receive.",
          );
        }
        if (
          identity.kind === "phone" ||
          grantsPrincipalRole([], input.roles.map(({ role }) => role))
        ) {
          await assertPermission(
            context,
            {
              action: SCHOOL_ACTIONS.ISSUE_MEMBER_PASSWORD,
              resource: { kind: "school", schoolId: input.schoolId },
            },
            signal,
          );
        }
        return await context.db.transaction(async (transaction) => {
          const [school] = await transaction
            .select({ id: schoolTable.id })
            .from(schoolTable)
            .where(eq(schoolTable.id, input.schoolId))
            .limit(1);
          if (!school) throw rpcError.notFound("School");

          let invitedUser = await transaction.query.user.findFirst({
            columns: { id: true },
            where:
              identity.kind === "email"
                ? eq(user.email, identity.email)
                : eq(user.phoneNumber, identity.phoneNumber),
          });
          let issuedPassword: string | null = null;

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
            // Better Auth requires a name, but the invited person owns their
            // display name and supplies it during account setup.
            const transactionalAuth = createAuth(transaction);
            if (identity.kind === "email") {
              // A school invitation is also the administrator's explicit
              // verification of this address. This allows Better Auth to link
              // the new user to a trusted Google identity with the same email.
              const created = await transactionalAuth.api.createUser({
                body: {
                  email: identity.email,
                  name: "",
                  data: { emailVerified: true },
                },
              });
              invitedUser = created.user;
            } else {
              // No email of their own: a placeholder fills Better Auth's
              // required column and is marked as one. The number is attested
              // by the inviting staff (no SMS), so it is written as verified.
              issuedPassword = generateStaffPassword();
              const created = await transactionalAuth.api.createUser({
                body: {
                  email: staffPlaceholderEmail(),
                  name: "",
                  password: issuedPassword,
                  data: {
                    emailIsPlaceholder: true,
                    phoneNumber: identity.phoneNumber,
                    phoneNumberVerified: true,
                  },
                },
              });
              invitedUser = created.user;
            }
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
          return { ...member, issuedPassword };
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  issueMemberPassword: protectedProcedure
    .route({
      summary: "Issue a school member password",
      description:
        "Set a new generated password for a member of this school, returned once, and sign them out everywhere including connected AI apps. Refused for your own account, platform administrators, and people who also belong to another school. Requires permission to issue member passwords in that school.",
      tags: ["School", "Members"],
    })
    // A reset returns a credential and signs a person out, so it stays a
    // human action (RPC only), like Cadet Portal password resets.
    .meta({
      mcp: {
        exposure: "hidden",
        access: "write",
        destructive: true,
        module: "members",
      },
    })
    .input(schoolMemberIdInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.ISSUE_MEMBER_PASSWORD))
    .output(issuedStaffPasswordSchema)
    .handler(async ({ context, input }) => {
      try {
        if (input.userId === context.session.user.id) {
          throw rpcError.badRequest(
            "Change your own password from your account settings.",
          );
        }
        const issued = await context.db.transaction(async (transaction) => {
          const member = await findSchoolMember(
            transaction,
            input.schoolId,
            input.userId,
          );
          if (!member) throw rpcError.notFound("School member");

          // Locks the account so a concurrent invitation to another school
          // cannot slip in between the check below and the password write.
          const [account] = await transaction
            .select({ role: user.role })
            .from(user)
            .where(eq(user.id, input.userId))
            .for("update");
          const [otherSchools] = await transaction
            .select({ value: count() })
            .from(schoolMemberTable)
            .where(
              and(
                eq(schoolMemberTable.userId, input.userId),
                ne(schoolMemberTable.schoolId, input.schoolId),
              ),
            );
          // A school may only take over accounts that are wholly its own:
          // otherwise a principal could reset the password of someone who
          // runs another school, or of a platform administrator.
          if (account?.role === "admin" || (otherSchools?.value ?? 0) > 0) {
            throw rpcError.forbidden(
              "This person also uses CampusPilot outside this school. Ask CampusPilot support to reset their password.",
            );
          }

          const password = generateStaffPassword();
          await setStaffPassword(transaction, {
            userId: input.userId,
            password,
          });
          return {
            userId: member.userId,
            name: member.name,
            email: member.email,
            phoneNumber: member.phoneNumber,
            password,
          };
        });
        // After commit, so a rolled-back reset never signs anyone out. If
        // this fails the caller gets an error and no password; issuing again
        // revokes again.
        await revokeStaffAccess([input.userId]);
        return issued;
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
    .meta({
      mcp: {
        exposure: "advanced",
        access: "write",
        destructive: true,
        module: "members",
      },
    })
    .input(updateSchoolMemberRolesInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.UPDATE_MEMBER_ROLES))
    .output(schoolMemberDtoSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          const existingMember = await findSchoolMember(
            transaction,
            input.schoolId,
            input.userId,
          );
          if (!existingMember) throw rpcError.notFound("School member");
          // A new principal holds password issuing, so appointing one needs
          // it too: a manager cannot promote themselves to take over staff
          // accounts.
          if (
            grantsPrincipalRole(
              existingMember.roles.map(({ role }) => role),
              input.roles.map(({ role }) => role),
            )
          ) {
            await assertPermission(
              context,
              {
                action: SCHOOL_ACTIONS.ISSUE_MEMBER_PASSWORD,
                resource: { kind: "school", schoolId: input.schoolId },
              },
              signal,
            );
          }

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
    .meta({
      mcp: {
        exposure: "advanced",
        access: "write",
        destructive: true,
        module: "members",
      },
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
