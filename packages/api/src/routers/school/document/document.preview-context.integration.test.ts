import { PutObjectCommand } from '@aws-sdk/client-s3';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@campuspilot/db';
import { classTable } from '@campuspilot/db/schema/class';
import { examPlanTable, examResultTable } from '@campuspilot/db/schema/exam';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { env } from '@campuspilot/env/server';
import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';
import { getS3Client } from '@campuspilot/s3/client';
import { eq } from 'drizzle-orm';

import {
  createSchoolStaffSession,
  createTestAdmission,
  createTestClass,
  createTestClient,
  createTestSchool,
  createTestSession,
  createTestStudent,
  includeTestExamClasses,
} from '../../../../test/fixtures';
import { expectFeatureDisabled } from '../../../../test/feature-flags';
import { SAMPLE_DOCUMENT_CONTEXT } from './document.catalog';
import { TEMPLATE_PREVIEW_IMAGE_MARKER } from './document.dto';

/**
 * Reads withheld from a user in this file, by user id. The preview decides
 * its parts from `checkPermissions` (one OPA round); withholding an action
 * there is how a caller without, say, the student read is simulated, since
 * every staff role that reads templates reads students today. The
 * procedures' own gates (`assertPermission`) keep using OPA unchanged.
 */
const withheld = vi.hoisted(() => new Map<string, ReadonlySet<string>>());
vi.mock('../../../permissions/authorization', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../permissions/authorization')>();
  return {
    ...original,
    checkPermissions: async (...args: Parameters<typeof original.checkPermissions>) => {
      const [context, requests] = args;
      const results = await original.checkPermissions(...args);
      const denied = withheld.get(context.session?.user.id ?? '');
      return denied ? results.map((allowed, index) => allowed && !denied.has(requests[index]!.action)) : results;
    },
  };
});

