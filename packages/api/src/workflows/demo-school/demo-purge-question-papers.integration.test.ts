import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { db } from '@campuspilot/db';
import { assistantAttachmentTable, assistantModelRequestTable } from '@campuspilot/db/schema/assistant';
import { artifactTable } from '@campuspilot/db/schema/artifact';
import {
  examQuestionPaperFigureTable,
  examQuestionPaperJobTable,
  examQuestionPaperPageTable,
  examQuestionPaperTable,
  examQuestionPaperVersionTable,
} from '@campuspilot/db/schema/exam-question-paper';
import { demoSchoolPurgeTable } from '@campuspilot/db/schema/demo-school-job';
import { env } from '@campuspilot/env/server';
import { QUESTION_PAPER_EXAMPLES } from '@campuspilot/question-paper/examples';
import { getS3Client } from '@campuspilot/s3/client';
import { eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { createQuestionPaperWorld } from '../../../test/question-paper';
import { resolvePaperScope } from '../../routers/school/question-paper/question-paper.scope';
import { addQuestionPaperFigure, addQuestionPaperPage } from '../../routers/school/question-paper/question-paper.service';
import { putObject } from '../../routers/school/question-paper/question-paper.storage';
import { saveQuestionPaperVersion } from '../../routers/school/question-paper/question-paper.version.service';
import { collectDemoSchoolObjectKeys, runDemoSchoolPurgeStages } from './purge-workflow';

// No seed run is live in this test; the purge's stop stage asks Restate for them.
vi.mock('./restate-admin', () => ({ listLiveDemoSeedInvocations: vi.fn(async () => []) }));

const exists = (key: string) => getS3Client().send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key })).then(() => true, () => false);
const png = (color: string) => sharp({ create: { width: 320, height: 200, channels: 3, background: color } }).png().toBuffer();

/** The purge function's own row counts and the rows still referencing the school afterwards. */
async function rowsReferencing(schoolId: string) {
  const tables = await db.execute<{ table_name: string }>(sql`
    SELECT conrelid::regclass::text AS table_name FROM pg_constraint WHERE contype = 'f' AND confrelid = 'school'::regclass
  `);
  const remaining: Record<string, number> = {};
  for (const { table_name } of tables.rows) {
    const column = table_name === '"user"' ? 'demo_school_id' : 'school_id';
    const result = await db.execute<{ count: string }>(sql.raw(`SELECT count(*)::text AS count FROM ${table_name} WHERE "${column}" = '${schoolId}'`));
    remaining[table_name] = Number(result.rows[0]!.count);
  }
  return remaining;
}

