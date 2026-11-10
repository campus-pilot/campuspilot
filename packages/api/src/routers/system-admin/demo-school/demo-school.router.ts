import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { DatabaseExecutor } from "@campuspilot/db";
import {
  DEMO_SCHOOL_PURGE_STAGES,
  demoSchoolJobTable,
  demoSchoolPurgeTable,
} from "@campuspilot/db/schema/demo-school-job";
import { schoolTable } from "@campuspilot/db/schema/school";
import { schoolMemberTable } from "@campuspilot/db/schema/school-member";
import { schoolUserRoleTable } from "@campuspilot/db/schema/school-user-role";
import { env } from "@campuspilot/env/server";
import { SYSTEM_ACTIONS } from "@campuspilot/opa/policies/system";
import { getS3Client } from "@campuspilot/s3/client";
import { eventIterator } from "@orpc/server";
import { and, asc, count, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";

import { rpcError, toRpcError } from "../../../errors";
import { protectedProcedure } from "../../../index";
import {
  createNextPageCursor,
  createPaginatedResult,
  resolvePaginationInput,
} from "../../../paginations";
import { requireSystemPermission } from "../../../permissions/system";
import { SCHOOL_FEATURE_KEYS } from "@campuspilot/db/feature-flags/catalogue";
import { setSchoolFeature } from "../../../feature-flags/feature-flags.service";
import { DEMO_SCHOOL_FEATURE_DEFAULTS, DEMO_SCHOOL_STEPS } from "../../../workflows/demo-school/constants";
import {
  generateRegistrationNumber,
  slugifySchoolName,
  uniqueSlug,
} from "../../../workflows/demo-school/identity";
import { demoClassCatalogue } from "../../../workflows/demo-school/seed";
import { toSchoolDto } from "../school/school.dto";
import {
  createDemoSchoolInputSchema,
  createDemoSchoolOutputSchema,
  demoCredentialsDownloadDtoSchema,
  demoSchoolIdInputSchema,
  demoSchoolJobDtoSchema,
  demoSchoolJobIdInputSchema,
  demoSchoolPurgeDtoSchema,
  listDemoClassCatalogueInputSchema,
  listDemoClassCatalogueOutputSchema,
  listDemoSchoolPurgesInputSchema,
  listDemoSchoolPurgesOutputSchema,
  purgeDemoSchoolInputSchema,
  purgeDemoSchoolOutputSchema,
  type DemoSchoolJobDto,
  type DemoSchoolPurgeDto,
} from "./demo-school.dto";
import {
  dispatchDemoSchoolPurge,
  dispatchDemoSchoolStart,
  handOff,
  MAX_AUTOMATIC_PURGE_ATTEMPTS,
} from "./demo-school.outbox";
import { watchUntilFinal } from "./demo-school.watch";

const CREDENTIALS_URL_TTL_SECONDS = 5 * 60;
const MCP_HIDDEN_PLATFORM = {
  // Demo provisioning, credentials and purge stay human admin actions: an
  // agent has no reason to mint demo logins, read their passwords or purge.
  exposure: "hidden",
  module: "platform",
} as const;

type DemoJobRow = typeof demoSchoolJobTable.$inferSelect;
type DemoPurgeRow = typeof demoSchoolPurgeTable.$inferSelect;

function toDemoSchoolJobDto(row: DemoJobRow): DemoSchoolJobDto {
  return demoSchoolJobDtoSchema.parse({
    id: row.id,
    schoolId: row.schoolId,
    status: row.status,
    steps: [...DEMO_SCHOOL_STEPS],
    currentStep: row.currentStep,
    completedSteps: row.completedSteps,
    attempt: row.attempt,
    error: row.error,
    summary: row.result
      ? { counts: row.result.counts, amounts: row.result.amounts, hasCredentials: row.result.credentialsS3Key !== null }
      : null,
    asOf: row.asOf,
    createdAt: row.createdAt,
    startRequestedAt: row.startRequestedAt,
    submittedAt: row.submittedAt,
    lastSubmitError: row.lastSubmitError,
    purgeRequestedAt: row.purgeRequestedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  });
}

function toDemoSchoolPurgeDto(row: DemoPurgeRow): DemoSchoolPurgeDto {
  return demoSchoolPurgeDtoSchema.parse({
    schoolId: row.schoolId,
    schoolName: row.schoolName,
    schoolSlug: row.schoolSlug,
    status: row.status,
    stages: [...DEMO_SCHOOL_PURGE_STAGES],
    stage: row.stage,
    attempt: row.attempt,
    automaticRetryPending: row.status === "failed" && row.attempt < MAX_AUTOMATIC_PURGE_ATTEMPTS,
    error: row.lastError,
    lastSubmitError: row.lastSubmitError,
    dataDeletedAt: row.dataDeletedAt,
    createdAt: row.createdAt,
    scheduledAt: row.scheduledAt,
    completedAt: row.completedAt,
  });
}

async function findJob(db: DatabaseExecutor, jobId: string) {
  const [job] = await db.select().from(demoSchoolJobTable).where(eq(demoSchoolJobTable.id, jobId)).limit(1);
  if (!job) throw rpcError.notFound("Demo school job");
  return job;
}

async function findPurge(db: DatabaseExecutor, schoolId: string) {
  const [purge] = await db.select().from(demoSchoolPurgeTable).where(eq(demoSchoolPurgeTable.schoolId, schoolId)).limit(1);
  if (!purge) throw rpcError.notFound("Demo school purge");
  return purge;
}

/** A purge needs an admin when it failed, or while its hand-over to Restate keeps failing. */
const purgeNeedsAttention = or(
  eq(demoSchoolPurgeTable.status, "failed"),
  and(eq(demoSchoolPurgeTable.status, "pending"), isNotNull(demoSchoolPurgeTable.lastSubmitError)),
);

export const demoSchoolRouter = {
  listDemoClassCatalogue: protectedProcedure
    .route({
      summary: "List demo classes",
      description:
        "List the classes a demo school can be seeded with, in display order. Requires permission to read demo schools.",
      tags: ["System Admin", "Demo schools"],
    })
    .meta({ mcp: { ...MCP_HIDDEN_PLATFORM, access: "read", destructive: false } })
    .input(listDemoClassCatalogueInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.READ_DEMO_SCHOOL))
    .output(listDemoClassCatalogueOutputSchema)
    .handler(({ input }) => {
      const { currentPage, pageSize, offset } = resolvePaginationInput(input);
      const catalogue = demoClassCatalogue();
      const ordered = input.orderBy.direction === "asc" ? catalogue : [...catalogue].reverse();
      const totalPages = Math.ceil(catalogue.length / pageSize);
      return createPaginatedResult({
        items: ordered.slice(offset, offset + pageSize),
        nextCursor: createNextPageCursor(currentPage, totalPages),
        currentPage,
        totalPages,
        totalItems: catalogue.length,
        pageSize,
      });
    }),

  createDemoSchool: protectedProcedure
    .route({
      summary: "Create a demo school",
      description:
        "Create a demo school, make the requesting platform admin its principal and queue its seeding job, in one transaction. Start the job with startDemoSchoolJob. Requires permission to create demo schools.",
      tags: ["System Admin", "Demo schools"],
    })
    .meta({ mcp: { ...MCP_HIDDEN_PLATFORM, access: "write", destructive: false } })
    .input(createDemoSchoolInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.CREATE_DEMO_SCHOOL))
    .output(createDemoSchoolOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const adminId = context.session.user.id;
        const baseSlug = input.slug ?? slugifySchoolName(input.name);
        if (!baseSlug) throw rpcError.badRequest("The school name must contain letters or digits.");
        const slug = await uniqueSlug(baseSlug, async (candidate) =>
          (await context.db.select({ id: schoolTable.id }).from(schoolTable).where(eq(schoolTable.slug, candidate)).limit(1)).length > 0,
        );
        // The school table has no unique index on registration_no, so a
        // generated number is checked and redrawn on the (rare) collision.
        let registrationNo = input.registrationNo;
        while (!registrationNo) {
          const candidate = generateRegistrationNumber();
          const [taken] = await context.db.select({ id: schoolTable.id }).from(schoolTable).where(eq(schoolTable.registrationNo, candidate)).limit(1);
          if (!taken) registrationNo = candidate;
        }

        return await context.db.transaction(async (transaction) => {
          const [school] = await transaction
            .insert(schoolTable)
            .values({
              slug,
              name: input.name,
              location: input.location,
              registrationNo,
              isDemo: true,
              demoCreatedBy: adminId,
            })
            .returning();
          if (!school) throw rpcError.internal();
          // D1: the requesting admin becomes the demo's principal, through the
          // same membership and role rows inviteMember writes.
          await transaction.insert(schoolMemberTable).values({ schoolId: school.id, userId: adminId });
          await transaction.insert(schoolUserRoleTable).values({ schoolId: school.id, userId: adminId, role: "principal", meta: null });
          // A demo shows every product area it is configured to show
          // (DEMO_SCHOOL_FEATURE_DEFAULTS; new real schools start with no
          // feature). The seed needs them too, for example to save the
          // Cadet Portal settings.
          for (const feature of SCHOOL_FEATURE_KEYS) {
            if (!DEMO_SCHOOL_FEATURE_DEFAULTS[feature]) continue;
            await setSchoolFeature(transaction, { schoolId: school.id, feature, enabled: true, config: null, updatedBy: adminId });
          }
          const [job] = await transaction
            .insert(demoSchoolJobTable)
            .values({
              schoolId: school.id,
              requestedBy: adminId,
              input: {
                sessionStartYear: input.sessionStartYear,
                sessionEndYear: input.sessionEndYear,
                cycleStartMonth: input.cycleStartMonth,
                classSlugs: input.classSlugs,
              },
            })
            .returning();
          if (!job) throw rpcError.internal();
          return { school: toSchoolDto(school), job: toDemoSchoolJobDto(job) };
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  startDemoSchoolJob: protectedProcedure
    .route({
      summary: "Start a demo school job",
      description:
        "Request the start of a queued demo seeding job and return at once; the hand-over to the workflow engine happens in the background and is retried until it is accepted (or fails visibly after 10 minutes). Follow progress with watchDemoSchoolJob. Safe to repeat. Requires permission to create demo schools.",
      tags: ["System Admin", "Demo schools"],
    })
    .meta({ mcp: { ...MCP_HIDDEN_PLATFORM, access: "write", destructive: true } })
    .input(demoSchoolJobIdInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.CREATE_DEMO_SCHOOL))
    .output(demoSchoolJobDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const job = await findJob(context.db, input.jobId);
        if (job.purgeRequestedAt) throw rpcError.badRequest("This demo school is being purged.");
        if (job.status === "failed") {
          throw rpcError.badRequest("This demo job failed. Retry it instead of starting it again.");
        }
        if (job.status !== "queued") return toDemoSchoolJobDto(job);
        // The outbox entry: written before the hand-over, so the sweep sends
        // it if this process stops before Restate accepted it.
        const [requested] = await context.db
          .update(demoSchoolJobTable)
          .set({ startRequestedAt: sql`COALESCE(${demoSchoolJobTable.startRequestedAt}, now())` })
          .where(
            and(
              eq(demoSchoolJobTable.id, job.id),
              eq(demoSchoolJobTable.attempt, job.attempt),
              eq(demoSchoolJobTable.status, "queued"),
              isNull(demoSchoolJobTable.purgeRequestedAt),
            ),
          )
          .returning();
        if (!requested) throw rpcError.conflict("The demo job changed meanwhile. Refresh and try again.");
        handOff("start.handover", () => dispatchDemoSchoolStart(context.db, job.id));
        return toDemoSchoolJobDto(requested);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  retryDemoSchoolJob: protectedProcedure
    .route({
      summary: "Retry a failed demo school job",
      description:
        "Start a new attempt of a failed demo seeding job and return at once. Completed steps are found again and skipped, so the attempt resumes. Requires permission to create demo schools.",
      tags: ["System Admin", "Demo schools"],
    })
    .meta({ mcp: { ...MCP_HIDDEN_PLATFORM, access: "write", destructive: true } })
    .input(demoSchoolJobIdInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.CREATE_DEMO_SCHOOL))
    .output(demoSchoolJobDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const [job] = await context.db
          .update(demoSchoolJobTable)
          .set({
            status: "queued",
            attempt: sql`${demoSchoolJobTable.attempt} + 1`,
            error: null,
            finishedAt: null,
            invocationId: null,
            startRequestedAt: new Date(),
            submittedAt: null,
            submitInvocationId: null,
            submitAttempts: 0,
            lastSubmitError: null,
          })
          .where(and(eq(demoSchoolJobTable.id, input.jobId), eq(demoSchoolJobTable.status, "failed"), isNull(demoSchoolJobTable.purgeRequestedAt)))
          .returning();
        if (!job) {
          await findJob(context.db, input.jobId);
          throw rpcError.badRequest("Only a failed demo job can be retried.");
        }
        handOff("start.handover", () => dispatchDemoSchoolStart(context.db, job.id));
        return toDemoSchoolJobDto(job);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getDemoSchoolJob: protectedProcedure
    .route({
      summary: "Get a demo school job",
      description:
        "Get the status, steps and summary of a demo seeding job. Requires permission to read demo schools.",
      tags: ["System Admin", "Demo schools"],
    })
    .meta({ mcp: { ...MCP_HIDDEN_PLATFORM, access: "read", destructive: false } })
    .input(demoSchoolJobIdInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.READ_DEMO_SCHOOL))
    .output(demoSchoolJobDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return toDemoSchoolJobDto(await findJob(context.db, input.jobId));
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  watchDemoSchoolJob: protectedProcedure
    .route({
      summary: "Watch a demo school job",
      description:
        "Stream a demo seeding job as server-sent events: the current state first, then every change (step, status, error), ending when the job succeeded or failed. Requires permission to read demo schools.",
      tags: ["System Admin", "Demo schools"],
    })
    .meta({ mcp: { ...MCP_HIDDEN_PLATFORM, access: "read", destructive: false } })
    .input(demoSchoolJobIdInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.READ_DEMO_SCHOOL))
    .output(eventIterator(demoSchoolJobDtoSchema))
    .handler(async function* ({ context, input, signal }) {
      try {
        yield* watchUntilFinal({
          load: async () => toDemoSchoolJobDto(await findJob(context.db, input.jobId)),
          isFinal: (job) => job.status === "succeeded" || job.status === "failed",
          signal,
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getSchoolDemoJob: protectedProcedure
    .route({
      summary: "Get a demo school's job",
      description:
        "Get the seeding job of a demo school, so a school row can show its seeding status. Requires permission to read demo schools.",
      tags: ["System Admin", "Demo schools"],
    })
    .meta({ mcp: { ...MCP_HIDDEN_PLATFORM, access: "read", destructive: false } })
    .input(demoSchoolIdInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.READ_DEMO_SCHOOL))
    .output(demoSchoolJobDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const [job] = await context.db
          .select()
          .from(demoSchoolJobTable)
          .where(eq(demoSchoolJobTable.schoolId, input.schoolId))
          .orderBy(desc(demoSchoolJobTable.createdAt), desc(demoSchoolJobTable.id))
          .limit(1);
        if (!job) throw rpcError.notFound("Demo school job");
        return toDemoSchoolJobDto(job);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getDemoCredentialsDownload: protectedProcedure
    .route({
      summary: "Download demo credentials",
      description:
        "Get a short-lived download URL for a demo school's staff credentials CSV. Requires permission to read demo credentials.",
      tags: ["System Admin", "Demo schools"],
    })
    .meta({ mcp: { ...MCP_HIDDEN_PLATFORM, access: "read", destructive: false } })
    .input(demoSchoolIdInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.READ_DEMO_SCHOOL_CREDENTIALS))
    .output(demoCredentialsDownloadDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const [school] = await context.db
          .select({ slug: schoolTable.slug, isDemo: schoolTable.isDemo })
          .from(schoolTable)
          .where(eq(schoolTable.id, input.schoolId))
          .limit(1);
        if (!school) throw rpcError.notFound("School");
        if (!school.isDemo) throw rpcError.badRequest("Only demo schools have generated credentials.");
        const [job] = await context.db
          .select({ result: demoSchoolJobTable.result })
          .from(demoSchoolJobTable)
          .where(and(eq(demoSchoolJobTable.schoolId, input.schoolId), eq(demoSchoolJobTable.status, "succeeded")))
          .orderBy(desc(demoSchoolJobTable.createdAt))
          .limit(1);
        const key = job?.result?.credentialsS3Key;
        if (!key) throw rpcError.notFound("Demo credentials");
        const fileName = `${school.slug}-credentials.csv`;
        const url = await getSignedUrl(
          getS3Client(),
          new GetObjectCommand({
            Bucket: env.S3_BUCKET,
            Key: key,
            ResponseContentDisposition: `attachment; filename="${fileName}"`,
            ResponseCacheControl: "private, no-store",
          }),
          { expiresIn: CREDENTIALS_URL_TTL_SECONDS },
        );
        return { url, fileName, expiresAt: new Date(Date.now() + CREDENTIALS_URL_TTL_SECONDS * 1000) };
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  purgeDemoSchool: protectedProcedure
    .route({
      summary: "Purge a demo school",
      description:
        "Request the permanent removal of a demo school, all its data, its demo staff accounts and its files, and return at once. The purge runs as a durable background workflow; follow it with watchDemoSchoolPurge. Refuses real schools. The confirmation must equal the school's slug. Requires permission to purge demo schools.",
      tags: ["System Admin", "Demo schools"],
    })
    .meta({ mcp: { ...MCP_HIDDEN_PLATFORM, access: "write", destructive: true } })
    .input(purgeDemoSchoolInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.PURGE_DEMO_SCHOOL))
    .output(purgeDemoSchoolOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const [school] = await context.db.select().from(schoolTable).where(eq(schoolTable.id, input.schoolId)).limit(1);
        if (!school) throw rpcError.notFound("School");
        if (!school.isDemo) throw rpcError.badRequest("Only demo schools can be purged.");
        if (input.confirmation !== school.slug) {
          throw rpcError.badRequest(`Enter ${school.slug} exactly to confirm the purge.`);
        }

        // One transaction under the school lock: record purge intent on the
        // jobs (from here on start, retry, the control service and every
        // seed step refuse, and seed uploads delete their own objects) and
        // the purge request, which is also its outbox entry. A repeated
        // request finds the existing purge and returns it.
        const purge = await context.db.transaction(async (transaction) => {
          await transaction.select({ id: schoolTable.id }).from(schoolTable).where(eq(schoolTable.id, school.id)).for("update");
          await transaction
            .update(demoSchoolJobTable)
            .set({ purgeRequestedAt: new Date() })
            .where(and(eq(demoSchoolJobTable.schoolId, school.id), isNull(demoSchoolJobTable.purgeRequestedAt)));
          await transaction
            .insert(demoSchoolPurgeTable)
            .values({ schoolId: school.id, schoolName: school.name, schoolSlug: school.slug, requestedBy: context.session.user.id })
            .onConflictDoNothing();
          return findPurge(transaction, school.id);
        });
        handOff("purge.handover", () => dispatchDemoSchoolPurge(context.db, school.id));
        return toDemoSchoolPurgeDto(purge);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  retryDemoSchoolPurge: protectedProcedure
    .route({
      summary: "Retry a failed demo school purge",
      description:
        "Start a new attempt of a failed demo purge and return at once. Every stage is idempotent, so the attempt resumes where the last one stopped. Requires permission to purge demo schools.",
      tags: ["System Admin", "Demo schools"],
    })
    .meta({ mcp: { ...MCP_HIDDEN_PLATFORM, access: "write", destructive: true } })
    .input(demoSchoolIdInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.PURGE_DEMO_SCHOOL))
    .output(demoSchoolPurgeDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const [purge] = await context.db
          .update(demoSchoolPurgeTable)
          .set({
            status: "pending",
            attempt: sql`${demoSchoolPurgeTable.attempt} + 1`,
            invocationId: null,
            submitInvocationId: null,
            scheduledAt: null,
            lastSubmitError: null,
          })
          .where(and(eq(demoSchoolPurgeTable.schoolId, input.schoolId), eq(demoSchoolPurgeTable.status, "failed")))
          .returning();
        if (!purge) {
          await findPurge(context.db, input.schoolId);
          throw rpcError.badRequest("Only a failed demo purge can be retried.");
        }
        handOff("purge.handover", () => dispatchDemoSchoolPurge(context.db, input.schoolId));
        return toDemoSchoolPurgeDto(purge);
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  getDemoSchoolPurge: protectedProcedure
    .route({
      summary: "Get a demo school purge",
      description: "Get the status and stage of a demo school purge. Requires permission to read demo schools.",
      tags: ["System Admin", "Demo schools"],
    })
    .meta({ mcp: { ...MCP_HIDDEN_PLATFORM, access: "read", destructive: false } })
    .input(demoSchoolIdInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.READ_DEMO_SCHOOL))
    .output(demoSchoolPurgeDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        return toDemoSchoolPurgeDto(await findPurge(context.db, input.schoolId));
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  watchDemoSchoolPurge: protectedProcedure
    .route({
      summary: "Watch a demo school purge",
      description:
        "Stream a demo purge as server-sent events: the current state first, then every change (stage, status, error), ending when it completed or failed. Requires permission to read demo schools.",
      tags: ["System Admin", "Demo schools"],
    })
    .meta({ mcp: { ...MCP_HIDDEN_PLATFORM, access: "read", destructive: false } })
    .input(demoSchoolIdInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.READ_DEMO_SCHOOL))
    .output(eventIterator(demoSchoolPurgeDtoSchema))
    .handler(async function* ({ context, input, signal }) {
      try {
        yield* watchUntilFinal({
          load: async () => toDemoSchoolPurgeDto(await findPurge(context.db, input.schoolId)),
          isFinal: (purge) => purge.status === "completed" || purge.status === "failed",
          signal,
        });
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  listDemoSchoolPurges: protectedProcedure
    .route({
      summary: "List demo school purges",
      description:
        "List demo purges, newest first; by default only those that need an admin (failed, or not yet handed over with an error). Requires permission to read demo schools.",
      tags: ["System Admin", "Demo schools"],
    })
    .meta({ mcp: { ...MCP_HIDDEN_PLATFORM, access: "read", destructive: false } })
    .input(listDemoSchoolPurgesInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.READ_DEMO_SCHOOL))
    .output(listDemoSchoolPurgesOutputSchema)
    .handler(async ({ context, input }) => {
      try {
        const { currentPage, pageSize, offset } = resolvePaginationInput(input);
        const where = input.filters.needsAttention ? purgeNeedsAttention : undefined;
        const [total] = await context.db.select({ value: count() }).from(demoSchoolPurgeTable).where(where);
        const order = input.orderBy.direction === "asc" ? asc : desc;
        const rows = await context.db
          .select()
          .from(demoSchoolPurgeTable)
          .where(where)
          .orderBy(order(demoSchoolPurgeTable.createdAt), order(demoSchoolPurgeTable.schoolId))
          .limit(pageSize)
          .offset(offset);
        const totalItems = total?.value ?? 0;
        const totalPages = Math.ceil(totalItems / pageSize);
        return createPaginatedResult({
          items: rows.map(toDemoSchoolPurgeDto),
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
};