/** A valid 1x1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const STUDENT_TEMPLATE = '<p>{{school.name}}|{{school.registrationNo}}|{{student.name}}|{{student.className}}</p>';

describe('template previews with the school’s own data (docs/document-system.md, "Preview context")', () => {
  let schoolId: string;
  let sessionId: string;
  let otherSchoolId: string;
  let otherSessionId: string;
  let manager: ReturnType<typeof createTestClient>;
  let withoutStudents: ReturnType<typeof createTestClient>;
  let otherManager: ReturnType<typeof createTestClient>;
  const schoolName = 'Riverside Preview Academy';
  const studentName = 'Ishaan Preview Verma';

  beforeAll(async () => {
    schoolId = (await createTestSchool({ name: schoolName, registrationNo: 'REG-PREVIEW-77' })).id;
    const logoKey = `schools/${schoolId}/logo-preview-test.png`;
    await getS3Client().send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: logoKey, Body: PNG, ContentType: 'image/png' }));
    await db.update(schoolTable).set({ logoS3Key: logoKey }).where(eq(schoolTable.id, schoolId));
    // An older session first, then the active one: the default is the active session.
    await createTestSession({ schoolId, sessionStartYear: 2024, sessionEndYear: 2025 });
    sessionId = (await createTestSession({ schoolId, sessionStartYear: 2025, sessionEndYear: 2026, isActive: true })).id;
    const classId = (await createTestClass({ schoolId, label: 'Class Preview 5' })).schoolClass.id;
    const studentId = (
      await createTestStudent({
        schoolId,
        sessionId,
        classId,
        rollNo: 1,
        admissionId: (await createTestAdmission({ schoolId, name: studentName })).id,
      })
    ).id;
    await db
      .update(classTable)
      .set({
        config: {
          subjects: {
            science: {
              name: 'Preview Science',
              attachment: { kind: 'school' as const },
              books: [],
              examModes: { theory: { name: 'Theory', percentage: 100 } },
            },
          },
        },
      })
      .where(eq(classTable.id, classId));
    await db
      .update(schoolSessionTable)
      .set({
        sessionConfig: {
          examConfig: { term_one: { name: 'Preview Term One', order: 1 } },
          coScholasticAreas: {},
          gradingScale: { a: { label: 'A', minScore: 80 }, b: { label: 'B', minScore: 0 } },
          attendanceTracking: { enabled: false },
        },
      })
      .where(eq(schoolSessionTable.id, sessionId));
    await includeTestExamClasses([{ schoolId, sessionId, examSlug: 'term_one', classId }]);
    const [plan] = await db
      .insert(examPlanTable)
      .values({
        schoolId,
        sessionId,
        classId,
        examSlug: 'term_one',
        subjectSlug: 'science',
        totalMarks: 50,
        modeConfig: { theory: { percentage: 100, maxMarks: 50 } },
        status: 'active',
      })
      .returning();
    await db.insert(examResultTable).values({ schoolId, sessionId, studentId, examPlanId: plan!.id, marks: { theory: 43 }, approved: false });

    manager = createTestClient((await createSchoolStaffSession(schoolId, [{ role: 'manager' }])).session);
    const limited = await createSchoolStaffSession(schoolId, [{ role: 'manager' }]);
    withheld.set(limited.user.id, new Set([SCHOOL_ACTIONS.READ_STUDENT]));
    withoutStudents = createTestClient(limited.session);

    otherSchoolId = (await createTestSchool({ name: 'Hillcrest Other School' })).id;
    otherSessionId = (await createTestSession({ schoolId: otherSchoolId, sessionStartYear: 2025, sessionEndYear: 2026, isActive: true })).id;
    otherManager = createTestClient((await createSchoolStaffSession(otherSchoolId, [{ role: 'manager' }])).session);
  });

  it('renders the school’s name, registration number and logo instead of the sample school', async () => {
    const { html } = await manager.school.previewDocumentTemplate({
      schoolId,
      documentType: 'id_card',
      content: '<p>{{school.name}} {{school.registrationNo}}</p>{{#if school.logoUrl}}<img src="{{school.logoUrl}}" alt="Logo">{{/if}}',
      sessionId,
    });
    expect(html).toContain(schoolName);
    expect(html).toContain('REG-PREVIEW-77');
    expect(html).toContain(`data:image/png;base64,${PNG.toString('base64')}`);
    expect(html).not.toContain(SAMPLE_DOCUMENT_CONTEXT.school.name);
    expect(html).not.toContain(SAMPLE_DOCUMENT_CONTEXT.school.logoUrl);
  });

  it('shows a real student to a caller who may read students', async () => {
    const { html } = await manager.school.previewDocumentTemplate({ schoolId, documentType: 'id_card', content: STUDENT_TEMPLATE, sessionId });
    expect(html).toContain(`${schoolName}|REG-PREVIEW-77|${studentName}|Class Preview 5`);
    const data = await manager.school.getDocumentTemplatePreviewContext({ schoolId, documentType: 'id_card', sessionId });
    expect(data.parts.student).toEqual({ source: 'school' });
    expect((data.context.student as { name: string }).name).toBe(studentName);
    // Images are marked, never sent.
    expect((data.context.school as { logoUrl: string }).logoUrl).toBe(TEMPLATE_PREVIEW_IMAGE_MARKER);
  });

  it('shows the sample student to a caller without the student read, and never fails for it', async () => {
    const { html } = await withoutStudents.school.previewDocumentTemplate({ schoolId, documentType: 'id_card', content: STUDENT_TEMPLATE, sessionId });
    expect(html).toContain(schoolName);
    expect(html).toContain(SAMPLE_DOCUMENT_CONTEXT.student.name);
    expect(html).not.toContain(studentName);
    const data = await withoutStudents.school.getDocumentTemplatePreviewContext({ schoolId, documentType: 'report_card', sessionId });
    expect(data.parts.student).toEqual({ source: 'sample', reason: 'not_permitted' });
    expect(JSON.stringify(data.context)).not.toContain(studentName);
  });

  it('prints the exam’s real subjects and the student’s recorded marks on a report card', async () => {
    const { html } = await manager.school.previewDocumentTemplate({
      schoolId,
      documentType: 'report_card',
      content: '<p>{{exam.name}}|{{student.name}}|{{#each subjects}}{{name}}={{total}}/{{totalMarks}};{{/each}}</p>',
      sessionId,
    });
    expect(html).toContain(`Preview Term One|${studentName}|Preview Science=43/50;`);
    const data = await manager.school.getDocumentTemplatePreviewContext({ schoolId, documentType: 'report_card', sessionId });
    expect(data.parts).toMatchObject({ exam: { source: 'school' }, results: { source: 'school' } });
  });

  it('falls back to the sample for a school with no students, and uses its active session by default', async () => {
    const data = await otherManager.school.getDocumentTemplatePreviewContext({ schoolId: otherSchoolId, documentType: 'admit_card' });
    expect(data.sessionId).toBe(otherSessionId);
    expect(data.parts).toMatchObject({ school: { source: 'school' }, session: { source: 'school' }, student: { source: 'sample', reason: 'no_data' }, exam: { source: 'sample', reason: 'no_data' } });
    expect(data.context.student).toMatchObject({ name: SAMPLE_DOCUMENT_CONTEXT.student.name });
    // Every field of the sample is still there.
    for (const key of Object.keys(SAMPLE_DOCUMENT_CONTEXT)) expect(data.context, key).toHaveProperty(key);
    const { html } = await otherManager.school.previewDocumentTemplate({ schoolId: otherSchoolId, documentType: 'id_card', content: STUDENT_TEMPLATE });
    expect(html).toContain(`Hillcrest Other School|${SAMPLE_DOCUMENT_CONTEXT.school.registrationNo}|${SAMPLE_DOCUMENT_CONTEXT.student.name}`);
  });

  it('reads the preview data behind the template read gate and the type’s feature', async () => {
    const scope = { schoolId, documentType: 'id_card' as const };
    await expect(createTestClient(null).school.getDocumentTemplatePreviewContext(scope)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(otherManager.school.getDocumentTemplatePreviewContext(scope)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // Teachers read academic templates, never finance ones.
    const teacher = createTestClient((await createSchoolStaffSession(schoolId, [{ role: 'teacher', meta: { classIds: [] } }])).session);
    await expect(teacher.school.getDocumentTemplatePreviewContext(scope)).resolves.toMatchObject({ sessionId, parts: { student: { source: 'school' } } });
    await expect(teacher.school.getDocumentTemplatePreviewContext({ schoolId, documentType: 'bill' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // This school has no notices feature, so it has no Notice template to preview.
    await expectFeatureDisabled(manager.school.getDocumentTemplatePreviewContext({ schoolId, documentType: 'notice' }), 'notices');
    await expect(
      manager.school.getDocumentTemplatePreviewContext({ ...scope, documentType: 'unknown' as never }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(manager.school.getDocumentTemplatePreviewContext({ ...scope, sessionId: '' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    // A read changes nothing, so the default session is still the active one.
    expect((await manager.school.getDocumentTemplatePreviewContext(scope)).sessionId).toBe(sessionId);
  });

  it('shows a finance document’s sample amounts when the session has no posted bill', async () => {
    const data = await manager.school.getDocumentTemplatePreviewContext({ schoolId, documentType: 'bill', sessionId });
    expect(data.parts).toMatchObject({ school: { source: 'school' }, session: { source: 'school' }, finance: { source: 'sample', reason: 'no_data' } });
    expect(data.context).toMatchObject({ bill: SAMPLE_DOCUMENT_CONTEXT.bill, school: { name: schoolName } });
  });

  it('refuses a session of another school', async () => {
    await expect(
      manager.school.previewDocumentTemplate({ schoolId, documentType: 'id_card', content: STUDENT_TEMPLATE, sessionId: otherSessionId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      manager.school.getDocumentTemplatePreviewContext({ schoolId, documentType: 'id_card', sessionId: otherSessionId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      manager.school.previewMarketplaceTemplatePdf({ schoolId, documentType: 'id_card', slug: 'id_card-modern', sessionId: otherSessionId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('never serves one school’s marketplace preview to another', async () => {
    const design = { documentType: 'id_card' as const, slug: 'id_card-modern' };
    const [mine, theirs] = await Promise.all([
      manager.school.getMarketplaceTemplate({ schoolId, ...design }),
      otherManager.school.getMarketplaceTemplate({ schoolId: otherSchoolId, ...design }),
    ]);
    expect(mine.html).toContain(schoolName);
    expect(mine.html).not.toContain('Hillcrest Other School');
    expect(theirs.html).toContain('Hillcrest Other School');
    expect(theirs.html).not.toContain(schoolName);
    const minePdf = await manager.school.previewMarketplaceTemplatePdf({ schoolId, ...design });
    const theirPdf = await otherManager.school.previewMarketplaceTemplatePdf({ schoolId: otherSchoolId, ...design });
    expect(minePdf.pdfBase64).not.toBe(theirPdf.pdfBase64);
  });
});
