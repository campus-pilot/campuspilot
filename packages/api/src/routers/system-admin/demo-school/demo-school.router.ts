import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { auth } from "@campuspilot/auth/server";
import type { DatabaseExecutor } from "@campuspilot/db";
import { admissionTable } from "@campuspilot/db/schema/admission";
import { artifactTable } from "@campuspilot/db/schema/artifact";
import { user } from "@campuspilot/db/schema/auth";
import { demoSchoolJobTable } from "@campuspilot/db/schema/demo-school-job";
import { schoolTable } from "@campuspilot/db/schema/school";
import { schoolMemberTable } from "@campuspilot/db/schema/school-member";
import { schoolUserRoleTable } from "@campuspilot/db/schema/school-user-role";
import { env } from "@campuspilot/env/server";
import { SYSTEM_ACTIONS } from "@campuspilot/opa/policies/system";
import { getS3Client } from "@campuspilot/s3/client";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { rpcError, toRpcError } from "../../../errors";
import { protectedProcedure } from "../../../index";
import {
  createNextPageCursor,
  createPaginatedResult,
  resolvePaginationInput,
} from "../../../paginations";
import { requireSystemPermission } from "../../../permissions/system";
import { DEMO_SCHOOL_STEPS, demoCredentialsS3Key } from "../../../workflows/demo-school/constants";
import {
  generateRegistrationNumber,
  slugifySchoolName,
  uniqueSlug,
} from "../../../workflows/demo-school/identity";
import { log } from "../../../workflows/demo-school/log";
import { demoClassCatalogue } from "../../../workflows/demo-school/seed";
import { toSchoolDto } from "../school/school.dto";
import {
  createDemoSchoolInputSchema,
  createDemoSchoolOutputSchema,
  demoCredentialsDownloadDtoSchema,
  demoSchoolIdInputSchema,
  demoSchoolJobDtoSchema,
  demoSchoolJobIdInputSchema,
  listDemoClassCatalogueInputSchema,
  listDemoClassCatalogueOutputSchema,
  purgeDemoSchoolInputSchema,
  purgeDemoSchoolOutputSchema,
  type DemoSchoolJobDto,
} from "./demo-school.dto";
import {
  cancelRestateInvocation,
  submitDemoSchoolPurgeWorkflow,
  submitDemoSchoolWorkflow,
} from "./demo-school.restate";

const CREDENTIALS_URL_TTL_SECONDS = 5 * 60;
const MCP_HIDDEN_PLATFORM = {
  // Demo provisioning, credentials and purge stay human admin actions: an
  // agent has no reason to mint demo logins, read their passwords or purge.
  exposure: "hidden",
  module: "platform",
} as const;

type DemoJobRow = typeof demoSchoolJobTable.$inferSelect;

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
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  });
}

async function findJob(db: DatabaseExecutor, jobId: string) {
  const [job] = await db.select().from(demoSchoolJobTable).where(eq(demoSchoolJobTable.id, jobId)).limit(1);
  if (!job) throw rpcError.notFound("Demo school job");
  return job;
}

