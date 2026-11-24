import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { db } from "@campuspilot/db";
import { artifactTable } from "@campuspilot/db/schema/artifact";
import { env } from "@campuspilot/env/server";
import { getS3Client } from "@campuspilot/s3/client";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { selectedTemplateSlugs } from "../../../../test/documents";
import { createTestSchool, createTestUser } from "../../../../test/fixtures";
import { DEFAULT_DOCUMENT_TEMPLATE_SLUGS, DOCUMENT_MARKETPLACE } from "./document.catalog";
import { selectDefaultDocumentTemplates, withDefaultDocumentTemplates } from "./document.default-templates";
import { readDocumentTemplate } from "./document.storage";

/** The default templates of a new school (docs/document-system.md "Default templates"). */
describe("default document templates", () => {
  it("selects a school-owned copy of every default design, as a marketplace import would", async () => {
    const school = await createTestSchool();
    const creator = await createTestUser();
    await withDefaultDocumentTemplates((uploads) =>
      db.transaction((tx) => selectDefaultDocumentTemplates(tx, uploads, { schoolId: school.id, createdBy: creator.id })),
    );
    expect(await selectedTemplateSlugs(school.id)).toEqual(DEFAULT_DOCUMENT_TEMPLATE_SLUGS);
    const revisions = await db.select().from(artifactTable).where(eq(artifactTable.schoolId, school.id));
    expect(revisions).toHaveLength(Object.keys(DEFAULT_DOCUMENT_TEMPLATE_SLUGS).length);
    for (const revision of revisions) {
      const design = DOCUMENT_MARKETPLACE.find((item) => item.slug === revision.marketplaceSlug)!;
      expect(revision).toMatchObject({ kind: "template", status: "ready", name: design.name, pageSize: design.pageSize, createdBy: creator.id });
      expect(revision.s3Key.startsWith(`schools/${school.id}/document-templates/`)).toBe(true);
      expect(await readDocumentTemplate(revision.s3Key)).toBe(design.content);
    }
  });

  it("removes the uploaded objects when the creating transaction fails", async () => {
    const school = await createTestSchool();
    const creator = await createTestUser();
    let keys: string[] = [];
    await expect(
      withDefaultDocumentTemplates((uploads) =>
        db.transaction(async (tx) => {
          await selectDefaultDocumentTemplates(tx, uploads, { schoolId: school.id, createdBy: creator.id });
          keys = [...uploads.keys];
          throw new Error("creation failed after the templates");
        }),
      ),
    ).rejects.toThrow("creation failed after the templates");
    expect(keys).toHaveLength(Object.keys(DEFAULT_DOCUMENT_TEMPLATE_SLUGS).length);
    expect(await selectedTemplateSlugs(school.id)).toEqual({});
    for (const key of keys)
      await expect(getS3Client().send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }))).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
  });
});
