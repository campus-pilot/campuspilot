import { classTable, sectionTable } from "@campuspilot/db/schema/class";
import { SCHOOL_ACTIONS } from "@campuspilot/opa/policies/school";
import { and, asc, count, eq, max, sql } from "drizzle-orm";

import { rpcError, toRpcError } from "../../../errors";
import { protectedProcedure } from "../../../index";
import { requireSchoolPermission } from "../../../permissions/school";
import {
  createSectionInputSchema,
  listSectionsInputSchema,
  listSectionsOutputSchema,
  reorderSectionsInputSchema,
  reorderSectionsOutputSchema,
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
        "List every section in a class in its explicit display order.",
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

        // A class has a small bounded set of sections, and the complete order
        // is required for drag-and-drop, so this list is unpaginated.
        const sections = await context.db
          .select()
          .from(sectionTable)
          .where(
            and(
              eq(sectionTable.schoolId, input.schoolId),
              eq(sectionTable.classId, input.classId),
            ),
          )
          .orderBy(asc(sectionTable.displayOrder), asc(sectionTable.id));
        return sections.map(toSectionDto);
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

          const [lastSection] = await transaction
            .select({ displayOrder: max(sectionTable.displayOrder) })
            .from(sectionTable)
            .where(
              and(
                eq(sectionTable.schoolId, input.schoolId),
                eq(sectionTable.classId, input.classId),
              ),
            );

          const [section] = await transaction
            .insert(sectionTable)
            .values({
              ...input,
              displayOrder: (lastSection?.displayOrder ?? 0) + 1,
            })
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
        "Update a section slug or label. Any role in the school may perform this mutation.",
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

  reorderSections: protectedProcedure
    .route({
      summary: "Reorder class sections",
      description:
        "Replace the complete section display order for a class. Requires permission to reorder sections.",
      tags: ["School", "Classes", "Sections"],
    })
    .input(reorderSectionsInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.REORDER_SECTIONS))
    .output(reorderSectionsOutputSchema)
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

          const existing = await transaction
            .select({ id: sectionTable.id })
            .from(sectionTable)
            .where(
              and(
                eq(sectionTable.schoolId, input.schoolId),
                eq(sectionTable.classId, input.classId),
              ),
            );
          const existingIds = new Set(existing.map(({ id }) => id));
          if (
            existingIds.size !== input.orderedSectionIds.length ||
            input.orderedSectionIds.some((id) => !existingIds.has(id))
          ) {
            throw rpcError.badRequest(
              "The section order must contain every section in the class exactly once.",
            );
          }

          await transaction
            .update(sectionTable)
            .set({ displayOrder: sql`-${sectionTable.displayOrder}` })
            .where(
              and(
                eq(sectionTable.schoolId, input.schoolId),
                eq(sectionTable.classId, input.classId),
              ),
            );
          for (const [index, sectionId] of input.orderedSectionIds.entries()) {
            await transaction
              .update(sectionTable)
              .set({ displayOrder: index + 1, updatedAt: new Date() })
              .where(
                and(
                  eq(sectionTable.schoolId, input.schoolId),
                  eq(sectionTable.classId, input.classId),
                  eq(sectionTable.id, sectionId),
                ),
              );
          }

          const reordered = await transaction
            .select()
            .from(sectionTable)
            .where(
              and(
                eq(sectionTable.schoolId, input.schoolId),
                eq(sectionTable.classId, input.classId),
              ),
            )
            .orderBy(asc(sectionTable.displayOrder), asc(sectionTable.id));
          return reordered.map(toSectionDto);
        });
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

          const remainingSections = await transaction
            .select({ id: sectionTable.id })
            .from(sectionTable)
            .where(
              and(
                eq(sectionTable.schoolId, input.schoolId),
                eq(sectionTable.classId, input.classId),
              ),
            )
            .orderBy(asc(sectionTable.displayOrder), asc(sectionTable.id));
          for (const [index, remaining] of remainingSections.entries()) {
            await transaction
              .update(sectionTable)
              .set({ displayOrder: index + 1 })
              .where(eq(sectionTable.id, remaining.id));
          }
          return toSectionDto(section);
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
