import type { DatabaseExecutor } from "@campuspilot/db";
import { admissionTable } from "@campuspilot/db/schema/admission";
import { studentTable } from "@campuspilot/db/schema/student";
import { classTable } from "@campuspilot/db/schema/class";
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
  isNull,
  not,
  notExists,
  or,
  sql,
} from "drizzle-orm";

import { findCadetLoginId } from "@campuspilot/auth/cadet-login";
import { revokeCadetLoginAccess } from "@campuspilot/auth/cadet";

import { rpcError, toRpcError } from "../../../errors";
import { protectedProcedure } from "../../../index";
import {
  createNextPageCursor,
  createPaginatedResult,
  resolvePaginationInput,
} from "../../../paginations";
import { assertPermission } from "../../../permissions/authorization";
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
import { phoneSearchDigits } from "./admission-phone-search";
import { assertAdmissionRegistered } from "./admission-registration";
import {
  AdmissionContactError,
  resolveAdmissionWhatsapp,
  type AdmissionContactChanges,
} from "./admission-whatsapp";
import {
  issueAdmissionCadetPassword,
  issuedCadetPasswordSchema,
} from "./admission-cadet-password";

/** `createAdmission`'s output: the admission plus a password issued with it. */
const createAdmissionOutputSchema = admissionDtoSchema.extend({
  /** Set only when `generateCadetPassword` was true; shown to staff once. */
  cadetPassword: issuedCadetPasswordSchema.nullable(),
});

const ADMISSION_FUZZY_SEARCH_THRESHOLD = 0.2;

/**
 * Escapes PostgreSQL LIKE metacharacters so fuzzy search's substring and
 * prefix ranks always interpret the user's query literally.
 */
