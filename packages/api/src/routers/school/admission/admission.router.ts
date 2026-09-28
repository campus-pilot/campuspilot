import type { DatabaseExecutor } from "@campuspilot/db";
import { admissionTable } from "@campuspilot/db/schema/admission";
import { studentTable } from "@campuspilot/db/schema/student";
import { classTable } from "@campuspilot/db/schema/class";
import type { StudentFinanceValuesMap } from "@campuspilot/db/schema/jsonb/finance-config";
import { schoolTable } from "@campuspilot/db/schema/school";
import { schoolSessionTable } from "@campuspilot/db/schema/session";
import { SCHOOL_ACTIONS } from "@campuspilot/opa/policies/school";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  exists,
  isNotNull,
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
import {
  admissionDtoSchema,
  admissionIdInputSchema,
  createAdmissionInputSchema,
  listAdmissionsInputSchema,
  listAdmissionsOutputSchema,
  toAdmissionDto,
  unregisterAdmissionInputSchema,
  updateAdmissionInputSchema,
  type AdmissionDto,
} from "./admission.dto";
import { assertAdmissionRegistered } from "./admission-registration";

async function findAdmission(
  db: DatabaseExecutor,
  schoolId: string,
  admissionId: string,
): Promise<AdmissionDto | null> {
  const [admission] = await db
    .select()
    .from(admissionTable)
    .where(
      and(
        eq(admissionTable.schoolId, schoolId),
        eq(admissionTable.id, admissionId),
      ),
    )
    .limit(1);

  return admission ? toAdmissionDto(admission) : null;
}

/**
 * Validates school-owned references and student-scoped finance values before
 * an admission write. Finance keys are session IDs because an admission can
 * span several academic sessions.
 */
async function validateAdmissionReferences(
  db: DatabaseExecutor,
  schoolId: string,
  values: {
    admissionClassId?: string | null;
    financeValue?: StudentFinanceValuesMap;
  },
) {
  if (values.admissionClassId) {
    const [schoolClass] = await db
      .select({ id: classTable.id })
      .from(classTable)
      .where(
        and(
          eq(classTable.schoolId, schoolId),
          eq(classTable.id, values.admissionClassId),
        ),
      )
      .limit(1);
    if (!schoolClass) throw rpcError.notFound("Admission class");
  }

  if (values.financeValue === undefined) return;
  const sessionIds = Object.keys(values.financeValue);
  if (sessionIds.length === 0) return;

  const sessions = await db
    .select({
      id: schoolSessionTable.id,
      financeConfig: schoolSessionTable.financeConfig,
    })
    .from(schoolSessionTable)
    .where(
      and(
        eq(schoolSessionTable.schoolId, schoolId),
        inArray(schoolSessionTable.id, sessionIds),
      ),
    );
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));

  for (const [sessionId, financeValues] of Object.entries(values.financeValue)) {
    const session = sessionsById.get(sessionId);
    if (!session) {
      throw rpcError.badRequest(
        `School session "${sessionId}" does not belong to this school.`,
      );
    }

    for (const elementSlug of Object.keys(financeValues)) {
      const element = session.financeConfig?.elements[elementSlug];
      if (!element) {
        throw rpcError.badRequest(
          `Finance element "${elementSlug}" is not defined for session "${sessionId}".`,
        );
      }
      if (!element.scopes.includes("student")) {
        throw rpcError.badRequest(
          `Finance element "${elementSlug}" cannot be overridden by student.`,
        );
      }
    }
  }
}

