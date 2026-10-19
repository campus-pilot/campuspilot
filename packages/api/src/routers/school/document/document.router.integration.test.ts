import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { db } from '@campuspilot/db';
import { artifactTable } from '@campuspilot/db/schema/artifact';
import { classTable } from '@campuspilot/db/schema/class';
import {
  examPlanTable,
  examAssessmentSettingsTable,
  examStudentAssessmentTable,
  examResultTable,
  examTimetableTable,
} from '@campuspilot/db/schema/exam';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { getS3Client } from '@campuspilot/s3/client';
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { env } from '@campuspilot/env/server';
import { eq } from 'drizzle-orm';
import {
  createAdminSession,
  createRegularUserSession,
  createSchoolStaffSession,
  createTestAdmission,
  createTestClass,
  createTestClient,
  createTestSchool,
  createTestSession,
  createTestStudent,
} from '../../../../test/fixtures';
import { DOCUMENT_MARKETPLACE } from './document.catalog';
import { combineDocuments, renderDocument } from './document.render';
import { documentGrade } from './document.context';

describe('document templates, generation, and artifact lifecycle', () => {
  let manager: ReturnType<typeof createTestClient>;
  let teacher: ReturnType<typeof createTestClient>;
  let outsider: ReturnType<typeof createTestClient>;
  let admin: ReturnType<typeof createTestClient>;
  let schoolId: string,
    sessionId: string,
    classId: string,
    studentId: string,
    otherStudentId: string,
    resultId: string;
  beforeAll(async () => {
    schoolId = (await createTestSchool()).id;
    sessionId = (
      await createTestSession({
        schoolId,
        sessionStartYear: 2026,
        sessionEndYear: 2027,
      })
    ).id;
    classId = (await createTestClass({ schoolId, label: 'Grade 8' }))
      .schoolClass.id;
    manager = createTestClient(
      (await createSchoolStaffSession(schoolId, [{ role: 'manager' }])).session,
    );
    teacher = createTestClient(
      (
        await createSchoolStaffSession(schoolId, [
          { role: 'teacher', meta: { classIds: [] } },
        ])
      ).session,
    );
    outsider = createTestClient(
      (
        await createSchoolStaffSession((await createTestSchool()).id, [
          { role: 'manager' },
        ])
      ).session,
    );
    admin = createTestClient(await createAdminSession());
    studentId = (
      await createTestStudent({
        schoolId,
        sessionId,
        classId,
        admissionId: (
          await createTestAdmission({
            schoolId,
            name: 'Aarav <script>alert(1)</script> {{missing}}',
          })
        ).id,
      })
    ).id;
    otherStudentId = (
      await createTestStudent({
        schoolId,
        sessionId,
        classId: (await createTestClass({ schoolId })).schoolClass.id,
        admissionId: (await createTestAdmission({ schoolId })).id,
      })
    ).id;
    await db
      .update(classTable)
      .set({
        config: {
          subjects: {
            math: {
              name: 'Mathematics',
              books: [],
              examModes: { written: { name: 'Written', percentage: 100 } },
            },
          },
        },
      })
      .where(eq(classTable.id, classId));
    await db
      .update(schoolSessionTable)
      .set({
        sessionConfig: {
          examConfig: { midterm: { name: 'Midterm', order: 1 } },
          coScholasticAreas: {},
          gradingScale: {
            a: { label: 'A', minScore: 80 },
            b: { label: 'B', minScore: 0 },
          },
          attendanceTracking: { enabled: true },
        },
      })
      .where(eq(schoolSessionTable.id, sessionId));
    const [plan] = await db
      .insert(examPlanTable)
      .values({
        schoolId,
        sessionId,
        classId,
        examSlug: 'midterm',
        subjectSlug: 'math',
        totalMarks: 100,
        modeConfig: { written: { percentage: 100, maxMarks: 100 } },
        totalWorkingDays: 90,
        status: 'active',
      })
      .returning();
    resultId = (
      await db
        .insert(examResultTable)
        .values({
          schoolId,
          sessionId,
          studentId,
          examPlanId: plan!.id,
          marks: { written: 88 },
          approved: true,
          daysAttended: 82,
        })
        .returning()
    )[0]!.id;
    await db.insert(examAssessmentSettingsTable).values({ schoolId, sessionId, examSlug: 'midterm', totalWorkingDays: 90 });
    await db.insert(examStudentAssessmentTable).values({ schoolId, sessionId, examSlug: 'midterm', studentId, daysAttended: 82, approved: true });
    await db.insert(examTimetableTable).values({
      schoolId,
      sessionId,
      examSlug: 'midterm',
      config: {
        columns: [classId],
        rows: [
          {
            id: 'row1',
            date: '2026-10-20',
            startTime: '09:00',
            endTime: '12:00',
            cells: {
              [classId]: { subjectSlug: 'math', modeSlug: 'written' },
            },
          },
        ],
      },
    });
  });
  it('enforces authentication and tenant/role grants on every procedure', async () => {
    const read = { schoolId, documentType: 'id_card' as const };
    const mutation = {
      ...read,
      slug: 'id_card-modern',
      expectedRevisionId: null,
    };
    const source = { documentType: 'id_card' as const, sessionId, classId };
    const calls = (c: ReturnType<typeof createTestClient>) => [
      () => c.school.listMarketplaceTemplates(read),
      () =>
        c.school.getMarketplaceTemplate({ ...read, slug: 'id_card-modern' }),
      () => c.school.getActiveDocumentTemplate(read),
      () =>
        c.school.previewDocumentTemplate({
          ...read,
          content: '<p>{{student.name}}</p>',
        }),
      () => c.school.listDocumentArtifacts({ schoolId }),
      () => c.school.getDocumentDownload({ schoolId, artifactId: 'unknown' }),
      () => c.school.selectMarketplaceTemplate(mutation),
      () =>
        c.school.saveDocumentTemplate({
          ...read,
          name: 'Custom',
          content: '<p>Hello</p>',
          expectedRevisionId: null,
        }),
      () =>
        c.school.previewDocument({
          schoolId,
          source,
          templateRevisionId: 'unknown',
        }),
      () =>
        c.school.generateDocument({
          schoolId,
          source,
          templateRevisionId: 'unknown',
        }),
      () =>
        c.school.deleteDocumentArtifact({ schoolId, artifactId: 'unknown' }),
    ];
    for (const [client, code] of [
      [createTestClient(null), 'UNAUTHORIZED'],
      [outsider, 'FORBIDDEN'],
      [admin, 'FORBIDDEN'],
      [createTestClient(await createRegularUserSession()), 'FORBIDDEN'],
    ] as const) {
      for (const call of calls(client))
        await expect(call()).rejects.toMatchObject({ code });
    }
    for (const call of calls(teacher).slice(6))
      await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(
      (await teacher.school.listMarketplaceTemplates(read)).items,
    ).toHaveLength(4);
  });
  it('validates list boundaries and rejects unsupported template syntax', async () => {
    await expect(
      manager.school.listMarketplaceTemplates({
        schoolId,
        documentType: 'id_card',
        limit: 21,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      manager.school.listDocumentArtifacts({ schoolId, cursor: '2', page: 1 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      manager.school.saveDocumentTemplate({
        schoolId,
        documentType: 'id_card',
        name: '',
        content: '',
        expectedRevisionId: null,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      manager.school.previewDocumentTemplate({
        schoolId,
        documentType: 'id_card',
        content: '{{#each broken}}',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      manager.school.getMarketplaceTemplate({
        schoolId,
        documentType: 'id_card',
        slug: 'report_card-modern',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      manager.school.selectMarketplaceTemplate({
        schoolId,
        documentType: 'id_card',
        slug: 'missing',
        expectedRevisionId: null,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      manager.school.previewDocument({
        schoolId,
        templateRevisionId: 'unknown',
        source: {
          documentType: 'timetable',
          sessionId,
          examSlug: 'midterm',
          classId,
        },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
  it('persists immutable templates, previews drafts, and rejects concurrent lost updates', async () => {
    expect(
      await manager.school.getActiveDocumentTemplate({
        schoolId,
        documentType: 'id_card',
      }),
    ).toBeNull();
    const chosen = await manager.school.selectMarketplaceTemplate({
      schoolId,
      documentType: 'id_card',
      slug: 'id_card-modern',
      expectedRevisionId: null,
    });
    const original = await manager.school.getActiveDocumentTemplate({
      schoolId,
      documentType: 'id_card',
    });
    expect(original?.artifact.id).toBe(chosen.artifact.id);
    const changed = await manager.school.saveDocumentTemplate({
      schoolId,
      documentType: 'id_card',
      name: 'School ID',
      content: '<h1>{{school.name}}</h1><p>{{student.name}}</p>',
      expectedRevisionId: chosen.artifact.id,
    });
    expect(changed.artifact.id).not.toBe(chosen.artifact.id);
    const [old] = await db
      .select()
      .from(artifactTable)
      .where(eq(artifactTable.id, chosen.artifact.id));
    const oldBlob = await getS3Client().send(
      new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: old!.s3Key }),
    );
    expect(await oldBlob.Body!.transformToString()).toBe(original!.content);
    await expect(
      manager.school.saveDocumentTemplate({
        schoolId,
        documentType: 'id_card',
        name: 'Stale',
        content: '<p>stale</p>',
        expectedRevisionId: chosen.artifact.id,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const preview = await manager.school.previewDocumentTemplate({
      schoolId,
      documentType: 'id_card',
      content:
        '<h1>{{student.name}}</h1><script>alert(1)</script><img src="http://127.0.0.1/private">',
    });
    expect(preview.html).toContain('Aarav Sharma');
    expect(preview.html).not.toContain('<script');
    expect(preview.html).not.toContain('127.0.0.1');
    expect(
      (
        await manager.school.getActiveDocumentTemplate({
          schoolId,
          documentType: 'id_card',
        })
      )?.content,
    ).toBe(changed.content);
  });
  it('previews and converts all supported document types with real Gotenberg and stores readable PDFs in S3', async () => {
    for (const documentType of [
      'id_card',
      'report_card',
      'admit_card',
      'timetable',
    ] as const) {
      let active = await manager.school.getActiveDocumentTemplate({
        schoolId,
        documentType,
      });
      active ??= await manager.school.selectMarketplaceTemplate({
        schoolId,
        documentType,
        slug: `${documentType}-modern`,
        expectedRevisionId: null,
      });
      const source =
        documentType === 'id_card'
          ? { documentType, sessionId, classId }
          : { documentType, sessionId, classId, examSlug: 'midterm' };
      const input = {
        schoolId,
        source,
        templateRevisionId: active.artifact.id,
      };
      const preview = await manager.school.previewDocument(input);
      expect(preview.html).toContain(
        documentType === 'timetable' ? 'Mathematics' : '{{missing}}',
      );
      expect(preview.html).not.toContain('<script');
      const generated = await manager.school.generateDocument(input);
      expect(generated.artifact.templateRevisionId).toBe(active.artifact.id);
      expect(generated.artifact.templateName).toBe(active.artifact.name);
      expect(generated.artifact.studentCount).toBe(
        documentType === 'timetable' ? 0 : 1,
      );
      const [row] = await db
        .select()
        .from(artifactTable)
        .where(eq(artifactTable.id, generated.artifact.id));
      const object = await getS3Client().send(
        new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: row!.s3Key }),
      );
      expect(
        Buffer.from(await object.Body!.transformToByteArray())
          .subarray(0, 5)
          .toString(),
      ).toBe('%PDF-');
      const link = await manager.school.getDocumentDownload({
        schoolId,
        artifactId: row!.id,
      });
      const response = await fetch(link.url);
      expect(response.ok).toBe(true);
      expect(response.headers.get('content-type')).toContain('application/pdf');
    }
  });
  it('rejects cross-class selections, wrong sessions, missing results, and stale template revisions', async () => {
    const active = await manager.school.getActiveDocumentTemplate({
      schoolId,
      documentType: 'id_card',
    });
    const base = {
      schoolId,
      templateRevisionId: active!.artifact.id,
      source: { documentType: 'id_card' as const, sessionId, classId },
    };
    await expect(
      manager.school.generateDocument({
        ...base,
        source: { ...base.source, studentIds: [otherStudentId] },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      manager.school.previewDocument({
        ...base,
        source: {
          ...base.source,
          sessionId: (
            await createTestSession({
              schoolId: (await createTestSchool()).id,
              sessionStartYear: 2026,
              sessionEndYear: 2027,
            })
          ).id,
        },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      manager.school.previewDocument({
        ...base,
        templateRevisionId: 'old-revision',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      manager.school.previewDocument({
        ...base,
        source: { ...base.source, studentIds: [studentId, studentId] },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const report = await manager.school.getActiveDocumentTemplate({
      schoolId,
      documentType: 'report_card',
    });
    await db
      .update(examResultTable)
      .set({ approved: false })
      .where(eq(examResultTable.id, resultId));
    await expect(
      manager.school.generateDocument({
        schoolId,
        templateRevisionId: report!.artifact.id,
        source: {
          documentType: 'report_card',
          sessionId,
          classId,
          examSlug: 'midterm',
        },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await db
      .update(examResultTable)
      .set({ approved: true })
      .where(eq(examResultTable.id, resultId));
  });
  it('filters and paginates history, prevents tenant downloads, and deletes both S3 and database records', async () => {
    const history = await manager.school.listDocumentArtifacts({
      schoolId,
      filters: { sessionId },
      limit: 2,
    });
    expect(history.items).toHaveLength(2);
    expect(history.pagination).toMatchObject({
      currentPage: 1,
      totalItems: 4,
      totalPages: 2,
      nextCursor: '2',
      pageSize: 2,
    });
    const second = await manager.school.listDocumentArtifacts({
      schoolId,
      filters: { sessionId },
      cursor: '2',
      limit: 2,
    });
    expect(
      second.items.every((item) =>
        history.items.every((first) => first.id !== item.id),
      ),
    ).toBe(true);
    const ids = await manager.school.listDocumentArtifacts({
      schoolId,
      filters: { documentType: 'id_card', studentId },
    });
    expect(ids.items).toHaveLength(1);
    expect(ids.items[0]!.templateName).toBe('School ID');
    const artifact = ids.items[0]!;
    await expect(
      outsider.school.getDocumentDownload({
        schoolId,
        artifactId: artifact.id,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const otherSchool = (await createTestSchool()).id;
    const otherManager = createTestClient(
      (await createSchoolStaffSession(otherSchool, [{ role: 'manager' }]))
        .session,
    );
    await expect(
      otherManager.school.getDocumentDownload({
        schoolId: otherSchool,
        artifactId: artifact.id,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [row] = await db
      .select()
      .from(artifactTable)
      .where(eq(artifactTable.id, artifact.id));
    await manager.school.deleteDocumentArtifact({
      schoolId,
      artifactId: artifact.id,
    });
    expect(
      await db
        .select()
        .from(artifactTable)
        .where(eq(artifactTable.id, artifact.id)),
    ).toHaveLength(0);
    await expect(
      getS3Client().send(
        new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: row!.s3Key }),
      ),
    ).rejects.toBeDefined();
    await expect(
      manager.school.getDocumentDownload({ schoolId, artifactId: artifact.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      manager.school.deleteDocumentArtifact({
        schoolId,
        artifactId: artifact.id,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('does not reinterpret student text as Handlebars during bulk wrapping and resolves grades without invented fallbacks', () => {
    const html = combineDocuments(
      [renderDocument('<p>{{name}}</p>', { name: '{{unknown helper}}' })],
      'report_card',
    );
    expect(html).toContain('{{unknown helper}}');
    expect(documentGrade(20, { a: { label: 'A', minScore: 80 } })).toBe('—');
    expect(DOCUMENT_MARKETPLACE).toHaveLength(8);
  });
  it('cleans losing concurrent uploads and preserves exactly one active revision', async () => {
    const current = await manager.school.getActiveDocumentTemplate({
      schoolId,
      documentType: 'id_card',
    });
    const proposals = await Promise.allSettled(
      ['First', 'Second'].map((name) =>
        manager.school.saveDocumentTemplate({
          schoolId,
          documentType: 'id_card',
          name,
          content: '<p>{{student.name}}</p>',
          expectedRevisionId: current!.artifact.id,
        }),
      ),
    );
    expect(proposals.filter((p) => p.status === 'fulfilled')).toHaveLength(1);
    const failure = proposals.find((p) => p.status === 'rejected');
    expect(failure).toMatchObject({ reason: { code: 'CONFLICT' } });
    const rows = await db
      .select()
      .from(artifactTable)
      .where(eq(artifactTable.schoolId, schoolId));
    const objects = await getS3Client().send(
      new ListObjectsV2Command({
        Bucket: env.S3_BUCKET,
        Prefix: `schools/${schoolId}/document-templates/`,
      }),
    );
    expect(new Set(objects.Contents?.map((o) => o.Key))).toEqual(
      new Set(
        rows.filter((row) => row.kind === 'template').map((row) => row.s3Key),
      ),
    );
    expect(
      (
        await teacher.school.getActiveDocumentTemplate({
          schoolId,
          documentType: 'id_card',
        })
      )?.artifact.id,
    ).not.toBe(current!.artifact.id);
  });
  it('keeps failed deletions retryable and prevents downloads while deletion is pending', async () => {
    const active = await manager.school.getActiveDocumentTemplate({
      schoolId,
      documentType: 'id_card',
    });
    const { artifact } = await manager.school.generateDocument({
      schoolId,
      templateRevisionId: active!.artifact.id,
      source: {
        documentType: 'id_card',
        sessionId,
        classId,
        studentIds: [studentId],
      },
    });
    const s3 = getS3Client();
    s3.middlewareStack.add(
      (next, context) => async (args) => {
        if (context.commandName === 'DeleteObjectCommand')
          throw new Error('Fixture storage unavailable');
        return next(args);
      },
      { name: 'documentDeleteFailure', step: 'initialize' },
    );
    try {
      await expect(
        manager.school.deleteDocumentArtifact({
          schoolId,
          artifactId: artifact.id,
        }),
      ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
      const [row] = await db
        .select()
        .from(artifactTable)
        .where(eq(artifactTable.id, artifact.id));
      expect(row?.status).toBe('deleting');
      await expect(
        manager.school.getDocumentDownload({
          schoolId,
          artifactId: artifact.id,
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(
        (await teacher.school.listDocumentArtifacts({ schoolId })).items.some(
          (item) => item.id === artifact.id,
        ),
      ).toBe(true);
    } finally {
      s3.middlewareStack.remove('documentDeleteFailure');
    }
    await manager.school.deleteDocumentArtifact({
      schoolId,
      artifactId: artifact.id,
    });
    expect(
      await db
        .select()
        .from(artifactTable)
        .where(eq(artifactTable.id, artifact.id)),
    ).toHaveLength(0);
  });
  it('leaves no new references when conversion or upload fails', async () => {
    const active = await manager.school.getActiveDocumentTemplate({
      schoolId,
      documentType: 'id_card',
    });
    const input = {
      schoolId,
      templateRevisionId: active!.artifact.id,
      source: {
        documentType: 'id_card' as const,
        sessionId,
        classId,
        studentIds: [studentId],
      },
    };
    const before = await db
      .select()
      .from(artifactTable)
      .where(eq(artifactTable.schoolId, schoolId));
    const originalFetch = globalThis.fetch;
    const failure = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((request, init) =>
        String(request).startsWith(env.GOTENBERG_URL)
          ? Promise.resolve(new Response('Unavailable', { status: 503 }))
          : originalFetch(request, init),
      );
    try {
      await expect(
        manager.school.generateDocument(input),
      ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
    } finally {
      failure.mockRestore();
    }
    const s3 = getS3Client();
    s3.middlewareStack.add(
      (next, context) => async (args) => {
        if (context.commandName === 'PutObjectCommand')
          throw new Error('Fixture upload unavailable');
        return next(args);
      },
      { name: 'documentUploadFailure', step: 'initialize' },
    );
    try {
      await expect(
        manager.school.generateDocument(input),
      ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
    } finally {
      s3.middlewareStack.remove('documentUploadFailure');
    }
    expect(
      (
        await db
          .select()
          .from(artifactTable)
          .where(eq(artifactTable.schoolId, schoolId))
      ).map((r) => r.id),
    ).toEqual(before.map((r) => r.id));
  });
  it('handles missing templates, empty classes, unknown exams and unavailable timetables as domain errors', async () => {
    const emptyClass = (await createTestClass({ schoolId })).schoolClass.id;
    const id = await manager.school.getActiveDocumentTemplate({
      schoolId,
      documentType: 'id_card',
    });
    await expect(
      manager.school.previewDocument({
        schoolId,
        templateRevisionId: id!.artifact.id,
        source: { documentType: 'id_card', sessionId, classId: emptyClass },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const timetable = await manager.school.getActiveDocumentTemplate({
      schoolId,
      documentType: 'timetable',
    });
    await expect(
      manager.school.previewDocument({
        schoolId,
        templateRevisionId: timetable!.artifact.id,
        source: { documentType: 'timetable', sessionId, examSlug: 'unknown' },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      manager.school.previewDocument({
        schoolId,
        templateRevisionId: timetable!.artifact.id,
        source: {
          documentType: 'timetable',
          sessionId,
          classId: emptyClass,
          examSlug: 'midterm',
        },
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const school = await createTestSchool();
    const scoped = createTestClient(
      (await createSchoolStaffSession(school.id, [{ role: 'manager' }]))
        .session,
    );
    await expect(
      scoped.school.generateDocument({
        schoolId: school.id,
        templateRevisionId: id!.artifact.id,
        source: { documentType: 'id_card', sessionId, classId },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('prints multiple ID sheets and one page per report with actual PDF page dimensions', async () => {
    const current = await manager.school.getActiveDocumentTemplate({
      schoolId,
      documentType: 'id_card',
    });
    const active = await manager.school.selectMarketplaceTemplate({
      schoolId,
      documentType: 'id_card',
      slug: 'id_card-modern',
      expectedRevisionId: current!.artifact.id,
    });
    const studentIds: string[] = [];
    const [result] = await db
      .select()
      .from(examResultTable)
      .where(eq(examResultTable.id, resultId));
    for (let i = 0; i < 17; i++) {
      const student = await createTestStudent({
        schoolId,
        sessionId,
        classId,
        admissionId: (
          await createTestAdmission({ schoolId, name: `Bulk student ${i}` })
        ).id,
      });
      studentIds.push(student.id);
      await db.insert(examStudentAssessmentTable).values({ schoolId, sessionId, examSlug: 'midterm', studentId: student.id, approved: true });
      await db.insert(examResultTable).values({
        schoolId,
        sessionId,
        studentId: student.id,
        examPlanId: result!.examPlanId,
        marks: { written: 75 },
        approved: true,
      });
    }
    for (const documentType of [
      'id_card',
      'report_card',
      'timetable',
    ] as const) {
      const selected =
        documentType === 'id_card'
          ? active
          : await manager.school.getActiveDocumentTemplate({
              schoolId,
              documentType,
            });
      const source =
        documentType === 'timetable'
          ? { documentType, sessionId, examSlug: 'midterm' }
          : documentType === 'id_card'
            ? { documentType, sessionId, classId, studentIds }
            : {
                documentType,
                sessionId,
                classId,
                studentIds: studentIds.slice(0, 2),
                examSlug: 'midterm',
              };
      const generated = await manager.school.generateDocument({
        schoolId,
        templateRevisionId: selected!.artifact.id,
        source,
      });
      const [row] = await db
        .select()
        .from(artifactTable)
        .where(eq(artifactTable.id, generated.artifact.id));
      const object = await getS3Client().send(
        new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: row!.s3Key }),
      );
      const pdf = await PDFDocument.load(
        await object.Body!.transformToByteArray(),
      );
      expect(pdf.getPageCount()).toBe(
        documentType === 'id_card' ? 3 : documentType === 'report_card' ? 2 : 1,
      );
      const page = pdf.getPage(0);
      expect(page.getWidth()).toBeCloseTo(
        documentType === 'timetable' ? 841.92 : 594.96,
        0,
      );
    }
  });
});
