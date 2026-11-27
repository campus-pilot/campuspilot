import { db } from '@campuspilot/db';
import { artifactTable, schoolDocumentTemplateTable } from '@campuspilot/db/schema/artifact';
import { documentGenerationJobTable } from '@campuspilot/db/schema/document-generation-job';
import { eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { artifactDtoSchema } from '../src/routers/school/document/document.dto';
import {
  runDocumentGeneration,
  type DocumentGenerationDeps,
  type StepRunner,
} from '../src/workflows/document-generation/generation';
import type { createTestClient } from './fixtures';

/**
 * Document generation in tests. `generateDocument` only queues a job (the
 * worker makes the PDF), so tests run the job themselves, in-process and
 * without Restate: every step runs once, directly, and an error escapes the
 * step at once (Restate would first retry it). The router's background
 * hand-over to Restate fails harmlessly in tests (no signing secret, no
 * Restate) and only records `last_handover_error`.
 */

/** Runs each step directly, as Restate would on a first attempt that succeeds or fails for good. */
export const directSteps: StepRunner = (_name, action) => action();

/** Runs a queued job to its end in this process. */
export function runDocumentJob(jobId: string, deps?: DocumentGenerationDeps) {
  return runDocumentGeneration({ jobId }, directSteps, deps ? { deps } : {});
}

export async function readDocumentJob(jobId: string) {
  const [row] = await db.select().from(documentGenerationJobTable).where(eq(documentGenerationJobTable.id, jobId));
  return row!;
}

const templateRevision = alias(artifactTable, 'test_document_template_revision');

/** The PDF artifact a job created, as `listDocumentArtifacts` serializes it. */
export async function readJobArtifact(artifactId: string) {
  const [row] = await db
    .select({ artifact: artifactTable, templateName: templateRevision.name })
    .from(artifactTable)
    .leftJoin(templateRevision, eq(templateRevision.id, artifactTable.templateRevisionId))
    .where(eq(artifactTable.id, artifactId));
  if (!row) throw new Error(`No artifact ${artifactId}.`);
  return artifactDtoSchema.parse({ ...row.artifact, templateName: row.templateName, createdAt: row.artifact.createdAt.toISOString() });
}

type GenerateInput = Parameters<ReturnType<typeof createTestClient>['school']['generateDocument']>[0];

/**
 * What `generateDocument` returned before generation became a job: starts
 * the job as `client`, runs it, and returns its artifact and warnings.
 * Throws the job's failure (code and message) when it did not succeed.
 */
export async function generateDocumentNow(client: ReturnType<typeof createTestClient>, input: GenerateInput) {
  const { jobId } = await client.school.generateDocument(input);
  const outcome = await runDocumentJob(jobId);
  const job = await readDocumentJob(jobId);
  if (outcome.status !== 'succeeded') throw Object.assign(new Error(job.errorMessage ?? 'The job did not succeed.'), { code: job.errorCode });
  return { artifact: await readJobArtifact(job.artifactId), warnings: job.warnings, jobId };
}

/**
 * The design selected for each document type of a school, by marketplace
 * slug (docs/document-system.md "Default templates"); an empty object for a
 * school with no selection.
 */
export async function selectedTemplateSlugs(schoolId: string): Promise<Record<string, string | null>> {
  const rows = await db
    .select({ documentType: schoolDocumentTemplateTable.documentType, slug: artifactTable.marketplaceSlug, pageSize: artifactTable.pageSize })
    .from(schoolDocumentTemplateTable)
    .innerJoin(artifactTable, eq(artifactTable.id, schoolDocumentTemplateTable.artifactId))
    .where(eq(schoolDocumentTemplateTable.schoolId, schoolId));
  return Object.fromEntries(rows.map((row) => [row.documentType, row.slug]));
}