describe('demo purge of question papers and chat images', () => {
  it('deletes the papers, pages, figures, versions, jobs, model costs, chat images and every object of a demo school, and nothing of another', async () => {
    // The file stage only accepts production-format school IDs.
    const productionId = () => `sch_${crypto.randomUUID().replaceAll('-', '').slice(0, 21)}`;
    const make = async (isDemo: boolean) => {
      const world = await createQuestionPaperWorld({ school: { id: productionId(), isDemo } });
      const scope = await resolvePaperScope(db, world.key());
      const userId = world.people.manager.userId;
      const page = await addQuestionPaperPage(db, { scope, userId, file: { bytes: await png('#eee'), contentType: 'image/png', extension: 'png', name: 'page.png' } });
      await addQuestionPaperFigure(db, { scope, userId, bytes: await png('#ccd') });
      await saveQuestionPaperVersion(db, { scope, userId, expectedVersionNo: 0, html: QUESTION_PAPER_EXAMPLES['english-science'], source: { kind: 'agent', conversationId: null } });
      const paper = (await db.select().from(examQuestionPaperTable).where(eq(examQuestionPaperTable.schoolId, world.schoolId)))[0]!;
      // A finished job and the cost row it wrote (no chat run: the cost is owned by the job).
      const [job] = await db
        .insert(examQuestionPaperJobTable)
        .values({ paperId: paper.id, schoolId: world.schoolId, requestedBy: userId, status: 'failed', pageIds: [page.page.id], pageRevision: 1, errorCode: 'model_rejected', errorMessage: 'No.', completedAt: new Date() })
        .returning();
      await db.insert(assistantModelRequestTable).values({
        source: 'question_paper', questionPaperJobId: job!.id, schoolId: world.schoolId, userId, requestKey: `qp:${job!.id}.1:model:1`, provider: 'gemini', requestedModel: 'm', answeredModel: 'm', usageComplete: true,
        inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
        inputUsdPerMtok: '1', outputUsdPerMtok: '1', cacheReadUsdPerMtok: '0', cacheWriteUsdPerMtok: '0', costUsd: '0.000002',
      });
      // An unsent chat image of the school, with its object under the school's prefix.
      const attachmentKey = `schools/${world.schoolId}/assistant/attachments/${crypto.randomUUID()}/original.png`;
      await putObject(attachmentKey, await png('#fdd'), 'image/png');
      await db.insert(assistantAttachmentTable).values({
        schoolId: world.schoolId, userId, kind: 'image', originalName: 'photo.png', contentType: 'image/png', byteSize: 10, sha256: 'a'.repeat(64), s3Key: attachmentKey, derivativeStatus: 'unsupported',
      });
      // An unsent chat PDF, stored as uploaded under the same prefix.
      const documentKey = `schools/${world.schoolId}/assistant/attachments/${crypto.randomUUID()}/original.pdf`;
      await putObject(documentKey, Buffer.from('%PDF-1.7\n%%EOF\n'), 'application/pdf');
      await db.insert(assistantAttachmentTable).values({
        schoolId: world.schoolId, userId, kind: 'document', originalName: 'paper.pdf', contentType: 'application/pdf', byteSize: 15, sha256: 'b'.repeat(64), s3Key: documentKey, derivativeStatus: null,
      });
      const [pageRow] = await db.select().from(examQuestionPaperPageTable).where(eq(examQuestionPaperPageTable.paperId, paper.id));
      const [figureRow] = await db.select().from(examQuestionPaperFigureTable).where(eq(examQuestionPaperFigureTable.paperId, paper.id));
      const [versionRow] = await db.select().from(examQuestionPaperVersionTable).where(eq(examQuestionPaperVersionTable.paperId, paper.id));
      const [pdf] = await db.select().from(artifactTable).where(eq(artifactTable.id, versionRow!.pdfArtifactId!));
      return {
        schoolId: world.schoolId,
        keys: [pageRow!.originalS3Key, pageRow!.thumbS3Key!, pageRow!.modelS3Key!, figureRow!.s3Key, pdf!.s3Key, attachmentKey, documentKey],
      };
    };
    const demo = await make(true);
    const real = await make(false);
    for (const key of [...demo.keys, ...real.keys]) expect(await exists(key), key).toBe(true);

    await db.insert(demoSchoolPurgeTable).values({ schoolId: demo.schoolId, status: 'pending', attempt: 1 });
    const purged = await runDemoSchoolPurgeStages({ schoolId: demo.schoolId, attempt: 1, step: (_name, action) => action(), stopSeedRuns: async () => undefined });
    expect(purged.status).toBe('completed');

    for (const key of demo.keys) expect(await exists(key), key).toBe(false);
    expect(await collectDemoSchoolObjectKeys({ keys: [], prefixes: [`schools/${demo.schoolId}/`] })).toEqual([]);
    for (const table of [examQuestionPaperTable, examQuestionPaperPageTable, examQuestionPaperFigureTable, examQuestionPaperVersionTable, examQuestionPaperJobTable, assistantAttachmentTable, assistantModelRequestTable]) {
      expect(await db.select().from(table).where(eq(table.schoolId, demo.schoolId)), `${table}`).toHaveLength(0);
    }
    expect(Object.values(await rowsReferencing(demo.schoolId)).every((count) => count === 0)).toBe(true);

    // The other school keeps every row and object.
    for (const key of real.keys) expect(await exists(key), key).toBe(true);
    expect(await db.select().from(examQuestionPaperVersionTable).where(eq(examQuestionPaperVersionTable.schoolId, real.schoolId))).toHaveLength(1);
    expect(await db.select().from(assistantAttachmentTable).where(eq(assistantAttachmentTable.schoolId, real.schoolId))).toHaveLength(2);
    expect(await db.select().from(assistantModelRequestTable).where(eq(assistantModelRequestTable.schoolId, real.schoolId))).toHaveLength(1);
  }, 120_000);
});
