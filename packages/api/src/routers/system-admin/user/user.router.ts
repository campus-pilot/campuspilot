import {
  generateStaffPassword,
  revokeStaffAccess,
  setStaffPassword,
} from "@campuspilot/auth/staff-login";
import type { DatabaseExecutor } from "@campuspilot/db";
import { account, user } from "@campuspilot/db/schema/auth";
import { schoolTable } from "@campuspilot/db/schema/school";
import { schoolMemberTable } from "@campuspilot/db/schema/school-member";
import { SYSTEM_ACTIONS } from "@campuspilot/opa/policies/system";
import { and, asc, count, desc, eq, inArray, ne } from "drizzle-orm";

import { rpcError, toRpcError } from "../../../errors";
import { platformAdminProcedure } from "../../../index";
import {
  createNextPageCursor,
  createPaginatedResult,
  resolvePaginationInput,
} from "../../../paginations";
import { requireSystemPermission } from "../../../permissions/system";
import {
  staffIdentityColumns,
  staffIdentitySearch,
  toStaffIdentity,
} from "../../../users/staff-identity";
import {
  issuedStaffPasswordSchema,
  listUsersInputSchema,
  listUsersOutputSchema,
  platformUserDtoSchema,
  setUserPasswordInputSchema,
  updateUserSignInInputSchema,
} from "./user.dto";

type PlatformUserRow = {
  userId: string;
  name: string;
  email: string;
  emailIsPlaceholder: boolean;
  phoneNumber: string | null;
  createdAt: Date;
};

const platformUserColumns = {
  userId: user.id,
  name: user.name,
  ...staffIdentityColumns,
  createdAt: user.createdAt,
};

/**
 * Platform-wide user accounts for administrators: find a person by name,
 * email or phone number, set their password, and change what they sign in
 * with. Every procedure is RPC only (hidden from MCP): they return
 * credentials or change how someone signs in, so they stay human actions.
 */
