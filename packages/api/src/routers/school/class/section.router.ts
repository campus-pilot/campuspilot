import { classTable, sectionTable } from "@campuspilot/db/schema/class";
import { SCHOOL_ACTIONS } from "@campuspilot/opa/policies/school";
import { and, asc, count, desc, eq, ilike, or } from "drizzle-orm";

import { rpcError, toRpcError } from "../../../errors";
import { protectedProcedure } from "../../../index";
import {
  createNextPageCursor,
  createPaginatedResult,
  resolvePaginationInput,
} from "../../../paginations";
import { requireSchoolPermission } from "../../../permissions/school";
import {
  createSectionInputSchema,
  listSectionsInputSchema,
  listSectionsOutputSchema,
  sectionDtoSchema,
  sectionIdInputSchema,
  toSectionDto,
  updateSectionAttributesInputSchema,
  updateSectionInputSchema,
} from "./class.dto";

export const schoolSectionRouter = {
  listSections: protectedProcedure
    .route({
      summary: "List class sections",
      description:
        "List one class's sections with pagination, search, and deterministic sorting.",
      tags: ["School", "Classes", "Sections"],
    })
    .input(listSectionsInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.LIST_SECTIONS))
    .output(listSectionsOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const [schoolClass] = await context.db
          .select({ id: classTable.id })
          .from(classTable)
          .where(
            and(
              eq(classTable.schoolId, input.schoolId),
              eq(classTable.id, input.classId),
            ),
          )
          .limit(1);
        if (!schoolClass) throw rpcError.notFound("Class");

        const { currentPage, pageSize, offset } = resolvePaginationInput(input);
        const searchCondition = input.searchQuery
          ? or(
              ilike(sectionTable.slug, `%${input.searchQuery}%`),
              ilike(sectionTable.label, `%${input.searchQuery}%`),
            )
          : undefined;
        const where = and(
          eq(sectionTable.schoolId, input.schoolId),
          eq(sectionTable.classId, input.classId),
          searchCondition,
        );
        const orderByColumn = {
          slug: sectionTable.slug,
          label: sectionTable.label,
          createdAt: sectionTable.createdAt,
          updatedAt: sectionTable.updatedAt,
        }[input.orderBy.field];
        const orderDirection = input.orderBy.direction === "asc" ? asc : desc;

        const [sections, totalRows] = await Promise.all([
          context.db
            .select()
            .from(sectionTable)
            .where(where)
            .orderBy(
              orderDirection(orderByColumn),
              orderDirection(sectionTable.id),
            )
            .limit(pageSize)
            .offset(offset),
          context.db
            .select({ totalItems: count() })
            .from(sectionTable)
            .where(where),
        ]);
        const totalItems = totalRows[0]?.totalItems ?? 0;
        const totalPages = Math.ceil(totalItems / pageSize);

        return createPaginatedResult({
          items: sections.map(toSectionDto),
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

  getSection: protectedProcedure
    .route({
      summary: "Get a class section",
      description:
        "Get one section by its school, class, and section identifiers.",
      tags: ["School", "Classes", "Sections"],
    })
    .input(sectionIdInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_SECTION))
    .output(sectionDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const [section] = await context.db
          .select()
          .from(sectionTable)
          .where(
            and(
              eq(sectionTable.schoolId, input.schoolId),
              eq(sectionTable.classId, input.classId),
              eq(sectionTable.id, input.sectionId),
            ),
          )
          .limit(1);
        if (!section) throw rpcError.notFound("Section");
        return toSectionDto(section);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  createSection: protectedProcedure
    .route({
      summary: "Create a class section",
      description:
        "Create an additional section after validating that its class belongs to the requested school.",
      tags: ["School", "Classes", "Sections"],
    })
    .input(createSectionInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.CREATE_SECTION))
    .output(sectionDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          // Section creation and deletion lock the parent class so concurrent
          // mutations cannot violate the minimum-one-section invariant.
          const [schoolClass] = await transaction
            .select({ id: classTable.id })
            .from(classTable)
            .where(
              and(
                eq(classTable.schoolId, input.schoolId),
                eq(classTable.id, input.classId),
              ),
            )
            .for("update")
            .limit(1);
          if (!schoolClass) throw rpcError.notFound("Class");

          const [section] = await transaction
            .insert(sectionTable)
            .values(input)
            .returning();
          if (!section) throw rpcError.internal();
          return toSectionDto(section);
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  updateSection: protectedProcedure
    .route({
      summary: "Update a class section",
      description:
        "Update a section slug or label. This structural mutation is restricted to school managers and principals.",
      tags: ["School", "Classes", "Sections"],
    })
    .input(updateSectionInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.UPDATE_SECTION))
    .output(sectionDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const { schoolId, classId, sectionId, ...changes } = input;
        const [section] = await context.db
          .update(sectionTable)
          .set({ ...changes, updatedAt: new Date() })
          .where(
            and(
              eq(sectionTable.schoolId, schoolId),
              eq(sectionTable.classId, classId),
              eq(sectionTable.id, sectionId),
            ),
          )
          .returning();
        if (!section) throw rpcError.notFound("Section");
        return toSectionDto(section);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  updateSectionAttributes: protectedProcedure
    .route({
      summary: "Update section attributes",
      description:
        "Replace a section's attributes. Any role in the school may perform this mutation.",
      tags: ["School", "Classes", "Sections"],
    })
    .input(updateSectionAttributesInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.UPDATE_SECTION_ATTRIBUTES))
    .output(sectionDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const { schoolId, classId, sectionId, attributes } = input;
        const [section] = await context.db
          .update(sectionTable)
          .set({ attributes, updatedAt: new Date() })
          .where(
            and(
              eq(sectionTable.schoolId, schoolId),
              eq(sectionTable.classId, classId),
              eq(sectionTable.id, sectionId),
            ),
          )
          .returning();
        if (!section) throw rpcError.notFound("Section");
        return toSectionDto(section);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  deleteSection: protectedProcedure
    .route({
      summary: "Delete a class section",
      description:
        "Delete a section while preserving the class's minimum of one section.",
      tags: ["School", "Classes", "Sections"],
    })
    .input(sectionIdInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.DELETE_SECTION))
    .output(sectionDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          const [schoolClass] = await transaction
            .select({ id: classTable.id })
            .from(classTable)
            .where(
              and(
                eq(classTable.schoolId, input.schoolId),
                eq(classTable.id, input.classId),
              ),
            )
            .for("update")
            .limit(1);
          if (!schoolClass) throw rpcError.notFound("Class");

          const [sectionRows, totalRows] = await Promise.all([
            transaction
              .select({ id: sectionTable.id })
              .from(sectionTable)
              .where(
                and(
                  eq(sectionTable.schoolId, input.schoolId),
                  eq(sectionTable.classId, input.classId),
                  eq(sectionTable.id, input.sectionId),
                ),
              )
              .limit(1),
            transaction
              .select({ totalItems: count() })
              .from(sectionTable)
              .where(
                and(
                  eq(sectionTable.schoolId, input.schoolId),
                  eq(sectionTable.classId, input.classId),
                ),
              ),
          ]);
          if (!sectionRows[0]) throw rpcError.notFound("Section");
          if ((totalRows[0]?.totalItems ?? 0) <= 1) {
            throw rpcError.badRequest(
              "A class must retain at least one section.",
            );
          }

          const [section] = await transaction
            .delete(sectionTable)
            .where(
              and(
                eq(sectionTable.schoolId, input.schoolId),
                eq(sectionTable.classId, input.classId),
                eq(sectionTable.id, input.sectionId),
              ),
            )
            .returning();
          if (!section) throw rpcError.notFound("Section");
          return toSectionDto(section);
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
