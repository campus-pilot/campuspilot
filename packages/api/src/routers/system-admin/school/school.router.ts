import { schoolTable } from "@campuspilot/db/schema/school";
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
  toSchoolDto,
  updateSchoolInputSchema,
} from "./school.dto";

export const schoolRouter = {
  listSchools: protectedProcedure
    .route({
      summary: "List schools",
      description:
        "List schools across the platform with pagination, text search, filtering by onboarding status, subscription tier (null: schools without one) and suspension, and deterministic sorting. Requires system-administrator permission.",
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
          input.filters?.tier === undefined
            ? undefined
            : input.filters.tier === null
              ? isNull(schoolTable.tier)
              : eq(schoolTable.tier, input.filters.tier);
        const suspendedCondition =
          input.filters?.suspended === undefined
            ? undefined
            : input.filters.suspended
              ? isNotNull(schoolTable.suspendedAt)
              : isNull(schoolTable.suspendedAt);
        const where = and(searchCondition, onboardingCondition, tierCondition, suspendedCondition);
        const orderByColumn = {
          name: schoolTable.name,
          location: schoolTable.location,
          createdAt: schoolTable.createdAt,
          updatedAt: schoolTable.updatedAt,
        }[input.orderBy.field];
        const orderDirection = input.orderBy.direction === "asc" ? asc : desc;

        const [schools, totalRows] = await Promise.all([
          context.db
            .select()
            .from(schoolTable)
            .where(where)
            .orderBy(orderDirection(orderByColumn), orderDirection(schoolTable.id))
            .limit(pageSize)
            .offset(offset),
          context.db.select({ totalItems: count() }).from(schoolTable).where(where),
        ]);
        const totalItems = totalRows[0]?.totalItems ?? 0;
        const totalPages = Math.ceil(totalItems / pageSize);

        return createPaginatedResult({
          items: schools.map(toSchoolDto),
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
        "Get one school by its identifier. Requires system-administrator permission.",
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
        const [school] = await context.db
          .select()
          .from(schoolTable)
          .where(eq(schoolTable.id, input.id))
          .limit(1);
        if (!school) throw rpcError.notFound("School");
        return toSchoolDto(school);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  addSchool: protectedProcedure
    .route({
      summary: "Create a school",
      description:
        "Create a new school with its identity, location, registration, subscription tier (plus, pro or enterprise) and optional logo-key data. Requires system-administrator permission.",
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
        const [school] = await context.db.insert(schoolTable).values(input).returning();
        if (!school) throw rpcError.internal();
        return toSchoolDto(school);
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
          .returning();
        if (!school) throw rpcError.notFound("School");
        return toSchoolDto(school);
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
            .returning();
          if (!school) throw rpcError.notFound("School");
          return toSchoolDto(school);
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
          .returning();
        if (!school) throw rpcError.notFound("School");
        return toSchoolDto(school);
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
        const [school] = await context.db
          .delete(schoolTable)
          .where(eq(schoolTable.id, input.id))
          .returning();
        if (!school) throw rpcError.notFound("School");
        return toSchoolDto(school);
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
