import { joinActiveBillingPeriod } from "@campuspilot/db/feature-flags/store";
import { schoolTable } from "@campuspilot/db/schema/school";
import { schoolBillingPeriodTable } from "@campuspilot/db/schema/school-billing";
import { schoolUserRoleTable } from "@campuspilot/db/schema/school-user-role";
import { SYSTEM_ACTIONS } from "@campuspilot/opa/policies/system";
import { and, asc, count, desc, eq, ilike, isNotNull, isNull, or } from "drizzle-orm";

import { toRpcError, rpcError } from "../../../errors";
import { protectedProcedure } from "../../../index";
import {
  createNextPageCursor,
  createPaginatedResult,
  resolvePaginationInput,
} from "../../../paginations";
import { requireSystemPermission } from "../../../permissions/system";
import {
  addSchoolInputSchema,
  listSchoolsInputSchema,
  listSchoolsOutputSchema,
  schoolDtoSchema,
  schoolIdInputSchema,
  suspendSchoolInputSchema,
  updateSchoolInputSchema,
  updateSchoolOwnerInputSchema,
} from "./school.dto";
import { readSchoolDto, schoolRowToDto, selectSchoolsWithActivePeriod } from "./school.read";
import { lockSchool, parseTrialEnd, startTrialPeriod } from "../../../billing/billing.service";

/** The school as the admin DTO after a change; NOT_FOUND when it does not exist. */
async function requireSchoolDto(db: Parameters<typeof readSchoolDto>[0], schoolId: string) {
  const school = await readSchoolDto(db, schoolId);
  if (!school) throw rpcError.notFound("School");
  return school;
}

