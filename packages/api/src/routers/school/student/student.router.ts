import type { DatabaseExecutor } from "@campuspilot/db";
import { admissionTable } from "@campuspilot/db/schema/admission";
import { studentTable } from "@campuspilot/db/schema/student";
import { classTable, sectionTable } from "@campuspilot/db/schema/class";
import { schoolSessionTable } from "@campuspilot/db/schema/session";
import type { AuthorizationRequest } from "@campuspilot/opa/authorization";
import { CLASS_ACTIONS } from "@campuspilot/opa/policies/class";
import { SCHOOL_ACTIONS } from "@campuspilot/opa/policies/school";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  isNotNull,
  isNull,
  or,
} from "drizzle-orm";

import { rpcError, toRpcError } from "../../../errors";
import { protectedProcedure } from "../../../index";
import {
  createNextPageCursor,
  createPaginatedResult,
  resolvePaginationInput,
} from "../../../paginations";
import { checkPermissions } from "../../../permissions/authorization";
import { requireSchoolPermission } from "../../../permissions/school";
import {
  createStudentInputSchema,
  listStudentsInputSchema,
  listStudentsOutputSchema,
  removeStudentFromClassInputSchema,
  studentDtoSchema,
  studentIdInputSchema,
  toStudentDto,
  updateStudentInputSchema,
  type StudentDto,
} from "./student.dto";
import { assertAdmissionRegistered } from "../admission/admission-registration";

const studentSelection = {
  id: studentTable.id,
  classId: studentTable.classId,
  sectionId: studentTable.sectionId,
  schoolId: studentTable.schoolId,
  admissionId: studentTable.admissionId,
  sessionId: studentTable.sessionId,
  rollNo: studentTable.rollNo,
  admission: {
    name: admissionTable.name,
    admissionNo: admissionTable.admissionNo,
    photoS3Key: admissionTable.photoS3Key,
  },
  createdAt: studentTable.createdAt,
  updatedAt: studentTable.updatedAt,
};

async function findStudent(
  db: DatabaseExecutor,
  input: { schoolId: string; sessionId: string; studentId: string },
): Promise<StudentDto | null> {
  const [student] = await db
    .select(studentSelection)
    .from(studentTable)
    .innerJoin(
      admissionTable,
      and(
        eq(studentTable.admissionId, admissionTable.id),
        eq(studentTable.schoolId, admissionTable.schoolId),
      ),
    )
    .where(
      and(
        eq(studentTable.schoolId, input.schoolId),
        eq(studentTable.sessionId, input.sessionId),
        eq(studentTable.id, input.studentId),
      ),
    )
    .limit(1);

  return student ? toStudentDto(student) : null;
}

async function findStudentPlacement(
  db: DatabaseExecutor,
  input: {
    schoolId: string;
    sectionId: string;
  },
) {
  const [section] = await db
    .select({ id: sectionTable.id, classId: classTable.id })
    .from(sectionTable)
    .innerJoin(classTable, eq(sectionTable.classId, classTable.id))
    .where(
      and(
        eq(sectionTable.schoolId, input.schoolId),
        eq(classTable.schoolId, input.schoolId),
        eq(sectionTable.id, input.sectionId),
      ),
    )
    .limit(1);
  if (!section) throw rpcError.notFound("Section");
  return section;
}

