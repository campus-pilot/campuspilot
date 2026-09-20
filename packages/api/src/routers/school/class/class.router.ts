import { classTable, sectionTable } from "@campuspilot/db/schema/class";
import { schoolTable } from "@campuspilot/db/schema/school";
import { schoolSessionTable } from "@campuspilot/db/schema/session";
import { SCHOOL_ACTIONS } from "@campuspilot/opa/policies/school";
import { and, asc, count, desc, eq, ilike, or, sql } from "drizzle-orm";

import { rpcError, toRpcError } from "../../../errors";
import { protectedProcedure } from "../../../index";
import {
  createNextPageCursor,
  createPaginatedResult,
  resolvePaginationInput,
} from "../../../paginations";
import { requireSchoolPermission } from "../../../permissions/school";
import {
  classDtoSchema,
  classIdInputSchema,
  createClassInputSchema,
  listClassesInputSchema,
  listClassesOutputSchema,
  toClassDto,
  updateClassConfigurationInputSchema,
  updateClassInputSchema,
} from "./class.dto";

export const schoolClassRouter = {
  listClasses: protectedProcedure
    .route({
      summary: "List school classes",
      description:
        "List a school's classes with pagination, search, and deterministic sorting.",
      tags: ["School", "Classes"],
    })
    .input(listClassesInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.LIST_CLASSES))
    .output(listClassesOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const { currentPage, pageSize, offset } = resolvePaginationInput(input);
        const searchCondition = input.searchQuery
          ? or(
              ilike(classTable.slug, `%${input.searchQuery}%`),
              ilike(classTable.label, `%${input.searchQuery}%`),
            )
          : undefined;
        const where = and(
          eq(classTable.schoolId, input.schoolId),
          searchCondition,
        );
        const orderByColumn = {
          slug: classTable.slug,
          label: classTable.label,
          createdAt: classTable.createdAt,
          updatedAt: classTable.updatedAt,
        }[input.orderBy.field];
        const orderDirection = input.orderBy.direction === "asc" ? asc : desc;

        const [classes, totalRows] = await Promise.all([
          context.db
            .select()
            .from(classTable)
            .where(where)
            .orderBy(orderDirection(orderByColumn), orderDirection(classTable.id))
            .limit(pageSize)
            .offset(offset),
          context.db
            .select({ totalItems: count() })
            .from(classTable)
            .where(where),
        ]);
        const totalItems = totalRows[0]?.totalItems ?? 0;
        const totalPages = Math.ceil(totalItems / pageSize);

        return createPaginatedResult({
          items: classes.map(toClassDto),
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

  getClass: protectedProcedure
    .route({
      summary: "Get a school class",
      description: "Get one class by its school and class identifiers.",
      tags: ["School", "Classes"],
    })
    .input(classIdInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_CLASS))
    .output(classDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const [schoolClass] = await context.db
          .select()
          .from(classTable)
          .where(
            and(
              eq(classTable.schoolId, input.schoolId),
              eq(classTable.id, input.classId),
            ),
          )
          .limit(1);
        if (!schoolClass) throw rpcError.notFound("Class");
        return toClassDto(schoolClass);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  createClass: protectedProcedure
    .route({
      summary: "Create a school class",
      description:
        "Atomically create a class and at least one initial section in a school.",
      tags: ["School", "Classes"],
    })
    .input(createClassInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.CREATE_CLASS))
    .output(classDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          const [school] = await transaction
            .select({ id: schoolTable.id })
            .from(schoolTable)
            .where(eq(schoolTable.id, input.schoolId))
            .limit(1);
          if (!school) throw rpcError.notFound("School");

          const { sections, schoolId, ...values } = input;
          const [schoolClass] = await transaction
            .insert(classTable)
            .values({ schoolId, ...values })
            .returning();
          if (!schoolClass) throw rpcError.internal();

          await transaction.insert(sectionTable).values(
            sections.map((section) => ({
              ...section,
              schoolId,
              classId: schoolClass.id,
            })),
          );

          return toClassDto(schoolClass);
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  updateClass: protectedProcedure
    .route({
      summary: "Update a school class",
      description:
        "Update a class slug or label. This structural mutation is restricted to school managers and principals.",
      tags: ["School", "Classes"],
    })
    .input(updateClassInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.UPDATE_CLASS))
    .output(classDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          const { schoolId, classId, ...changes } = input;
          const [existingClass] = await transaction
            .select({ slug: classTable.slug })
            .from(classTable)
            .where(
              and(
                eq(classTable.schoolId, schoolId),
                eq(classTable.id, classId),
              ),
            )
            .for("update")
            .limit(1);
          if (!existingClass) throw rpcError.notFound("Class");

          const [schoolClass] = await transaction
            .update(classTable)
            .set({ ...changes, updatedAt: new Date() })
            .where(
              and(
                eq(classTable.schoolId, schoolId),
                eq(classTable.id, classId),
              ),
            )
            .returning();
          if (!schoolClass) throw rpcError.notFound("Class");

          if (changes.slug && changes.slug !== existingClass.slug) {
            // Finance overrides are intentionally keyed by class slug, so a
            // structural rename must move that key in every school session.
            await transaction
              .update(schoolSessionTable)
              .set({
                financeClassOverrides: sql`
                  case
                    when ${schoolSessionTable.financeClassOverrides} ? ${existingClass.slug}
                    then (${schoolSessionTable.financeClassOverrides} - ${existingClass.slug})
                      || jsonb_build_object(
                        cast(${changes.slug} as text),
                        ${schoolSessionTable.financeClassOverrides} -> ${existingClass.slug}
                      )
                    else ${schoolSessionTable.financeClassOverrides}
                  end
                `,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(schoolSessionTable.schoolId, schoolId),
                  sql`${schoolSessionTable.financeClassOverrides} ? ${existingClass.slug}`,
                ),
              );
          }

          return toClassDto(schoolClass);
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  updateClassConfiguration: protectedProcedure
    .route({
      summary: "Update class attributes or configuration",
      description:
        "Replace explicitly supplied class attributes or subject configuration. Any role in the school may perform this mutation.",
      tags: ["School", "Classes"],
    })
    .input(updateClassConfigurationInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.UPDATE_CLASS_CONFIGURATION))
    .output(classDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const { schoolId, classId, ...changes } = input;
        const [schoolClass] = await context.db
          .update(classTable)
          .set({ ...changes, updatedAt: new Date() })
          .where(
            and(
              eq(classTable.schoolId, schoolId),
              eq(classTable.id, classId),
            ),
          )
          .returning();
        if (!schoolClass) throw rpcError.notFound("Class");
        return toClassDto(schoolClass);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  deleteClass: protectedProcedure
    .route({
      summary: "Delete a school class",
      description:
        "Delete a class and its sections from a school in one transaction.",
      tags: ["School", "Classes"],
    })
    .input(classIdInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.DELETE_CLASS))
    .output(classDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          const [schoolClass] = await transaction
            .select()
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

          await transaction
            .delete(sectionTable)
            .where(
              and(
                eq(sectionTable.schoolId, input.schoolId),
                eq(sectionTable.classId, input.classId),
              ),
            );

          // Removing a class also removes its slug-keyed finance overrides so
          // the session JSON cannot retain values for a nonexistent class.
          await transaction
            .update(schoolSessionTable)
            .set({
              financeClassOverrides: sql`${schoolSessionTable.financeClassOverrides} - ${schoolClass.slug}`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schoolSessionTable.schoolId, input.schoolId),
                sql`${schoolSessionTable.financeClassOverrides} ? ${schoolClass.slug}`,
              ),
            );
          await transaction
            .delete(classTable)
            .where(
              and(
                eq(classTable.schoolId, input.schoolId),
                eq(classTable.id, input.classId),
              ),
            );

          return toClassDto(schoolClass);
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