export const schoolRouter = {
  listSchools: protectedProcedure
    .route({
      summary: "List schools",
      description:
        "List schools across the platform with pagination, text search, filtering by onboarding status, standing tier (null: schools without one), suspension and plan state (in a trial or a paid period, or no plan at all), and deterministic sorting. Each school carries its standing tier, its active billing period and the plan they give. Requires system-administrator permission.",
      tags: ["System Admin", "Schools"],
    })
    .meta({
      mcp: {
        exposure: "advanced",
        access: "read",
        destructive: false,
        module: "platform",
      },
    })
    .input(listSchoolsInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.LIST_SCHOOLS))
    .output(listSchoolsOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const { currentPage, pageSize, offset } = resolvePaginationInput(input);
        const searchCondition = input.searchQuery
          ? or(
              ilike(schoolTable.name, `%${input.searchQuery}%`),
              ilike(schoolTable.slug, `%${input.searchQuery}%`),
              ilike(schoolTable.location, `%${input.searchQuery}%`),
              ilike(schoolTable.registrationNo, `%${input.searchQuery}%`),
            )
          : undefined;
        const onboardingCondition =
          input.filters?.hasCompletedOnboarding === undefined
            ? undefined
            : eq(
                schoolTable.hasCompletedOnboarding,
                input.filters.hasCompletedOnboarding,
              );
        const tierCondition =
          input.filters?.subscribedTier === undefined
            ? undefined
            : input.filters.subscribedTier === null
              ? isNull(schoolTable.tier)
              : eq(schoolTable.tier, input.filters.subscribedTier);
        const suspendedCondition =
          input.filters?.suspended === undefined
            ? undefined
            : input.filters.suspended
              ? isNotNull(schoolTable.suspendedAt)
              : isNull(schoolTable.suspendedAt);
        // `school_billing_period` is joined with the active-period condition: a null id means no active period.
        const planCondition =
          input.filters?.plan === undefined
            ? undefined
            : input.filters.plan === "none"
              ? and(isNull(schoolTable.tier), isNull(schoolBillingPeriodTable.id))
              : eq(schoolBillingPeriodTable.kind, input.filters.plan);
        const where = and(searchCondition, onboardingCondition, tierCondition, suspendedCondition, planCondition);
        const orderByColumn = {
          name: schoolTable.name,
          location: schoolTable.location,
          createdAt: schoolTable.createdAt,
          updatedAt: schoolTable.updatedAt,
        }[input.orderBy.field];
        const orderDirection = input.orderBy.direction === "asc" ? asc : desc;

        const [schools, totalRows] = await Promise.all([
          selectSchoolsWithActivePeriod(context.db)
            .where(where)
            .orderBy(orderDirection(orderByColumn), orderDirection(schoolTable.id))
            .limit(pageSize)
            .offset(offset),
          context.db
            .select({ totalItems: count() })
            .from(schoolTable)
            .leftJoin(schoolBillingPeriodTable, joinActiveBillingPeriod())
            .where(where),
        ]);
        const totalItems = totalRows[0]?.totalItems ?? 0;
        const totalPages = Math.ceil(totalItems / pageSize);

        return createPaginatedResult({
          items: schools.map(schoolRowToDto),
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

  getSchool: protectedProcedure
    .route({
      summary: "Get a school",
      description:
        "Get one school by its identifier, with its subscribed tier, its active trial and the plan they give. Requires system-administrator permission.",
      tags: ["System Admin", "Schools"],
    })
    .meta({
      mcp: {
        exposure: "advanced",
        access: "read",
        destructive: false,
        module: "platform",
      },
    })
    .input(schoolIdInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.READ_SCHOOL))
    .output(schoolDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await requireSchoolDto(context.db, input.id);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  addSchool: protectedProcedure
    .route({
      summary: "Create a school",
      description:
        "Create a new school with its identity, location, registration, optional subscribed tier (plus, pro or enterprise; none when left out), an optional trial of a tier started at once, and optional logo-key data. A school created with neither a tier nor a trial has no plan: its staff can read but not change anything until it gets one. Requires system-administrator permission.",
      tags: ["System Admin", "Schools"],
    })
    .meta({
      mcp: {
        exposure: "advanced",
        access: "write",
        destructive: false,
        module: "platform",
      },
    })
    .input(addSchoolInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.CREATE_SCHOOL))
    .output(schoolDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const { trial, tier, ...identity } = input;
        // Checked before anything is written, so a refused end creates no school.
        const trialEndsAt = trial ? parseTrialEnd(trial.endsAt) : null;
        return await context.db.transaction(async (transaction) => {
          const [school] = await transaction
            .insert(schoolTable)
            .values({ ...identity, tier: tier ?? null })
            .returning({ id: schoolTable.id });
          if (!school) throw rpcError.internal();
          if (trial && trialEndsAt) {
            await startTrialPeriod(transaction, {
              schoolId: school.id,
              tier: trial.tier,
              endsAt: trialEndsAt,
              createdBy: context.session.user.id,
            });
          }
          return await requireSchoolDto(transaction, school.id);
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  updateSchool: protectedProcedure
    .route({
      summary: "Update a school",
      description:
        "Update the explicitly supplied fields of an existing school. Requires system-administrator permission.",
      tags: ["System Admin", "Schools"],
    })
    .meta({
      mcp: {
        exposure: "advanced",
        access: "write",
        destructive: true,
        module: "platform",
      },
    })
    .input(updateSchoolInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.UPDATE_SCHOOL))
    .output(schoolDtoSchema)
    .handler(async ({ context, input }) => {
      const { id, ...changes } = input;
      try {
        const [school] = await context.db
          .update(schoolTable)
          .set({ ...changes, updatedAt: new Date() })
          .where(eq(schoolTable.id, id))
          .returning({ id: schoolTable.id });
        if (!school) throw rpcError.notFound("School");
        return await requireSchoolDto(context.db, school.id);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  suspendSchool: protectedProcedure
    .route({
      summary: "Suspend a school",
      description:
        "Suspend a school that misuses the platform, with the reason. A suspended school is read-only: its staff and students can still sign in and view everything, but every change is refused, in the management app, the Cadet Portal, the AI assistant and connected AI apps, and they are told to contact support. Nothing is deleted. Suspending an already suspended school replaces the reason. Requires system-administrator permission.",
      tags: ["System Admin", "Schools"],
    })
    // Hidden from MCP: taking a school's ability to work away is a human
    // platform decision, made in the admin app.
    .meta({
      mcp: {
        exposure: "hidden",
        access: "write",
        destructive: true,
        module: "platform",
      },
    })
    .input(suspendSchoolInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.UPDATE_SCHOOL))
    .output(schoolDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          const [current] = await transaction
            .select({ suspendedAt: schoolTable.suspendedAt })
            .from(schoolTable)
            .where(eq(schoolTable.id, input.id))
            .limit(1)
            .for("update");
          if (!current) throw rpcError.notFound("School");
          const now = new Date();
          const [school] = await transaction
            .update(schoolTable)
            .set({
              // The moment it was first suspended is kept when only the reason changes.
              suspendedAt: current.suspendedAt ?? now,
              suspendedReason: input.reason,
              suspendedBy: context.session.user.id,
              updatedAt: now,
            })
            .where(eq(schoolTable.id, input.id))
            .returning({ id: schoolTable.id });
          if (!school) throw rpcError.notFound("School");
          return await requireSchoolDto(transaction, school.id);
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  unsuspendSchool: protectedProcedure
    .route({
      summary: "Lift a school's suspension",
      description:
        "Lift the suspension of a school: its staff and students can change things again at once. Does nothing to a school that is not suspended. Requires system-administrator permission.",
      tags: ["System Admin", "Schools"],
    })
    .meta({
      mcp: {
        exposure: "hidden",
        access: "write",
        destructive: false,
        module: "platform",
      },
    })
    .input(schoolIdInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.UPDATE_SCHOOL))
    .output(schoolDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const [school] = await context.db
          .update(schoolTable)
          .set({ suspendedAt: null, suspendedReason: null, suspendedBy: null, updatedAt: new Date() })
          .where(eq(schoolTable.id, input.id))
          .returning({ id: schoolTable.id });
        if (!school) throw rpcError.notFound("School");
        return await requireSchoolDto(context.db, school.id);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  updateSchoolOwner: protectedProcedure
    .route({
      summary: "Change a school's owner",
      description:
        "Name the school's owner, who must be a member holding the principal role, or clear it with null. The owner cannot be removed from the school or lose the principal role through school procedures. It does not change anyone's school creation allowance. Requires system-administrator permission.",
      tags: ["System Admin", "Schools"],
    })
    .meta({
      mcp: {
        exposure: "hidden",
        access: "write",
        destructive: true,
        module: "platform",
      },
    })
    .input(updateSchoolOwnerInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.UPDATE_SCHOOL))
    .output(schoolDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          // Locked before the principal check: a member removal or role change
          // holds the row while it reads who owns the school, so the check and
          // the owner guards never pass on each other's stale view.
          await lockSchool(transaction, input.id);
          if (input.ownerUserId !== null) {
            const [principal] = await transaction
              .select({ userId: schoolUserRoleTable.userId })
              .from(schoolUserRoleTable)
              .where(
                and(
                  eq(schoolUserRoleTable.schoolId, input.id),
                  eq(schoolUserRoleTable.userId, input.ownerUserId),
                  eq(schoolUserRoleTable.role, "principal"),
                ),
              )
              .limit(1);
            if (!principal) {
              throw rpcError.badRequest("The owner must be a member of this school with the principal role.");
            }
          }
          const [school] = await transaction
            .update(schoolTable)
            .set({ ownerUserId: input.ownerUserId, updatedAt: new Date() })
            .where(eq(schoolTable.id, input.id))
            .returning({ id: schoolTable.id });
          if (!school) throw rpcError.notFound("School");
          return await requireSchoolDto(transaction, school.id);
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  deleteSchool: protectedProcedure
    .route({
      summary: "Delete a school",
      description:
        "Permanently delete a school by its identifier. Requires system-administrator permission.",
      tags: ["System Admin", "Schools"],
    })
    .meta({
      mcp: {
        exposure: "advanced",
        access: "write",
        destructive: true,
        module: "platform",
      },
    })
    .input(schoolIdInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.DELETE_SCHOOL))
    .output(schoolDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          // Read before the delete: its trials go with it.
          const school = await requireSchoolDto(transaction, input.id);
          await transaction.delete(schoolTable).where(eq(schoolTable.id, input.id));
          return school;
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
