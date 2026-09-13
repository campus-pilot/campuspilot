import { schoolTable } from "@campuspilot/db/schema/school";
import { and, asc, count, desc, eq, ilike, or } from "drizzle-orm";

import { toRpcError, rpcError } from "../../../errors";
import { systemAdminProcedure } from "../../../index";
import {
  createNextPageCursor,
  createPaginatedResult,
  resolvePaginationInput,
} from "../../../paginations";
import {
  addSchoolInputSchema,
  listSchoolsInputSchema,
  listSchoolsOutputSchema,
  schoolDtoSchema,
  schoolIdInputSchema,
  toSchoolDto,
  updateSchoolInputSchema,
} from "./school.dto";

export const schoolRouter = {
  listSchools: systemAdminProcedure
    .input(listSchoolsInputSchema)
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
        const where = and(searchCondition, onboardingCondition);
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

  getSchool: systemAdminProcedure
    .input(schoolIdInputSchema)
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

  addSchool: systemAdminProcedure
    .input(addSchoolInputSchema)
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

  updateSchool: systemAdminProcedure
    .input(updateSchoolInputSchema)
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

  deleteSchool: systemAdminProcedure
    .input(schoolIdInputSchema)
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
