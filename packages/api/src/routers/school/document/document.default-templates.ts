import { createHash } from "node:crypto";

import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { DatabaseExecutor } from "@campuspilot/db";
import { generateId } from "@campuspilot/db/id";
import { artifactTable, schoolDocumentTemplateTable } from "@campuspilot/db/schema/artifact";
import { env } from "@campuspilot/env/server";
import { getS3Client } from "@campuspilot/s3/client";

import { DEFAULT_DOCUMENT_TEMPLATE_SLUGS, DOCUMENT_MARKETPLACE } from "./document.catalog";
import { deleteDocumentObject } from "./document.storage";

/**
 * The template objects uploaded for a school being created, so they can be
 * removed when its transaction does not commit. S3 and PostgreSQL share no
 * transaction (docs/document-system.md "Data and immutable lifecycle"): the
 * objects are written first, inside the creating transaction, and
 * {@link withDefaultDocumentTemplates} deletes them when it fails.
 */
export class DefaultTemplateUploads {
  readonly keys: string[] = [];

  /** Deletes every recorded object; throws the failures together after trying all. */
  async discard() {
    const results = await Promise.allSettled(this.keys.map((key) => deleteDocumentObject(key)));
    const failures = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
    if (failures.length) throw new AggregateError(failures, "Removing default template uploads failed.");
  }
}

/**
 * Runs a school's creation (`run`, which opens and commits its own
 * transaction) with compensation for the default template objects it
 * uploads: when `run` throws, the uploaded objects are deleted and the
 * original error is rethrown (with the cleanup error when that fails too, as
 * `persistDocumentObject` does).
 */
export async function withDefaultDocumentTemplates<T>(run: (uploads: DefaultTemplateUploads) => Promise<T>): Promise<T> {
  const uploads = new DefaultTemplateUploads();
  try {
    return await run(uploads);
  } catch (cause) {
    try {
      await uploads.discard();
    } catch (cleanupError) {
      throw new AggregateError([cause, cleanupError], "School creation and default template cleanup failed.");
    }
    throw cause;
  }
}

/**
 * Selects the default design of every type for a new school
 * (`DEFAULT_DOCUMENT_TEMPLATE_SLUGS`: the CampusPilot Standard set and the
 * full-A4 statement), in the creating transaction, exactly as importing each
 * from the marketplace would: a new immutable school-owned object per type,
 * an `artifact` revision with the design's name, footprint and marketplace
 * slug, and the school's selection pointing at it. The school must have no
 * selection yet (it was created in this transaction). `createdBy` is who
 * created the school.
 *
 * Every school created through self-service, by a platform administrator or
 * from an onboarding submission gets them; a personal space never does, and
 * demo schools select the same slugs through their seed. Callers record the
 * uploads in `uploads` and run inside {@link withDefaultDocumentTemplates}.
 */
export async function selectDefaultDocumentTemplates(
  db: DatabaseExecutor,
  uploads: DefaultTemplateUploads,
  input: { schoolId: string; createdBy: string },
) {
  const designs = Object.entries(DEFAULT_DOCUMENT_TEMPLATE_SLUGS).map(([documentType, slug]) => {
    const design = DOCUMENT_MARKETPLACE.find((item) => item.slug === slug && item.documentType === documentType);
    if (!design) throw new Error(`The catalog has no ${slug} design for ${documentType}.`);
    const id = generateId("artifact");
    const bytes = Buffer.from(design.content);
    return {
      design,
      bytes,
      row: {
        id,
        schoolId: input.schoolId,
        kind: "template" as const,
        documentType: design.documentType,
        name: design.name,
        s3Key: `schools/${input.schoolId}/document-templates/${id}.hbs`,
        contentType: "text/x-handlebars-template",
        byteSize: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        pageSize: design.pageSize,
        marketplaceSlug: design.slug,
        createdBy: input.createdBy,
      },
    };
  });
  // Each key is recorded before its upload (deleting a key that was never
  // written is harmless), and every upload settles before a failure is
  // thrown, so the compensation never runs while an upload is still landing.
  const puts = await Promise.allSettled(
    designs.map(({ row, bytes }) => {
      uploads.keys.push(row.s3Key);
      return getS3Client().send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: row.s3Key, Body: bytes, ContentType: row.contentType }));
    }),
  );
  const failed = puts.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
  await db.insert(artifactTable).values(designs.map(({ row }) => row));
  await db
    .insert(schoolDocumentTemplateTable)
    .values(designs.map(({ row }) => ({ schoolId: input.schoolId, documentType: row.documentType, artifactId: row.id })));
  return designs.map(({ row }) => ({ documentType: row.documentType, revisionId: row.id }));
}
