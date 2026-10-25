import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import pg from 'pg';
import {
  legacyTemplateCatalogDirectory,
  runDirectory,
  sourceDatabaseUrl,
  sourceAuthorization,
  sourceS3Config,
} from './config.ts';
import {
  APPROVED_SCHOOL_ID,
  assertAllowedSourceSnapshot,
} from './migration-guards.ts';

const { Client } = pg;

const sourceDatabase = sourceDatabaseUrl();
const sourceAccess = sourceAuthorization();
assertAllowedSourceSnapshot({
  connectionString: sourceDatabase,
  environment: sourceAccess.environment,
  allowedDatabaseIdentities: sourceAccess.allowedDatabaseIdentities,
});
const run = runDirectory();
const sourceS3 = sourceS3Config();

type SourceObject = {
  ownerType: "school_logo" | "admission_photo" | "artifact";
  ownerId: string;
  schoolId: string;
  key: string;
  artifactType: string | null;
  sourceContentType: string | null;
  dispositionFamily:
    | 'school.logo_object'
    | 'admission.photo_object'
    | 'artifact.template_object'
    | 'artifact.generated_pdf_object'
    | 'artifact.notice_object'
    | 'artifact.unknown';
  transferPolicy: 'reference' | 'omit' | 'block';
};

type InventoryObject = SourceObject & {
  status: "available" | "missing" | "reference-only";
  byteSize?: number;
  contentType?: string;
  eTag?: string;
  lastModified?: string;
  versionId?: string;
  sha256?: string;
  contentPath?: string;
  exactLegacyCatalogMatches?: string[];
  errorCode?: string;
};

/** Hash all bundled legacy marketplace files so exact provenance can be proven. */
async function catalogHashes() {
  const root = legacyTemplateCatalogDirectory();
  const matches = new Map<string, string[]>();

  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile() && entry.name.endsWith(".hbs")) {
        const hash = createHash("sha256")
          .update(await readFile(absolute))
          .digest("hex");
        const relative = path.relative(root, absolute);
        matches.set(hash, [...(matches.get(hash) ?? []), relative]);
      }
    }
  }

  await walk(root);
  return matches;
}

/**
 * Inventory every source object reference exactly once. Only approved logo and
 * template families are fetched; omitted/blocked families remain metadata-only.
 */
async function sourceObjects(client: InstanceType<typeof Client>) {
  const result = await client.query<SourceObject>(`
    SELECT
      'school_logo'::text AS "ownerType",
      id AS "ownerId",
      id AS "schoolId",
      logo_s3_key AS key,
      NULL::text AS "artifactType",
      NULL::text AS "sourceContentType",
      'school.logo_object'::text AS "dispositionFamily",
      'reference'::text AS "transferPolicy"
    FROM school
    WHERE id=$1 AND logo_s3_key IS NOT NULL
    UNION ALL
    SELECT
      'admission_photo'::text AS "ownerType",
      id AS "ownerId",
      school_id AS "schoolId",
      photo_s3_key AS key,
      NULL::text AS "artifactType",
      NULL::text AS "sourceContentType",
      'admission.photo_object'::text AS "dispositionFamily",
      'omit'::text AS "transferPolicy"
    FROM admission
    WHERE school_id=$1 AND photo_s3_key IS NOT NULL
    UNION ALL
    SELECT
      'artifact'::text AS "ownerType",
      id AS "ownerId",
      school_id AS "schoolId",
      s3_key AS key,
      type AS "artifactType",
      content_type AS "sourceContentType",
      CASE
        WHEN type IN ('examination_template','idcard_template','admitcard_template','timetable_template','bill_template','receipt_template') THEN 'artifact.template_object'
        WHEN type IN ('result_pdf','bulk_result_pdf','bulk_admitcard_pdf','bulk_bill_pdf','bulk_idcard_pdf','exam_timetable_pdf','bill_pdf','receipt_pdf') THEN 'artifact.generated_pdf_object'
        WHEN type IN ('notice_template','notice_pdf') THEN 'artifact.notice_object'
        ELSE 'artifact.unknown'
      END::text AS "dispositionFamily",
      CASE
        WHEN type IN ('examination_template','idcard_template','admitcard_template','timetable_template','bill_template','receipt_template') THEN 'reference'
        WHEN type IN ('result_pdf','bulk_result_pdf','bulk_admitcard_pdf','bulk_bill_pdf','bulk_idcard_pdf','exam_timetable_pdf','bill_pdf','receipt_pdf','notice_template','notice_pdf') THEN 'omit'
        ELSE 'block'
      END::text AS "transferPolicy"
    FROM artifact
    WHERE school_id=$1 AND s3_key IS NOT NULL
    ORDER BY "schoolId", "ownerType", "ownerId", "dispositionFamily"
  `, [APPROVED_SCHOOL_ID]);
  return result.rows;
}