/** Submits the job's current attempt and records its Restate invocation. */
async function submitJob(db: DatabaseExecutor, job: DemoJobRow) {
  let invocationId: string;
  try {
    ({ invocationId } = await submitDemoSchoolWorkflow(job.id, job.attempt));
  } catch (error) {
    log.error({ err: error, jobId: job.id }, "demo-school.submit.failed");
    throw rpcError.internal(error);
  }
  const [updated] = await db
    .update(demoSchoolJobTable)
    .set({ invocationId })
    .where(eq(demoSchoolJobTable.id, job.id))
    .returning();
  return updated ?? job;
}

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
        "Submit a queued demo seeding job to the workflow engine. Safe to repeat: a running attempt is reused. Requires permission to create demo schools.",
      tags: ["System Admin", "Demo schools"],
    })
    .meta({ mcp: { ...MCP_HIDDEN_PLATFORM, access: "write", destructive: true } })
    .input(demoSchoolJobIdInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.CREATE_DEMO_SCHOOL))
    .output(demoSchoolJobDtoSchema)
    .handler(async ({ context, input }) => {
      try {
        const job = await findJob(context.db, input.jobId);
        if (job.status === "failed") {
          throw rpcError.badRequest("This demo job failed. Retry it instead of starting it again.");
        }
        if (job.status === "succeeded") return toDemoSchoolJobDto(job);
        return toDemoSchoolJobDto(await submitJob(context.db, job));
      } catch (error) {
        throw toRpcError(error);
      }
    }),

  retryDemoSchoolJob: protectedProcedure
    .route({
      summary: "Retry a failed demo school job",
      description:
        "Start a new attempt of a failed demo seeding job. Completed steps are found again and skipped, so the attempt resumes. Requires permission to create demo schools.",
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
          })
          .where(and(eq(demoSchoolJobTable.id, input.jobId), eq(demoSchoolJobTable.status, "failed")))
          .returning();
        if (!job) {
          await findJob(context.db, input.jobId);
          throw rpcError.badRequest("Only a failed demo job can be retried.");
        }
        return toDemoSchoolJobDto(await submitJob(context.db, job));
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
        "Permanently remove a demo school, all its data, its demo staff accounts and its files. Refuses real schools. The confirmation must equal the school's slug. Requires permission to purge demo schools.",
      tags: ["System Admin", "Demo schools"],
    })
    .meta({ mcp: { ...MCP_HIDDEN_PLATFORM, access: "write", destructive: true } })
    .input(purgeDemoSchoolInputSchema)
    .use(requireSystemPermission(SYSTEM_ACTIONS.PURGE_DEMO_SCHOOL))
    .output(purgeDemoSchoolOutputSchema)
    .handler(async ({ context, input, signal }) => {
      try {
        const [school] = await context.db.select().from(schoolTable).where(eq(schoolTable.id, input.schoolId)).limit(1);
        if (!school) throw rpcError.notFound("School");
        if (!school.isDemo) throw rpcError.badRequest("Only demo schools can be purged.");
        if (input.confirmation !== school.slug) {
          throw rpcError.badRequest(`Enter ${school.slug} exactly to confirm the purge.`);
        }

        // 5. Stop any seed still running, so it cannot write into a school
        // being removed. The system-job guard also refuses once it is gone.
        const jobs = await context.db
          .select({ invocationId: demoSchoolJobTable.invocationId })
          .from(demoSchoolJobTable)
          .where(and(eq(demoSchoolJobTable.schoolId, school.id), inArray(demoSchoolJobTable.status, ["queued", "running"])));
        for (const { invocationId } of jobs) {
          if (invocationId) await cancelRestateInvocation(invocationId, signal);
        }

        // 1–2. Every S3 key the school and its demo users own, plus prefixes
        // to list again for orphans.
        const demoUsers = await context.db
          .select({ id: user.id, profileImageS3Key: user.profileImageS3Key })
          .from(user)
          .where(eq(user.demoSchoolId, school.id));
        const admissions = await context.db
          .select({ photoS3Key: admissionTable.photoS3Key, documents: admissionTable.documents })
          .from(admissionTable)
          .where(eq(admissionTable.schoolId, school.id));
        const artifacts = await context.db.select({ s3Key: artifactTable.s3Key }).from(artifactTable).where(eq(artifactTable.schoolId, school.id));
        const keys = [
          school.logoS3Key,
          demoCredentialsS3Key(school.id),
          ...demoUsers.map((item) => item.profileImageS3Key),
          ...admissions.flatMap((item) => [item.photoS3Key, ...item.documents.flatMap((document) => document.files.map((file) => file.s3Key))]),
          ...artifacts.map((item) => item.s3Key),
        ].filter((key): key is string => Boolean(key));
        const prefixes = [`schools/${school.id}/`, ...demoUsers.map((item) => `users/${item.id}/`)];

        // Revoke demo logins first, including sessions cached in Redis that a
        // database cascade alone would not remove.
        const authContext = await auth.$context;
        for (const demoUser of demoUsers) await authContext.internalAdapter.deleteUserSessions(demoUser.id);

        // 3. One transaction: the database purge, which also removes the demo
        // users. The requesting admin has no demo_school_id and survives.
        const deletedRows = await context.db.transaction(async (transaction) => {
          const result = await transaction.execute<{ counts: Record<string, number> }>(
            sql`SELECT purge_demo_school(${school.id}) AS counts`,
          );
          return result.rows[0]?.counts ?? {};
        });

        // 4. After commit, durable S3 cleanup.
        let fileCleanupScheduled = true;
        try {
          await submitDemoSchoolPurgeWorkflow({ schoolId: school.id, keys: [...new Set(keys)], prefixes });
        } catch (error) {
          fileCleanupScheduled = false;
          log.error({ err: error, schoolId: school.id }, "demo-school.purge.s3-schedule.failed");
        }
        log.info({ schoolId: school.id, deletedRows, s3Objects: keys.length, fileCleanupScheduled }, "demo-school.purge.ok");
        return { schoolId: school.id, deletedRows, fileCount: new Set(keys).size, fileCleanupScheduled };
      } catch (error) {
        throw toRpcError(error);
      }
    }),
};