export const schoolStudentRouter = {
  listStudents: protectedProcedure
    .route({
      summary: "List students for a school session",
      description:
        "List student enrollments for the explicitly supplied session with pagination, admission search, placement filters, and deterministic sorting.",
      tags: ["School", "Students"],
    })
    .input(listStudentsInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.LIST_STUDENTS))
    .output(listStudentsOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const [session] = await context.db
          .select({ id: schoolSessionTable.id })
          .from(schoolSessionTable)
          .where(
            and(
              eq(schoolSessionTable.schoolId, input.schoolId),
              eq(schoolSessionTable.id, input.sessionId),
            ),
          )
          .limit(1);
        if (!session) throw rpcError.notFound("School session");

        const { currentPage, pageSize, offset } = resolvePaginationInput(input);
        const unassignedCondition =
          input.filters?.unassigned === undefined
            ? undefined
            : input.filters.unassigned
              ? and(
                  isNull(studentTable.classId),
                  isNull(studentTable.sectionId),
                )
              : and(
                  isNotNull(studentTable.classId),
                  isNotNull(studentTable.sectionId),
                );
        const searchCondition = input.searchQuery
          ? or(
              ilike(admissionTable.name, `%${input.searchQuery}%`),
              ilike(admissionTable.admissionNo, `%${input.searchQuery}%`),
            )
          : undefined;
        const where = and(
          eq(studentTable.schoolId, input.schoolId),
          eq(studentTable.sessionId, input.sessionId),
          searchCondition,
          input.filters?.admissionId
            ? eq(studentTable.admissionId, input.filters.admissionId)
            : undefined,
          input.filters?.classId
            ? eq(studentTable.classId, input.filters.classId)
            : undefined,
          input.filters?.sectionId
            ? eq(studentTable.sectionId, input.filters.sectionId)
            : undefined,
          unassignedCondition,
        );
        const orderByColumn = {
          name: admissionTable.name,
          admissionNo: admissionTable.admissionNo,
          rollNo: studentTable.rollNo,
          createdAt: studentTable.createdAt,
        }[input.orderBy.field];
        const orderDirection = input.orderBy.direction === "asc" ? asc : desc;

        const [students, totalRows] = await Promise.all([
          context.db
            .select(studentSelection)
            .from(studentTable)
            .innerJoin(
              admissionTable,
              and(
                eq(studentTable.admissionId, admissionTable.id),
                eq(studentTable.schoolId, admissionTable.schoolId),
              ),
            )
            .where(where)
            .orderBy(
              orderDirection(orderByColumn),
              orderDirection(studentTable.id),
            )
            .limit(pageSize)
            .offset(offset),
          context.db
            .select({ totalItems: count() })
            .from(studentTable)
            .innerJoin(
              admissionTable,
              and(
                eq(studentTable.admissionId, admissionTable.id),
                eq(studentTable.schoolId, admissionTable.schoolId),
              ),
            )
            .where(where),
        ]);
        const totalItems = totalRows[0]?.totalItems ?? 0;
        const totalPages = Math.ceil(totalItems / pageSize);

        return createPaginatedResult({
          items: students.map(toStudentDto),
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

  getStudent: protectedProcedure
    .route({
      summary: "Get a student for a school session",
      description:
        "Get one student enrollment by school, explicit session, and student identifiers.",
      tags: ["School", "Students"],
    })
    .input(studentIdInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.READ_STUDENT))
    .output(studentDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const student = await findStudent(context.db, input);
        if (!student) throw rpcError.notFound("Student");
        return student;
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  createStudent: protectedProcedure
    .route({
      summary: "Enroll an admission as a student",
      description:
        "Create a student in an explicit session and class. Principals and managers may enroll throughout their school; a teacher may enroll only into an assigned class.",
      tags: ["School", "Students"],
    })
    .input(createStudentInputSchema)
    // This membership gate prevents non-school users from probing section IDs;
    // the handler still requires manager or assigned-teacher mutation access.
    .use(requireSchoolPermission(SCHOOL_ACTIONS.LIST_STUDENTS))
    .output(studentDtoSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        // Class ownership and the teacher scope are derived from the section;
        // callers cannot provide contradictory class and section identifiers.
        const placement = await findStudentPlacement(context.db, input);
        const requests = [
          {
            action: SCHOOL_ACTIONS.CREATE_STUDENT,
            resource: { kind: "school", schoolId: input.schoolId },
          },
          {
            action: CLASS_ACTIONS.ADD_STUDENT,
            resource: {
              kind: "class",
              schoolId: input.schoolId,
              classId: placement.classId,
            },
          },
        ] satisfies readonly AuthorizationRequest[];
        const [canManageStudents, canAddToAssignedClass] =
          await checkPermissions(context, requests, signal);
        if (!canManageStudents && !canAddToAssignedClass) {
          throw rpcError.forbidden();
        }

        return await context.db.transaction(async (transaction) => {
          const [[session], [admission]] = await Promise.all([
            transaction
              .select({ id: schoolSessionTable.id })
              .from(schoolSessionTable)
              .where(
                and(
                  eq(schoolSessionTable.schoolId, input.schoolId),
                  eq(schoolSessionTable.id, input.sessionId),
                ),
              )
              .limit(1),
            transaction
              .select({
                id: admissionTable.id,
                name: admissionTable.name,
                admissionNo: admissionTable.admissionNo,
                photoS3Key: admissionTable.photoS3Key,
                registered: admissionTable.registered,
              })
              .from(admissionTable)
              .where(
                and(
                  eq(admissionTable.schoolId, input.schoolId),
                  eq(admissionTable.id, input.admissionId),
                ),
              )
              .limit(1)
              .for("update"),
          ]);
          if (!session) throw rpcError.notFound("School session");
          if (!admission) throw rpcError.notFound("Admission");
          if (!admission.registered) {
            throw rpcError.badRequest(
              "An unregistered admission cannot be enrolled as a student.",
            );
          }

          const [student] = await transaction
            .insert(studentTable)
            .values({ ...input, classId: placement.classId })
            .returning();
          if (!student) throw rpcError.internal();
          const { registered: _registered, ...admissionDto } = admission;
          return toStudentDto({ ...student, admission: admissionDto });
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  updateStudent: protectedProcedure
    .route({
      summary: "Update a student placement",
      description:
        "Update a student's class, section, or roll number within the explicitly supplied session.",
      tags: ["School", "Students"],
    })
    .input(updateStudentInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.UPDATE_STUDENT))
    .output(studentDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          const existing = await findStudent(transaction, input);
          if (!existing) throw rpcError.notFound("Student");
          await assertAdmissionRegistered(transaction, {
            schoolId: input.schoolId,
            admissionId: existing.admissionId,
          });
          if (
            (!existing.classId || !existing.sectionId) &&
            input.sectionId === undefined
          ) {
            throw rpcError.badRequest(
              "Reassigning a detached student requires a section.",
            );
          }
          const placement = input.sectionId
            ? await findStudentPlacement(transaction, {
                schoolId: input.schoolId,
                sectionId: input.sectionId,
              })
            : null;

          const { schoolId, sessionId, studentId, ...changes } = input;
          const [student] = await transaction
            .update(studentTable)
            .set({
              ...changes,
              ...(placement ? { classId: placement.classId } : {}),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(studentTable.schoolId, schoolId),
                eq(studentTable.sessionId, sessionId),
                eq(studentTable.id, studentId),
              ),
            )
            .returning();
          if (!student) throw rpcError.notFound("Student");
          return toStudentDto({ ...student, admission: existing.admission });
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  removeStudentFromClass: protectedProcedure
    .route({
      summary: "Remove a student from their class",
      description:
        "Detach a student from class and section in the explicitly supplied session without deleting enrollment history.",
      tags: ["School", "Students"],
    })
    .input(removeStudentFromClassInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.REMOVE_STUDENT_FROM_CLASS))
    .output(studentDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          const existing = await findStudent(transaction, input);
          if (!existing) throw rpcError.notFound("Student");
          await assertAdmissionRegistered(transaction, {
            schoolId: input.schoolId,
            admissionId: existing.admissionId,
          });
          if (existing.rollNo === null) {
            throw rpcError.badRequest(
              "This student is not currently assigned to a classroom.",
            );
          }
          if (input.confirmationRollNo !== existing.rollNo) {
            throw rpcError.badRequest(
              "The confirmation roll number does not match the student's roll number.",
            );
          }
          const [student] = await transaction
            .update(studentTable)
            .set({
              classId: null,
              sectionId: null,
              rollNo: null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(studentTable.schoolId, input.schoolId),
                eq(studentTable.sessionId, input.sessionId),
                eq(studentTable.id, input.studentId),
              ),
            )
            .returning();
          if (!student) throw rpcError.notFound("Student");
          return toStudentDto({ ...student, admission: existing.admission });
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  deleteStudent: protectedProcedure
    .route({
      summary: "Delete a student enrollment",
      description:
        "Delete the student row for the explicitly supplied session while retaining the underlying admission.",
      tags: ["School", "Students"],
    })
    .input(studentIdInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.DELETE_STUDENT))
    .output(studentDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return await context.db.transaction(async (transaction) => {
          const student = await findStudent(transaction, input);
          if (!student) throw rpcError.notFound("Student");
          await assertAdmissionRegistered(transaction, {
            schoolId: input.schoolId,
            admissionId: student.admissionId,
          });
          await transaction
            .delete(studentTable)
            .where(
              and(
                eq(studentTable.schoolId, input.schoolId),
                eq(studentTable.sessionId, input.sessionId),
                eq(studentTable.id, input.studentId),
              ),
            );
          return student;
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
