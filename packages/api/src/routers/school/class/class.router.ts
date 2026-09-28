import { classTable, sectionTable } from "@campuspilot/db/schema/class";
import { schoolTable } from "@campuspilot/db/schema/school";
import { schoolUserRoleTable } from "@campuspilot/db/schema/school-user-role";
import { schoolSessionTable } from "@campuspilot/db/schema/session";
import { SCHOOL_ACTIONS } from "@campuspilot/opa/policies/school";
import { and, asc, eq, max, sql } from "drizzle-orm";

import { rpcError, toRpcError } from "../../../errors";
import { protectedProcedure } from "../../../index";
import { requireSchoolPermission } from "../../../permissions/school";
import {
  classDtoSchema,
  classIdInputSchema,
  createClassInputSchema,
  listClassesInputSchema,
  listClassesOutputSchema,
  reorderClassesInputSchema,
  reorderClassesOutputSchema,
  toClassDto,
  updateClassConfigurationInputSchema,
  updateClassInputSchema,
} from "./class.dto";

export const schoolClassRouter = {
  listClasses: protectedProcedure
    .route({
      summary: "List school classes",
      description:
        "List every class in a school in its explicit display order, including dashboard counts.",
      tags: ["School", "Classes"],
    })
    .input(listClassesInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.LIST_CLASSES))
    .output(listClassesOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        // Schools have a small bounded set of classes, and the complete ordered
        // collection is required for drag-and-drop, so this list is unpaginated.
        const [classes, sections, teacherAssignments] = await Promise.all([
          context.db
            .select()
            .from(classTable)
            .where(eq(classTable.schoolId, input.schoolId))
            .orderBy(asc(classTable.displayOrder), asc(classTable.id)),
          context.db
            .select({ classId: sectionTable.classId })
            .from(sectionTable)
            .where(eq(sectionTable.schoolId, input.schoolId)),
          context.db
            .select({ meta: schoolUserRoleTable.meta })
            .from(schoolUserRoleTable)
            .where(
              and(
                eq(schoolUserRoleTable.schoolId, input.schoolId),
                eq(schoolUserRoleTable.role, "teacher"),
              ),
            ),
        ]);
        const sectionCounts = new Map<string, number>();
        for (const section of sections) {
          sectionCounts.set(
            section.classId,
            (sectionCounts.get(section.classId) ?? 0) + 1,
          );
        }
        const teacherCounts = new Map<string, number>();
        for (const assignment of teacherAssignments) {
          for (const classId of assignment.meta?.classIds ?? []) {
            teacherCounts.set(classId, (teacherCounts.get(classId) ?? 0) + 1);
          }
        }

        return classes.map((schoolClass) => ({
          ...toClassDto(schoolClass),
          sectionCount: sectionCounts.get(schoolClass.id) ?? 0,
          teacherCount: teacherCounts.get(schoolClass.id) ?? 0,
          studentCount: null,
          subjectCount: Object.keys(schoolClass.config.subjects).length,
        }));
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
            .for("update")
            .limit(1);
          if (!school) throw rpcError.notFound("School");

          const { sections, schoolId, ...values } = input;
          const [lastClass] = await transaction
            .select({ displayOrder: max(classTable.displayOrder) })
            .from(classTable)
            .where(eq(classTable.schoolId, schoolId));
          const [schoolClass] = await transaction
            .insert(classTable)
            .values({
              schoolId,
              ...values,
              displayOrder: (lastClass?.displayOrder ?? 0) + 1,
            })
            .returning();
          if (!schoolClass) throw rpcError.internal();

          await transaction.insert(sectionTable).values(
            sections.map((section, sectionIndex) => ({
              ...section,
              schoolId,
              classId: schoolClass.id,
              displayOrder: sectionIndex + 1,
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
        "Update a class slug or label. Any role in the school may perform this mutation.",
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

  reorderClasses: protectedProcedure
    .route({
      summary: "Reorder school classes",
      description:
        "Replace the complete class display order for a school. Requires permission to reorder classes.",
      tags: ["School", "Classes"],
    })
    .input(reorderClassesInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.REORDER_CLASSES))
    .output(reorderClassesOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          const [school] = await transaction
            .select({ id: schoolTable.id })
            .from(schoolTable)
            .where(eq(schoolTable.id, input.schoolId))
            .for("update")
            .limit(1);
          if (!school) throw rpcError.notFound("School");

          const existing = await transaction
            .select({ id: classTable.id })
            .from(classTable)
            .where(eq(classTable.schoolId, input.schoolId));
          const existingIds = new Set(existing.map(({ id }) => id));
          if (
            existingIds.size !== input.orderedClassIds.length ||
            input.orderedClassIds.some((id) => !existingIds.has(id))
          ) {
            throw rpcError.badRequest(
              "The class order must contain every class in the school exactly once.",
            );
          }

          // Move all values into a temporary negative range before assigning
          // the normalized positive order so swaps cannot trip uniqueness.
          await transaction
            .update(classTable)
            .set({ displayOrder: sql`-${classTable.displayOrder}` })
            .where(eq(classTable.schoolId, input.schoolId));
          for (const [index, classId] of input.orderedClassIds.entries()) {
            await transaction
              .update(classTable)
              .set({ displayOrder: index + 1, updatedAt: new Date() })
              .where(
                and(
                  eq(classTable.schoolId, input.schoolId),
                  eq(classTable.id, classId),
                ),
              );
          }

          const reordered = await transaction
            .select()
            .from(classTable)
            .where(eq(classTable.schoolId, input.schoolId))
            .orderBy(asc(classTable.displayOrder), asc(classTable.id));
          return reordered.map(toClassDto);
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
          const [school] = await transaction
            .select({ id: schoolTable.id })
            .from(schoolTable)
            .where(eq(schoolTable.id, input.schoolId))
            .for("update")
            .limit(1);
          if (!school) throw rpcError.notFound("School");

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

          // Teacher assignments are stored as class IDs inside role metadata,
          // so deleting the class must remove that ID explicitly.
          await transaction
            .update(schoolUserRoleTable)
            .set({
              meta: sql`jsonb_set(
                ${schoolUserRoleTable.meta},
                '{classIds}',
                (${schoolUserRoleTable.meta} -> 'classIds') - ${schoolClass.id}
              )`,
            })
            .where(
              and(
                eq(schoolUserRoleTable.schoolId, input.schoolId),
                eq(schoolUserRoleTable.role, "teacher"),
                sql`${schoolUserRoleTable.meta} -> 'classIds' ? ${schoolClass.id}`,
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

          const remainingClasses = await transaction
            .select({ id: classTable.id })
            .from(classTable)
            .where(eq(classTable.schoolId, input.schoolId))
            .orderBy(asc(classTable.displayOrder), asc(classTable.id));
          for (const [index, remaining] of remainingClasses.entries()) {
            await transaction
              .update(classTable)
              .set({ displayOrder: index + 1 })
              .where(eq(classTable.id, remaining.id));
          }

          return toClassDto(schoolClass);
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