export const userRouter = {
  listUsers: platformAdminProcedure
    .route({
      summary: "List users",
      description:
        "List every user account with its sign-in identifiers, whether a password or Google is set up, and its schools, with name, email or phone-number search. Requires system-administrator permission.",
      tags: ["System Admin", "Users"],
    })
    .meta({
      mcp: {
        exposure: "hidden",
        access: "read",
        destructive: false,
        module: "platform",
      },
    })
    .input(listUsersInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.LIST_USERS))
    .output(listUsersOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const { currentPage, pageSize, offset } = resolvePaginationInput(input);
        const where = input.searchQuery
          ? staffIdentitySearch(input.searchQuery)
          : undefined;
        const orderByColumn = {
          name: user.name,
          createdAt: user.createdAt,
        }[input.orderBy.field];
        const orderDirection = input.orderBy.direction === "asc" ? asc : desc;

        const [users, totalRows] = await Promise.all([
          context.db
            .select(platformUserColumns)
            .from(user)
            .where(where)
            .orderBy(orderDirection(orderByColumn), orderDirection(user.id))
            .limit(pageSize)
            .offset(offset),
          context.db.select({ totalItems: count() }).from(user).where(where),
        ]);

        const totalItems = totalRows[0]?.totalItems ?? 0;
        const totalPages = Math.ceil(totalItems / pageSize);
        return createPaginatedResult({
          items: await toPlatformUsers(context.db, users),
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

  setUserPassword: platformAdminProcedure
    .route({
      summary: "Set a user's password",
      description:
        "Set a user's password, or generate one when none is given, return it once, and sign the user out everywhere including connected AI apps. Phone and email sign-in share this password. Not for your own account. Requires system-administrator permission.",
      tags: ["System Admin", "Users"],
    })
    .meta({
      mcp: {
        exposure: "hidden",
        access: "write",
        destructive: true,
        module: "platform",
      },
    })
    .input(setUserPasswordInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.SET_USER_PASSWORD))
    .output(issuedStaffPasswordSchema)
    .handler(async ({ context, input }) => {
      try {
        // Revoking would sign the administrator out of this very session.
        if (input.userId === context.session.user.id) {
          throw rpcError.badRequest(
            "Change your own password from your account settings.",
          );
        }
        const issued = await context.db.transaction(async (transaction) => {
          const [target] = await transaction
            .select({ userId: user.id, name: user.name, ...staffIdentityColumns })
            .from(user)
            .where(eq(user.id, input.userId))
            .limit(1);
          if (!target) throw rpcError.notFound("User");

          const password = input.password ?? generateStaffPassword();
          await setStaffPassword(transaction, {
            userId: target.userId,
            password,
          });
          return {
            userId: target.userId,
            name: target.name,
            ...toStaffIdentity(target),
            password,
          };
        });
        // After commit, so a rolled-back change never signs anyone out. If
        // this fails the caller gets an error; setting it again revokes again.
        await revokeStaffAccess([input.userId]);
        return issued;
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  updateUserSignIn: platformAdminProcedure
    .route({
      summary: "Update a user's sign-in details",
      description:
        "Replace a user's sign-in email and phone number. A new email is treated as verified, so Google sign-in with that address links to the account. A real email can be changed but not removed; the phone number can be removed only while a real email remains. Requires system-administrator permission.",
      tags: ["System Admin", "Users"],
    })
    .meta({
      mcp: {
        exposure: "hidden",
        access: "write",
        destructive: true,
        module: "platform",
      },
    })
    .input(updateUserSignInInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.UPDATE_USER_SIGN_IN))
    .output(platformUserDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        await context.db.transaction(async (transaction) => {
          const [target] = await transaction
            .select({ ...staffIdentityColumns })
            .from(user)
            .where(eq(user.id, input.userId))
            .for("update");
          if (!target) throw rpcError.notFound("User");

          if (input.email === null && !target.emailIsPlaceholder) {
            throw rpcError.badRequest(
              "An email address cannot be removed. Enter a different one to change it.",
            );
          }
          if (input.email !== null) {
            const [taken] = await transaction
              .select({ id: user.id })
              .from(user)
              .where(and(eq(user.email, input.email), ne(user.id, input.userId)))
              .limit(1);
            if (taken) {
              throw rpcError.conflict("Another account already uses this email address.");
            }
          }
          if (input.phoneNumber !== null) {
            const [taken] = await transaction
              .select({ id: user.id })
              .from(user)
              .where(
                and(
                  eq(user.phoneNumber, input.phoneNumber),
                  ne(user.id, input.userId),
                ),
              )
              .limit(1);
            if (taken) {
              throw rpcError.conflict("Another account already uses this phone number.");
            }
          }

          const emailChange =
            input.email === null
              ? {}
              : input.email === target.email && !target.emailIsPlaceholder
                ? {}
                : // An administrator entering the address is its
                  // verification, as with school invitations; Better Auth then
                  // links a Google sign-in with the same email.
                  { email: input.email, emailIsPlaceholder: false, emailVerified: true };
          await transaction
            .update(user)
            .set({
              ...emailChange,
              phoneNumber: input.phoneNumber,
              // Attested by the administrator; CampusPilot sends no SMS.
              phoneNumberVerified: input.phoneNumber !== null,
              updatedAt: new Date(),
            })
            .where(eq(user.id, input.userId));
        });

        const rows = await context.db
          .select(platformUserColumns)
          .from(user)
          .where(eq(user.id, input.userId))
          .limit(1);
        const [updated] = await toPlatformUsers(context.db, rows);
        if (!updated) throw rpcError.notFound("User");
        return updated;
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};

/**
 * Users as the Users table shows them: sign-in identifiers, whether a
 * password (a credential account with a hash) or Google is linked, and their
 * schools by name. Two queries for the whole page, never one per user.
 */
async function toPlatformUsers(
  db: DatabaseExecutor,
  rows: readonly PlatformUserRow[],
) {
  const userIds = rows.map(({ userId }) => userId);
  if (userIds.length === 0) return [];
  const [accountRows, schoolRows] = await Promise.all([
    db
      .select({
        userId: account.userId,
        providerId: account.providerId,
        password: account.password,
      })
      .from(account)
      .where(inArray(account.userId, userIds)),
    db
      .select({
        userId: schoolMemberTable.userId,
        schoolId: schoolTable.id,
        name: schoolTable.name,
      })
      .from(schoolMemberTable)
      .innerJoin(schoolTable, eq(schoolTable.id, schoolMemberTable.schoolId))
      .where(inArray(schoolMemberTable.userId, userIds))
      .orderBy(asc(schoolTable.name)),
  ]);

  return rows.map((row) => {
    const accounts = accountRows.filter((item) => item.userId === row.userId);
    return platformUserDtoSchema.parse({
      userId: row.userId,
      name: row.name,
      ...toStaffIdentity(row),
      hasPassword: accounts.some(
        (item) => item.providerId === "credential" && item.password !== null,
      ),
      hasGoogle: accounts.some((item) => item.providerId === "google"),
      schools: schoolRows
        .filter((item) => item.userId === row.userId)
        .map(({ schoolId, name }) => ({ schoolId, name })),
      createdAt: row.createdAt,
    });
  });
}
