import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { db } from '@campuspilot/db';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { artifactTable } from '@campuspilot/db/schema/artifact';
import { classTable } from '@campuspilot/db/schema/class';
import { documentGenerationJobTable } from '@campuspilot/db/schema/document-generation-job';
import { examPlanTable } from '@campuspilot/db/schema/exam';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';
import { and, eq } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';

import { directSteps, readDocumentJob, runDocumentJob } from '../../../test/documents';
import {
  createSchoolStaffSession,
  createTestAdmission,
  createTestClass,
  createTestClient,
  createTestSchool,
  createTestSession,
  createTestStudent,
  includeTestExamClasses,
} from '../../../test/fixtures';
import { buildDocumentContexts } from '../../routers/school/document/document.context';
import { combineDocuments, convertDocumentPdf, renderDocuments } from '../../routers/school/document/document.render';
import { DOCUMENT_BATCH_LIMITS } from './batches';
import { defaultDocumentGenerationDeps, runDocumentGeneration, type StepRunner } from './generation';
import { documentJobPrefix } from './storage';

/** A 1 x 1 PNG, the school logo of these tests. */
const LOGO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function objectBytes(key: string) {
  const object = await getS3Client().send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  return Buffer.from(await object.Body!.transformToByteArray());
}

async function listKeys(prefix: string) {
  const listed = await getS3Client().send(new ListObjectsV2Command({ Bucket: env.S3_BUCKET, Prefix: prefix }));
  return (listed.Contents ?? []).map((object) => object.Key!).sort();
}

async function pageCount(bytes: Uint8Array) {
  return (await PDFDocument.load(bytes)).getPageCount();
}