const client = new Client({ connectionString: sourceDatabase });
await client.connect();
await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
const sourceReadOnly = await client.query<{ transaction_read_only: string }>(
  "SHOW transaction_read_only",
);
if (sourceReadOnly.rows[0]?.transaction_read_only !== "on")
  throw new Error("Legacy snapshot transaction is not read-only");

const s3 = new S3Client({
  region: sourceS3.region,
  ...(sourceS3.endpoint ? { endpoint: sourceS3.endpoint } : {}),
  forcePathStyle: sourceS3.forcePathStyle,
  credentials: {
    accessKeyId: sourceS3.accessKeyId,
    secretAccessKey: sourceS3.secretAccessKey,
  },
});
const catalog = await catalogHashes();
const objectDirectory = path.join(run, "source-objects");
await mkdir(objectDirectory, { recursive: true, mode: 0o700 });
await chmod(objectDirectory, 0o700);

const inventory: InventoryObject[] = [];
for (const source of await sourceObjects(client)) {
  if (source.transferPolicy !== 'reference') {
    inventory.push({ ...source, status: 'reference-only' });
    continue;
  }
  try {
    const head = await s3.send(
      new HeadObjectCommand({ Bucket: sourceS3.bucket, Key: source.key }),
    );
    const response = await s3.send(
      new GetObjectCommand({ Bucket: sourceS3.bucket, Key: source.key }),
    );
    if (!response.Body) throw new Error("Object response has no body");
    const bytes = Buffer.from(await response.Body.transformToByteArray());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const contentPath = path.join(objectDirectory, sha256);
    await writeFile(contentPath, bytes, { mode: 0o600 });
    await chmod(contentPath, 0o600);

    inventory.push({
      ...source,
      status: "available",
      byteSize: bytes.byteLength,
      contentType: response.ContentType ?? head.ContentType,
      eTag: response.ETag ?? head.ETag,
      lastModified: (response.LastModified ?? head.LastModified)?.toISOString(),
      versionId: response.VersionId ?? head.VersionId,
      sha256,
      contentPath: path.relative(run, contentPath),
      exactLegacyCatalogMatches: catalog.get(sha256) ?? [],
    });
  } catch (error) {
    const code =
      typeof error === "object" && error && "name" in error
        ? String(error.name)
        : "UnknownError";
    inventory.push({ ...source, status: "missing", errorCode: code });
  }
}

const counts = await client.query<{
  type: string;
  count: string;
}>(`
  SELECT type, count(*)::text AS count
  FROM artifact
  WHERE school_id=$1 AND type NOT IN (
    'examination_template', 'idcard_template', 'admitcard_template',
    'timetable_template', 'bill_template', 'receipt_template'
  )
  GROUP BY type
  ORDER BY type
`, [APPROVED_SCHOOL_ID]);
const photoCount = await client.query<{ count: string }>(`
  SELECT count(*)::text AS count
  FROM admission
  WHERE school_id=$1 AND photo_s3_key IS NOT NULL
`, [APPROVED_SCHOOL_ID]);

const report = {
  schemaVersion: 1,
  bucketIdentity: { bucket: sourceS3.bucket, region: sourceS3.region },
  generatedPdfAndDeferredCounts: Object.fromEntries(
    counts.rows.map((row) => [row.type, Number(row.count)]),
  ),
  admissionPhotoCountOnly: Number(photoCount.rows[0]?.count ?? 0),
  objects: inventory,
};

const reportPath = path.join(run, "source-object-manifest.json");
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
  mode: 0o600,
});
await chmod(reportPath, 0o600);
await client.query("ROLLBACK");
await client.end();

console.log(
  JSON.stringify({
    inScope: inventory.length,
    available: inventory.filter((item) => item.status === "available").length,
    missing: inventory.filter((item) => item.status === "missing").length,
    exactCatalogMatches: inventory.filter(
      (item) => (item.exactLegacyCatalogMatches?.length ?? 0) > 0,
    ).length,
    reportPath,
  }),
);