function escapeLikePattern(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

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
 * Validates references that are safe to mutate through the general admission
 * boundary. Restricted pricing values are handled by the billing router.
 */
async function validateAdmissionReferences(
  db: DatabaseExecutor,
  schoolId: string,
  values: {
    admissionClassId?: string | null;
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
}

/** Resolves the WhatsApp facts to store, refusing inconsistent input as a bad request. */
function resolveWhatsappOrThrow(
  ...args: Parameters<typeof resolveAdmissionWhatsapp>
) {
  try {
    return resolveAdmissionWhatsapp(...args);
  } catch (error) {
    if (error instanceof AdmissionContactError) throw rpcError.badRequest(error.message);
    throw error;
  }
}

/** Whether an update touches the phone number or any WhatsApp fact. */
function changesContact(changes: AdmissionContactChanges) {
  return (
    changes.phoneNo !== undefined ||
    changes.whatsappNo !== undefined ||
    changes.whatsappSameAsPhone !== undefined ||
    changes.whatsappVerified !== undefined ||
    changes.whatsappConsent !== undefined
  );
}

export const schoolAdmissionRouter = {
  listAdmissions: protectedProcedure
    .route({
      summary: "List school admissions",
      description:
        "List admissions with pagination, search, deterministic sorting, and an optional explicit-session filter for admissions which are not yet students.",
      tags: ["School", "Admissions"],
    })
    .meta({
      mcp: {
        exposure: "core",
        access: "read",
        destructive: false,
        module: "admissions",
      },
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
        const escapedSearchQuery = input.searchQuery
          ? escapeLikePattern(input.searchQuery)
          : undefined;
        const fuzzyNameSubstring = escapedSearchQuery
          ? sql<boolean>`${admissionTable.name} ILIKE ${`%${escapedSearchQuery}%`} ESCAPE ${"\\"}`
          : undefined;
        const fuzzyAdmissionNoSubstring = escapedSearchQuery
          ? sql<boolean>`${admissionTable.admissionNo} ILIKE ${`%${escapedSearchQuery}%`} ESCAPE ${"\\"}`
          : undefined;
        const nameSimilarity = input.searchQuery
          ? sql<number>`similarity(${admissionTable.name}, ${input.searchQuery})`
          : undefined;
        const admissionNoSimilarity = input.searchQuery
          ? sql<number>`similarity(${admissionTable.admissionNo}, ${input.searchQuery})`
          : undefined;
        const nameWordSimilarity = input.searchQuery
          ? sql<number>`word_similarity(${input.searchQuery}, ${admissionTable.name})`
          : undefined;
        const admissionNoWordSimilarity = input.searchQuery
          ? sql<number>`word_similarity(${input.searchQuery}, ${admissionTable.admissionNo})`
          : undefined;
        const fuzzyScore =
          nameSimilarity &&
          admissionNoSimilarity &&
          nameWordSimilarity &&
          admissionNoWordSimilarity
            ? sql<number>`greatest(${nameSimilarity}, ${admissionNoSimilarity}, ${nameWordSimilarity}, ${admissionNoWordSimilarity})`
            : undefined;
        const phoneDigits = input.searchQuery ? phoneSearchDigits(input.searchQuery) : null;
        const searchCondition = input.searchQuery
          ? input.searchMode === "fuzzy"
            ? or(
                fuzzyNameSubstring,
                fuzzyAdmissionNoSubstring,
                sql`${nameSimilarity} >= ${ADMISSION_FUZZY_SEARCH_THRESHOLD}`,
                sql`${admissionNoSimilarity} >= ${ADMISSION_FUZZY_SEARCH_THRESHOLD}`,
                sql`${nameWordSimilarity} >= ${ADMISSION_FUZZY_SEARCH_THRESHOLD}`,
                sql`${admissionNoWordSimilarity} >= ${ADMISSION_FUZZY_SEARCH_THRESHOLD}`,
              )
            : or(
                ilike(admissionTable.name, `%${input.searchQuery}%`),
                ilike(admissionTable.admissionNo, `%${input.searchQuery}%`),
                ilike(admissionTable.phoneNo, `%${input.searchQuery}%`),
                // Typed as staff say it (spaces, trunk 0, +91): match digits only.
                phoneDigits
                  ? sql`regexp_replace(${admissionTable.phoneNo}, '[^0-9]', '', 'g') like ${`%${phoneDigits}%`}`
                  : undefined,
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
        const placementCondition =
          assignedPlacement && input.filters?.placementStatus
            ? input.filters?.placementStatus === "assigned"
              ? exists(assignedPlacement)
              : notExists(assignedPlacement)
            : undefined;
        const whatsappReady = and(
          isNotNull(admissionTable.whatsappNo),
          eq(admissionTable.whatsappVerified, true),
          eq(admissionTable.whatsappConsent, true),
        );
        const whatsappCondition = {
          ready: whatsappReady,
          needs_attention: not(whatsappReady!),
          no_number: isNull(admissionTable.whatsappNo),
          not_verified: and(isNotNull(admissionTable.whatsappNo), eq(admissionTable.whatsappVerified, false)),
          no_consent: and(isNotNull(admissionTable.whatsappNo), eq(admissionTable.whatsappVerified, true), eq(admissionTable.whatsappConsent, false)),
        }[input.filters?.whatsappStatus ?? "ready"];
        const placementClassId = input.filters?.placementClassId;
        /**
         * Matches on the student row's class alone, so it agrees with the
         * class returned in `placement` even while a section is still pending.
         */
        const placementClassCondition =
          placementSessionId && placementClassId
            ? exists(
                context.db
                  .select({ value: sql`1` })
                  .from(studentTable)
                  .where(
                    and(
                      eq(studentTable.schoolId, input.schoolId),
                      eq(studentTable.admissionId, admissionTable.id),
                      eq(studentTable.sessionId, placementSessionId),
                      eq(studentTable.classId, placementClassId),
                    ),
                  ),
              )
            : undefined;
        const where = and(
          eq(admissionTable.schoolId, input.schoolId),
          searchCondition,
          input.filters?.whatsappStatus ? whatsappCondition : undefined,
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
          placementClassCondition,
        );
        const orderByColumn =
          input.orderBy.field === "relevance"
            ? undefined
            : {
                name: admissionTable.name,
                admissionNo: admissionTable.admissionNo,
                dob: admissionTable.dob,
                createdAt: admissionTable.createdAt,
              }[input.orderBy.field];
        const orderDirection = input.orderBy.direction === "asc" ? asc : desc;

        /**
         * Relevance has a fixed semantic order: exact, prefix, substring,
         * trigram score, name, then ID. The final two keys keep pagination
         * stable when multiple admissions have the same match quality.
         */
        const relevanceOrder =
          input.orderBy.field === "relevance" &&
          input.searchQuery &&
          escapedSearchQuery &&
          fuzzyScore
            ? [
                desc(
                  sql<number>`case when lower(${admissionTable.name}) = lower(${input.searchQuery}) or lower(${admissionTable.admissionNo}) = lower(${input.searchQuery}) then 1 else 0 end`,
                ),
                desc(
                  sql<number>`case when ${admissionTable.name} ILIKE ${`${escapedSearchQuery}%`} ESCAPE ${"\\"} or ${admissionTable.admissionNo} ILIKE ${`${escapedSearchQuery}%`} ESCAPE ${"\\"} then 1 else 0 end`,
                ),
                desc(
                  sql<number>`case when ${fuzzyNameSubstring} or ${fuzzyAdmissionNoSubstring} then 1 else 0 end`,
                ),
                desc(fuzzyScore),
                asc(admissionTable.name),
                asc(admissionTable.id),
              ]
            : undefined;

        const [admissions, totalRows] = await Promise.all([
          context.db
            .select()
            .from(admissionTable)
            .where(where)
            .orderBy(
              ...(
                relevanceOrder ?? [
                  orderDirection(orderByColumn!),
                  orderDirection(admissionTable.id),
                ]
              ),
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
    .meta({
      mcp: {
        exposure: "core",
        access: "read",
        destructive: false,
        module: "admissions",
      },
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
        "Create an admission. Document attachments are intentionally added after creation through the binary document workflow. With generateCadetPassword the student's Cadet Portal login is created in the same step and its password is returned once in cadetPassword.",
      tags: ["School", "Admissions"],
    })
    .meta({
      mcp: {
        exposure: "core",
        access: "write",
        destructive: false,
        module: "admissions",
      },
    })
    .input(createAdmissionInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.CREATE_ADMISSION))
    .output(createAdmissionOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        const {
          generateCadetPassword,
          whatsappNo,
          whatsappSameAsPhone,
          whatsappVerified,
          whatsappConsent,
          ...values
        } = input;
        const whatsapp = resolveWhatsappOrThrow(null, {
          phoneNo: values.phoneNo,
          whatsappNo,
          whatsappSameAsPhone,
          whatsappVerified,
          whatsappConsent,
        });
        // Issuing a password is its own permission, checked in addition to
        // admission creation and only when one is requested.
        if (generateCadetPassword) {
          await assertPermission(
            context,
            {
              action: SCHOOL_ACTIONS.ISSUE_ADMISSION_CADET_PASSWORD,
              resource: { kind: "school", schoolId: input.schoolId },
            },
            signal,
          );
        }
        return await context.db.transaction(async (transaction) => {
          const [school] = await transaction
            .select({ id: schoolTable.id })
            .from(schoolTable)
            .where(eq(schoolTable.id, input.schoolId))
            .limit(1);
          if (!school) throw rpcError.notFound("School");

          await validateAdmissionReferences(transaction, input.schoolId, values);
          const [admission] = await transaction
            .insert(admissionTable)
            // Registration is a backend-owned initial state. Clients cannot
            // create an inactive admission or revive an old one.
            .values({ ...values, ...whatsapp, registered: true })
            .returning();
          if (!admission) throw rpcError.internal();
          // The login and its hash commit or roll back with the admission.
          // A new admission has no sessions, so nothing needs revoking.
          const cadetPassword = generateCadetPassword
            ? (
                await issueAdmissionCadetPassword(transaction, {
                  schoolId: input.schoolId,
                  admission,
                  issuedBy: context.session.user.id,
                })
              ).issued
            : null;
          return { ...toAdmissionDto(admission), cadetPassword };
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  issueAdmissionCadetPassword: protectedProcedure
    .route({
      summary: "Issue a Cadet Portal password",
      description:
        "Issue a new Cadet Portal password for an admission (registered or unregistered), creating the student's login on first use. The previous password stops working, and the student is signed out everywhere, including connected AI apps. The new password is returned once and can never be viewed again.",
      tags: ["School", "Admissions"],
    })
    .meta({
      // Must stay a human action: it returns a credential and signs a
      // student out everywhere.
      mcp: {
        exposure: "hidden",
        access: "write",
        destructive: true,
        module: "admissions",
      },
    })
    .input(admissionIdInputSchema)
    .use(requireSchoolPermission(SCHOOL_ACTIONS.ISSUE_ADMISSION_CADET_PASSWORD))
    .output(issuedCadetPasswordSchema)
    .handler(async ({ context, input }) => {
      try {
        const { userId, issued } = await context.db.transaction(
          async (transaction) => {
            const admission = await findAdmission(
              transaction,
              input.schoolId,
              input.admissionId,
            );
            if (!admission) throw rpcError.notFound("Admission");
            // Deliberately no registration check: registration and portal
            // access are separate facts. An unregistered student keeps
            // signing in and seeing their records, so staff must be able to
            // issue them a new password too. This writes only the cadet
            // login, never the admission row.
            return issueAdmissionCadetPassword(transaction, {
              schoolId: input.schoolId,
              admission,
              issuedBy: context.session.user.id,
            });
          },
        );
        // Revoked after the new password committed, so no session created
        // with the old password can survive. If revoking fails the error
        // reaches staff without the password, and issuing again revokes
        // again.
        await revokeCadetLoginAccess([userId]);
        return issued;
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
    .meta({
      mcp: {
        exposure: "core",
        access: "write",
        destructive: true,
        module: "admissions",
      },
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
          let whatsapp = {};
          if (changesContact(changes)) {
            // Locked so a concurrent phone change cannot leave the WhatsApp
            // number following a stale phone number.
            const [current] = await transaction
              .select({
                phoneNo: admissionTable.phoneNo,
                whatsappNo: admissionTable.whatsappNo,
                whatsappSameAsPhone: admissionTable.whatsappSameAsPhone,
                whatsappVerified: admissionTable.whatsappVerified,
                whatsappConsent: admissionTable.whatsappConsent,
              })
              .from(admissionTable)
              .where(
                and(
                  eq(admissionTable.schoolId, schoolId),
                  eq(admissionTable.id, admissionId),
                ),
              )
              .limit(1)
              .for("update");
            if (!current) throw rpcError.notFound("Admission");
            whatsapp = resolveWhatsappOrThrow(current, changes);
          }
          const [admission] = await transaction
            .update(admissionTable)
            .set({ ...changes, ...whatsapp, updatedAt: new Date() })
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
    .meta({
      mcp: {
        exposure: "advanced",
        access: "write",
        destructive: true,
        module: "admissions",
      },
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

          // Sign the student out through the cadet instance first, so the
          // Redis session copies go too; the cadet rows then cascade with
          // the admission.
          const cadetLoginId = await findCadetLoginId(
            transaction,
            input.admissionId,
          );
          if (cadetLoginId) await revokeCadetLoginAccess([cadetLoginId]);

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
    .meta({
      mcp: {
        exposure: "advanced",
        access: "write",
        destructive: true,
        module: "admissions",
      },
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
            .set({
              registered: false,
              unregisteredAt: new Date(),
              updatedAt: new Date(),
            })
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