describe('document generation jobs (batched, in the worker)', () => {
  let manager: ReturnType<typeof createTestClient>;
  let teacher: ReturnType<typeof createTestClient>;
  let schoolId: string;
  let sessionId: string;
  let classId: string;
  let idCardRevision: string;
  let admitRevision: string;
  const studentIds: string[] = [];

  beforeAll(async () => {
    schoolId = (await createTestSchool()).id;
    sessionId = (await createTestSession({ schoolId, sessionStartYear: 2026, sessionEndYear: 2027 })).id;
    classId = (await createTestClass({ schoolId, label: 'Grade 5' })).schoolClass.id;
    manager = createTestClient((await createSchoolStaffSession(schoolId, [{ role: 'manager' }])).session);
    teacher = createTestClient((await createSchoolStaffSession(schoolId, [{ role: 'teacher', meta: { classIds: [] } }])).session);
    const logoKey = `schools/${schoolId}/logo/test-logo.png`;
    await getS3Client().send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: logoKey, Body: LOGO, ContentType: 'image/png' }));
    await db.update(schoolTable).set({ logoS3Key: logoKey }).where(eq(schoolTable.id, schoolId));
    for (let index = 0; index < 17; index += 1) {
      const admission = await createTestAdmission({ schoolId, name: `Batch student ${String(index).padStart(2, '0')}` });
      studentIds.push((await createTestStudent({ schoolId, sessionId, classId, admissionId: admission.id, rollNo: index + 1 })).id);
    }
    // Admit cards need an examination with a plan for the class.
    await db
      .update(classTable)
      .set({ config: { subjects: { math: { name: 'Mathematics', attachment: { kind: 'school' as const }, books: [], examModes: { written: { name: 'Written', percentage: 100 } } } } } })
      .where(eq(classTable.id, classId));
    await db
      .update(schoolSessionTable)
      .set({ sessionConfig: { examConfig: { midterm: { name: 'Midterm', order: 1 } }, coScholasticAreas: {}, gradingScale: { a: { label: 'A', minScore: 0 } }, attendanceTracking: { enabled: false } } })
      .where(eq(schoolSessionTable.id, sessionId));
    await includeTestExamClasses([{ schoolId, sessionId, examSlug: 'midterm', classId }]);
    await db.insert(examPlanTable).values({
      schoolId,
      sessionId,
      classId,
      examSlug: 'midterm',
      subjectSlug: 'math',
      totalMarks: 100,
      modeConfig: { written: { percentage: 100, maxMarks: 100 } },
      status: 'active',
    });
    idCardRevision = (
      await manager.school.saveDocumentTemplate({
        schoolId,
        documentType: 'id_card',
        name: 'Batch ID',
        content: '<div>{{#if school.logoUrl}}<img alt="Logo" src="{{school.logoUrl}}" width="40">{{/if}}<p>{{student.name}}</p></div>',
        expectedRevisionId: null,
      })
    ).revisionId;
    admitRevision = (
      await manager.school.saveDocumentTemplate({
        schoolId,
        documentType: 'admit_card',
        name: 'Half admit',
        pageSize: 'half',
        content: '<div><p>{{student.name}}</p></div>',
        expectedRevisionId: null,
      })
    ).revisionId;
  });

  const idCards = (ids = studentIds) => ({
    schoolId,
    templateRevisionId: idCardRevision,
    source: { documentType: 'id_card' as const, sessionId, classId, studentIds: ids },
  });
  const jobRows = async () => db.select().from(documentGenerationJobTable).where(eq(documentGenerationJobTable.schoolId, schoolId));
  const artifactRows = async () => db.select().from(artifactTable).where(eq(artifactTable.schoolId, schoolId));

  it('returns a queued job at once and refuses permission, template and source problems at start, without a job', async () => {
    const before = (await jobRows()).length;
    const started = await manager.school.generateDocument(idCards());
    expect(started.job).toMatchObject({ status: 'queued', documentCount: 17, artifactId: null, documentType: 'id_card' });
    expect(started.jobId).toBe(started.job.id);
    await expect(teacher.school.generateDocument(idCards())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(manager.school.generateDocument({ ...idCards(), templateRevisionId: 'art_stale' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(manager.school.generateDocument(idCards([...studentIds.slice(0, 2), 'stu_unknown']))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await jobRows()).length).toBe(before + 1);
    await expect(teacher.school.getDocumentGenerationJob({ schoolId, jobId: started.jobId, documentType: 'id_card' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(manager.school.getDocumentGenerationJob({ schoolId, jobId: started.jobId, documentType: 'report_card' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await runDocumentJob(started.jobId)).toMatchObject({ status: 'succeeded' });
  });

  it('merges batches into exactly the pages one conversion prints, for ID cards (eight per sheet) and half-A4 documents', async () => {
    const deps = { ...defaultDocumentGenerationDeps(), batchLimits: { ...DOCUMENT_BATCH_LIMITS, maxDocuments: 8 } };
    const ids = await manager.school.generateDocument(idCards());
    expect(await runDocumentJob(ids.jobId, deps)).toMatchObject({ status: 'succeeded' });
    const idJob = await manager.school.getDocumentGenerationJob({ schoolId, jobId: ids.jobId, documentType: 'id_card' });
    expect(idJob).toMatchObject({ status: 'succeeded', batchCount: 3, batchesDone: 3, artifactId: expect.any(String) });
    const [idArtifact] = await db.select().from(artifactTable).where(eq(artifactTable.id, idJob.artifactId!));
    expect(idArtifact).toMatchObject({ templateRevisionId: idCardRevision, studentCount: 17, kind: 'pdf', documentType: 'id_card' });
    const merged = await objectBytes(idArtifact!.s3Key);
    expect(idArtifact!.byteSize).toBe(merged.length);

    // The same documents converted as one HTML document.
    const contexts = (await buildDocumentContexts(db, schoolId, idCards().source)).contexts;
    const template = '<div>{{#if school.logoUrl}}<img alt="Logo" src="{{school.logoUrl}}" width="40">{{/if}}<p>{{student.name}}</p></div>';
    const single = await convertDocumentPdf(combineDocuments(renderDocuments(template, contexts), 'id_card', 'full'), 'id_card');
    expect(await pageCount(merged)).toBe(await pageCount(single));
    expect(await pageCount(merged)).toBe(3);

    const halfDeps = { ...defaultDocumentGenerationDeps(), batchLimits: { ...DOCUMENT_BATCH_LIMITS, maxDocuments: 3 } };
    const admit = await manager.school.generateDocument({
      schoolId,
      templateRevisionId: admitRevision,
      source: { documentType: 'admit_card', sessionId, classId, examSlug: 'midterm', studentIds: studentIds.slice(0, 5) },
    });
    expect(await runDocumentJob(admit.jobId, halfDeps)).toMatchObject({ status: 'succeeded' });
    const admitJob = await readDocumentJob(admit.jobId);
    // Three documents per batch would split a sheet: batches hold two (one sheet), the last one.
    expect(admitJob.batchCount).toBe(3);
    const [admitArtifact] = await db.select().from(artifactTable).where(eq(artifactTable.id, admitJob.artifactId));
    expect(admitArtifact!.pageSize).toBe('half');
    const halfContexts = (await buildDocumentContexts(db, schoolId, { documentType: 'admit_card', sessionId, classId, examSlug: 'midterm', studentIds: studentIds.slice(0, 5) })).contexts;
    const halfSingle = await convertDocumentPdf(combineDocuments(renderDocuments('<div><p>{{student.name}}</p></div>', halfContexts), 'admit_card', 'half'), 'admit_card');
    expect(await pageCount(await objectBytes(admitArtifact!.s3Key))).toBe(await pageCount(halfSingle));
  });

  it('sends the logo once per batch as an asset that the PDF draws', async () => {
    const deps = defaultDocumentGenerationDeps();
    const assetsPerConversion: string[][] = [];
    const { jobId } = await manager.school.generateDocument(idCards());
    await runDocumentJob(jobId, {
      ...deps,
      convert: (html, type, signal, assets = []) => {
        assetsPerConversion.push(assets.map((asset) => asset.name));
        expect(html).not.toContain('data:image');
        return deps.convert(html, type, signal, assets);
      },
    });
    expect(assetsPerConversion).toHaveLength(1);
    expect(assetsPerConversion[0]).toHaveLength(1);
    expect(assetsPerConversion[0]![0]).toMatch(/^asset-[0-9a-f]{64}\.png$/);
    const job = await readDocumentJob(jobId);
    const [artifact] = await db.select().from(artifactTable).where(eq(artifactTable.id, job.artifactId));
    // The CSP lets Chromium load the asset file: the PDF holds an image.
    expect((await objectBytes(artifact!.s3Key)).toString('latin1')).toMatch(/\/Subtype\s*\/Image/);
  });

  it('never stores a second object or artifact when Restate repeats a batch, the merge or the finish', async () => {
    const deps = { ...defaultDocumentGenerationDeps(), batchLimits: { ...DOCUMENT_BATCH_LIMITS, maxDocuments: 8 } };
    const { jobId } = await manager.school.generateDocument(idCards());
    const before = (await artifactRows()).length;
    let prefixAfterMerge: string[] = [];
    // Each repeated step runs its action twice, as Restate does when a step
    // succeeded but its result was not journaled; cleanup is observed first.
    const repeated: StepRunner = async (name, action, options) => {
      if (name === 'batch:2' || name === 'merge' || name === 'finish') await action();
      if (name === 'cleanup') prefixAfterMerge = await listKeys(documentJobPrefix(schoolId, jobId));
      return directSteps(name, action, options);
    };
    expect(await runDocumentGeneration({ jobId }, repeated, { deps })).toMatchObject({ status: 'succeeded' });
    const after = await artifactRows();
    expect(after.length).toBe(before + 1);
    const job = await readDocumentJob(jobId);
    expect(after.filter((row) => row.id === job.artifactId)).toHaveLength(1);
    const prefix = documentJobPrefix(schoolId, jobId);
    expect(prefixAfterMerge).toEqual(
      ['batch-0001.json', 'batch-0001.pdf', 'batch-0002.json', 'batch-0002.pdf', 'batch-0003.json', 'batch-0003.pdf', 'manifest.json'].map((name) => `${prefix}${name}`),
    );
    // Cleaned up, and a redelivered job does nothing.
    expect(await listKeys(prefix)).toEqual([]);
    expect(job.temporaryObjectsDeletedAt).toEqual(expect.any(Date));
    expect(await runDocumentJob(jobId)).toEqual({ status: 'skipped' });
    expect((await artifactRows()).length).toBe(before + 1);
  });

  it('renders with the revision pinned at start, even after the school selects another', async () => {
    const { jobId } = await manager.school.generateDocument(idCards(studentIds.slice(0, 1)));
    const next = await manager.school.saveDocumentTemplate({
      schoolId,
      documentType: 'id_card',
      name: 'Later ID',
      content: '<p>Later {{student.name}}</p>',
      expectedRevisionId: idCardRevision,
    });
    try {
      const deps = defaultDocumentGenerationDeps();
      const printed: string[] = [];
      const outcome = await runDocumentJob(jobId, {
        ...deps,
        convert: (html, ...rest) => {
          printed.push(html);
          return deps.convert(html, ...rest);
        },
      });
      expect(outcome).toMatchObject({ status: 'succeeded' });
      // What was printed is the pinned revision's markup, not the newer one's.
      expect(printed).toHaveLength(1);
      expect(printed[0]).toContain('Batch student 00');
      expect(printed[0]).toContain('alt="Logo"');
      expect(printed[0]).not.toContain('Later Batch student');
      const job = await readDocumentJob(jobId);
      const [artifact] = await db.select().from(artifactTable).where(eq(artifactTable.id, job.artifactId));
      expect(artifact!.templateRevisionId).toBe(idCardRevision);
    } finally {
      idCardRevision = (
        await manager.school.saveDocumentTemplate({
          schoolId,
          documentType: 'id_card',
          name: 'Batch ID',
          content: '<div>{{#if school.logoUrl}}<img alt="Logo" src="{{school.logoUrl}}" width="40">{{/if}}<p>{{student.name}}</p></div>',
          expectedRevisionId: next.revisionId,
        })
      ).revisionId;
    }
  });

  it('limits queued and running jobs per person and per school (TOO_MANY_REQUESTS), counting only jobs in flight', async () => {
    const principal = createTestClient((await createSchoolStaffSession(schoolId, [{ role: 'principal' }])).session);
    const started = [
      (await manager.school.generateDocument(idCards(studentIds.slice(0, 1)))).jobId,
      (await manager.school.generateDocument(idCards(studentIds.slice(1, 2)))).jobId,
    ];
    await expect(manager.school.generateDocument(idCards(studentIds.slice(2, 3)))).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS', message: expect.stringMatching(/You already have 2 PDFs/) });
    started.push((await principal.school.generateDocument(idCards(studentIds.slice(2, 3)))).jobId);
    await expect(principal.school.generateDocument(idCards(studentIds.slice(3, 4)))).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS', message: expect.stringMatching(/This school already has 3 PDFs/) });
    for (const jobId of started) expect(await runDocumentJob(jobId)).toMatchObject({ status: 'succeeded' });
    // Ended jobs no longer count.
    const again = await manager.school.generateDocument(idCards(studentIds.slice(3, 4)));
    expect(await runDocumentJob(again.jobId)).toMatchObject({ status: 'succeeded' });
  });

  it('fails, without a PDF, a job whose school was suspended after the request', async () => {
    const { jobId } = await manager.school.generateDocument(idCards(studentIds.slice(0, 1)));
    await db.update(schoolTable).set({ suspendedAt: new Date(), suspendedReason: 'Test suspension' }).where(eq(schoolTable.id, schoolId));
    try {
      expect(await runDocumentJob(jobId)).toEqual({ status: 'failed', code: 'school_suspended' });
      expect(await readDocumentJob(jobId)).toMatchObject({ status: 'failed', errorCode: 'school_suspended', errorMessage: expect.stringMatching(/suspended/i), startedAt: null });
      const job = await readDocumentJob(jobId);
      expect(await db.select().from(artifactTable).where(eq(artifactTable.id, job.artifactId))).toHaveLength(0);
    } finally {
      await db.update(schoolTable).set({ suspendedAt: null, suspendedReason: null }).where(eq(schoolTable.id, schoolId));
    }
  });

  it('fails a job whose source changed after start, with a message, and lists it in history', async () => {
    const one = studentIds.slice(16, 17);
    const { jobId } = await manager.school.generateDocument(idCards(one));
    const last = and(eq(admissionTable.schoolId, schoolId), eq(admissionTable.name, 'Batch student 16'));
    await db.update(admissionTable).set({ registered: false }).where(last);
    try {
      expect(await runDocumentJob(jobId)).toEqual({ status: 'failed', code: 'invalid_source' });
      const job = await manager.school.getDocumentGenerationJob({ schoolId, jobId, documentType: 'id_card' });
      expect(job).toMatchObject({ status: 'failed', errorCode: 'invalid_source', artifactId: null });
      expect(job.errorMessage).toBeTruthy();
      const listed = await manager.school.listDocumentGenerationJobs({ schoolId, sessionId, documentDomain: 'academic' });
      expect(listed.items.map((item) => item.id)).toContain(jobId);
      expect(listed.items.every((item) => item.status !== 'succeeded')).toBe(true);
      await expect(teacher.school.listDocumentGenerationJobs({ schoolId, sessionId, documentDomain: 'finance' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    } finally {
      await db.update(admissionTable).set({ registered: true }).where(last);
    }
  });
});