export const schoolAdmissionRouter = {
  listAdmissions: protectedProcedure
    .route({
      summary: "List school admissions",
      description:
        "List admissions with pagination, search, deterministic sorting, and an optional explicit-session filter for admissions which are not yet students.",
      tags: ["School", "Admissions"],
    })
    .input(listAdmissionsInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.LIST_ADMISSIONS))
    .output(listAdmissionsOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const unadmittedForSessionId =
          input.filters?.unadmittedForSessionId;
        const placementSessionId = input.filters?.placementSessionId;
        const sessionIds = [unadmittedForSessionId, placementSessionId].filter(
          (value): value is string => Boolean(value),
        );
        if (sessionIds.length > 0) {
          const sessions = await context.db
            .select({ id: schoolSessionTable.id })
            .from(schoolSessionTable)
            .where(
              and(
                eq(schoolSessionTable.schoolId, input.schoolId),
                inArray(schoolSessionTable.id, sessionIds),
              ),
            )
          if (sessions.length !== new Set(sessionIds).size) {
            throw rpcError.notFound("School session");
          }
        }

        const { currentPage, pageSize, offset } = resolvePaginationInput(input);
        const searchCondition = input.searchQuery
          ? or(
              ilike(admissionTable.name, `%${input.searchQuery}%`),
              ilike(admissionTable.admissionNo, `%${input.searchQuery}%`),
              ilike(admissionTable.phoneNo, `%${input.searchQuery}%`),
              ilike(admissionTable.email, `%${input.searchQuery}%`),
            )
          : undefined;
        const unadmittedCondition = unadmittedForSessionId
          ? notExists(
              context.db
                .select({ value: sql`1` })
                .from(studentTable)
                .where(
                  and(
                    eq(studentTable.schoolId, input.schoolId),
                    eq(studentTable.admissionId, admissionTable.id),
                    eq(studentTable.sessionId, unadmittedForSessionId),
                  ),
                ),
            )
          : undefined;
        const assignedPlacement = placementSessionId
          ? context.db
              .select({ value: sql`1` })
              .from(studentTable)
              .where(
                and(
                  eq(studentTable.schoolId, input.schoolId),
                  eq(studentTable.admissionId, admissionTable.id),
                  eq(studentTable.sessionId, placementSessionId),
                  isNotNull(studentTable.classId),
                  isNotNull(studentTable.sectionId),
                ),
              )
          : undefined;
        const placementCondition = assignedPlacement && input.filters?.placementStatus
          ? input.filters?.placementStatus === "assigned"
            ? exists(assignedPlacement)
            : notExists(assignedPlacement)
          : undefined;
        const where = and(
          eq(admissionTable.schoolId, input.schoolId),
          searchCondition,
          input.filters?.registered === undefined
            ? undefined
            : eq(admissionTable.registered, input.filters.registered),
          input.filters?.admissionClassId
            ? eq(
                admissionTable.admissionClassId,
                input.filters.admissionClassId,
              )
            : undefined,
          unadmittedCondition,
          placementCondition,
        );
        const orderByColumn = {
          name: admissionTable.name,
          admissionNo: admissionTable.admissionNo,
          dob: admissionTable.dob,
          createdAt: admissionTable.createdAt,
        }[input.orderBy.field];
        const orderDirection = input.orderBy.direction === "asc" ? asc : desc;

        const [admissions, totalRows] = await Promise.all([
          context.db
            .select()
            .from(admissionTable)
            .where(where)
            .orderBy(
              orderDirection(orderByColumn),
              orderDirection(admissionTable.id),
            )
            .limit(pageSize)
            .offset(offset),
          context.db
            .select({ totalItems: count() })
            .from(admissionTable)
            .where(where),
        ]);
        const totalItems = totalRows[0]?.totalItems ?? 0;
        const totalPages = Math.ceil(totalItems / pageSize);

        const placements = placementSessionId && admissions.length > 0
          ? await context.db
              .select({
                id: studentTable.id,
                admissionId: studentTable.admissionId,
                sessionId: studentTable.sessionId,
                classId: studentTable.classId,
                sectionId: studentTable.sectionId,
                rollNo: studentTable.rollNo,
              })
              .from(studentTable)
              .where(
                and(
                  eq(studentTable.schoolId, input.schoolId),
                  eq(studentTable.sessionId, placementSessionId),
                  inArray(
                    studentTable.admissionId,
                    admissions.map(({ id }) => id),
                  ),
                ),
              )
          : [];
        const placementByAdmissionId = new Map(
          placements.map(({ admissionId, ...placement }) => [
            admissionId,
            placement,
          ]),
        );

        return createPaginatedResult({
          items: admissions.map((admission) => ({
            ...toAdmissionDto(admission),
            placement: placementByAdmissionId.get(admission.id) ?? null,
          })),
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

  getAdmission: protectedProcedure
    .route({
      summary: "Get a school admission",
      description: "Get one admission by its school and admission identifiers.",
      tags: ["School", "Admissions"],
    })
    .input(admissionIdInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_ADMISSION))
    .output(admissionDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const admission = await findAdmission(
          context.db,
          input.schoolId,
          input.admissionId,
        );
        if (!admission) throw rpcError.notFound("Admission");
        return admission;
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  createAdmission: protectedProcedure
    .route({
      summary: "Create a school admission",
      description:
        "Create an admission. Document attachments are intentionally added after creation through the binary document workflow.",
      tags: ["School", "Admissions"],
    })
    .input(createAdmissionInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.CREATE_ADMISSION))
    .output(admissionDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          const [school] = await transaction
            .select({ id: schoolTable.id })
            .from(schoolTable)
            .where(eq(schoolTable.id, input.schoolId))
            .limit(1);
          if (!school) throw rpcError.notFound("School");

          await validateAdmissionReferences(transaction, input.schoolId, input);
          const [admission] = await transaction
            .insert(admissionTable)
            // Registration is a backend-owned initial state. Clients cannot
            // create an inactive admission or revive an old one.
            .values({ ...input, registered: true })
            .returning();
          if (!admission) throw rpcError.internal();
          return toAdmissionDto(admission);
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  updateAdmission: protectedProcedure
    .route({
      summary: "Update a school admission",
      description:
        "Update explicitly supplied admission fields. Attached documents remain separate from this general metadata mutation.",
      tags: ["School", "Admissions"],
    })
    .input(updateAdmissionInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.UPDATE_ADMISSION))
    .output(admissionDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          const { schoolId, admissionId, ...changes } = input;
          await assertAdmissionRegistered(transaction, { schoolId, admissionId });
          await validateAdmissionReferences(transaction, schoolId, changes);
          const [admission] = await transaction
            .update(admissionTable)
            .set({ ...changes, updatedAt: new Date() })
            .where(
              and(
                eq(admissionTable.schoolId, schoolId),
                eq(admissionTable.id, admissionId),
                eq(admissionTable.registered, true),
              ),
            )
            .returning();
          if (!admission) {
            throw rpcError.badRequest(
              "This admission is no longer registered with the school and cannot be changed.",
            );
          }
          return toAdmissionDto(admission);
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  deleteAdmission: protectedProcedure
    .route({
      summary: "Delete a school admission",
      description:
        "Delete an admission only when it has no student enrollment history.",
      tags: ["School", "Admissions"],
    })
    .input(admissionIdInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.DELETE_ADMISSION))
    .output(admissionDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          const admission = await findAdmission(
            transaction,
            input.schoolId,
            input.admissionId,
          );
          if (!admission) throw rpcError.notFound("Admission");

          await assertAdmissionRegistered(transaction, input);

          const [student] = await transaction
            .select({ id: studentTable.id })
            .from(studentTable)
            .where(
              and(
                eq(studentTable.schoolId, input.schoolId),
                eq(studentTable.admissionId, input.admissionId),
              ),
            )
            .limit(1);
          if (student) {
            throw rpcError.conflict(
              "An admission with student enrollment history cannot be deleted.",
            );
          }

          await transaction
            .delete(admissionTable)
            .where(
              and(
                eq(admissionTable.schoolId, input.schoolId),
                eq(admissionTable.id, input.admissionId),
              ),
            );
          return admission;
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  unregisterAdmission: protectedProcedure
    .route({
      summary: "Unregister an admission from the school",
      description:
        "Irreversibly mark an admission as no longer associated with the school after confirming the student's exact name.",
      tags: ["School", "Admissions"],
    })
    .input(unregisterAdmissionInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.UNREGISTER_ADMISSION))
    .output(admissionDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          const admission = await findAdmission(
            transaction,
            input.schoolId,
            input.admissionId,
          );
          if (!admission) throw rpcError.notFound("Admission");
          if (!admission.registered) {
            throw rpcError.badRequest(
              "This admission has already been unregistered and cannot be registered again.",
            );
          }
          if (input.confirmationName !== admission.name) {
            throw rpcError.badRequest("The confirmation name does not match the student name.");
          }

          const [updated] = await transaction
            .update(admissionTable)
            .set({ registered: false, updatedAt: new Date() })
            .where(
              and(
                eq(admissionTable.schoolId, input.schoolId),
                eq(admissionTable.id, input.admissionId),
                eq(admissionTable.registered, true),
              ),
            )
            .returning();
          if (!updated) {
            throw rpcError.badRequest(
              "This admission has already been unregistered and cannot be registered again.",
            );
          }
          return toAdmissionDto(updated);
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
