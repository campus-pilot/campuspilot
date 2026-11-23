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
  includeTestExamClasses,
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
              attachment: { kind: 'school' as const }, books: [],
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
    await includeTestExamClasses([{ schoolId, sessionId, examSlug: 'midterm', classId }]);
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
      () => c.school.getDocumentDownload({ schoolId, artifactId: 'unknown', documentType: 'id_card' }),
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
        c.school.deleteDocumentArtifact({ schoolId, artifactId: 'unknown', documentType: 'id_card' }),
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
        slug: 'report_card-default',
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
          // @ts-expect-error Exercise strict runtime rejection for stale clients.
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
    // The revision to save against is an explicit field on every read and write.
    expect(chosen.revisionId).toBe(chosen.artifact.id);
    expect(original?.revisionId).toBe(chosen.artifact.id);
    const changed = await manager.school.saveDocumentTemplate({
      schoolId,
      documentType: 'id_card',
      name: 'School ID',
      content: '<h1>{{school.name}}</h1><p>{{student.name}}</p>',
      expectedRevisionId: chosen.artifact.id,
    });
    expect(changed.artifact.id).not.toBe(chosen.artifact.id);
    expect(changed.revisionId).toBe(changed.artifact.id);
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
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining(`selected revision: ${changed.artifact.id}`),
    });
    // A caller that sends null while a revision is selected is told which one.
    await expect(
      manager.school.saveDocumentTemplate({
        schoolId,
        documentType: 'id_card',
        name: 'Stale',
        content: '<p>stale</p>',
        expectedRevisionId: null,
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining(`selected revision: ${changed.artifact.id}`),
    });
    // And one that sends an id while nothing is selected is told so.
    await expect(
      manager.school.saveDocumentTemplate({
        schoolId,
        documentType: 'admit_card',
        name: 'Stale',
        content: '<p>stale</p>',
        expectedRevisionId: chosen.artifact.id,
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('selected revision: none'),
    });
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
        slug: `${documentType}-default`,
        expectedRevisionId: null,
      });
      const source =
        documentType === 'id_card'
          ? { documentType, sessionId, classId }
          : documentType === 'timetable'
            ? { documentType, sessionId, examSlug: 'midterm' }
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
        documentType,
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
        documentType: artifact.documentType,
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
        documentType: artifact.documentType,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [row] = await db
      .select()
      .from(artifactTable)
      .where(eq(artifactTable.id, artifact.id));
    await manager.school.deleteDocumentArtifact({
      schoolId,
      artifactId: artifact.id,
      documentType: artifact.documentType,
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
      manager.school.getDocumentDownload({ schoolId, artifactId: artifact.id, documentType: artifact.documentType }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      manager.school.deleteDocumentArtifact({
        schoolId,
        artifactId: artifact.id,
        documentType: artifact.documentType,
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
    expect(DOCUMENT_MARKETPLACE).toHaveLength(25);
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
          documentType: artifact.documentType,
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
          documentType: artifact.documentType,
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
      documentType: artifact.documentType,
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
          // @ts-expect-error Exercise strict runtime rejection for stale clients.
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
  it('checks an assistant draft exactly as a save would, saving nothing, and previews a draft as its PDF', async () => {
    const scope = { schoolId, documentType: 'id_card' as const };
    const before = await manager.school.getActiveDocumentTemplate(scope);
    const valid = await manager.school.validateDocumentTemplateDraft({ ...scope, content: '<p>{{school.name}}</p>' });
    expect(valid).toMatchObject({ valid: true, problems: [], characters: 22 });
    expect(valid.draftId).toMatch(/^[0-9a-f]{12}$/);
    // The same source has the same id; the verdict never echoes the source.
    expect((await manager.school.validateDocumentTemplateDraft({ ...scope, content: '<p>{{school.name}}</p>' })).draftId).toBe(valid.draftId);
    expect(JSON.stringify(valid)).not.toContain('school.name');
    const broken = await manager.school.validateDocumentTemplateDraft({ ...scope, content: '{{#each broken}}' });
    expect(broken).toMatchObject({ valid: false, draftId: null });
    expect(broken.problems.length).toBeGreaterThan(0);
    // A helper the renderer refuses is a problem too, as on save.
    expect((await manager.school.validateDocumentTemplateDraft({ ...scope, content: '{{log school.name}}' })).valid).toBe(false);
    expect(await manager.school.getActiveDocumentTemplate(scope)).toEqual(before);
    // Proposing a template is for those who may change it; reading the guide is for those who may read templates.
    await expect(teacher.school.validateDocumentTemplateDraft({ schoolId, documentType: 'id_card', content: '<p>x</p>' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(outsider.school.learn_document_template_editing({ schoolId, documentType: 'id_card' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const guide = await teacher.school.learn_document_template_editing({ schoolId, documentType: 'id_card' });
    expect(guide.rules).toContain('86mm × 54mm');
    expect(guide.rules).toContain('validateDocumentTemplateDraft');
    expect(guide.contextHelp).toContain('student.');

    const preview = await teacher.school.previewDocumentTemplatePdf({ schoolId, documentType: 'id_card', content: '<p>{{student.name}}</p>' });
    const pdf = await PDFDocument.load(Buffer.from(preview.pdfBase64, 'base64'));
    expect(pdf.getPageCount()).toBe(1);
    await expect(
      teacher.school.previewDocumentTemplatePdf({ schoolId, documentType: 'id_card', content: '{{#each broken}}' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      outsider.school.previewDocumentTemplatePdf({ schoolId, documentType: 'id_card', content: '<p>x</p>' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('previews a marketplace design as its PDF by slug, behind the template read gate', async () => {
    const design = { schoolId, documentType: 'id_card' as const, slug: 'id_card-modern' };
    const first = await teacher.school.previewMarketplaceTemplatePdf(design);
    expect((await PDFDocument.load(Buffer.from(first.pdfBase64, 'base64'))).getPageCount()).toBeGreaterThan(0);
    // The catalog and the sample data are fixed, so a design converts once and the same bytes come back.
    expect((await manager.school.previewMarketplaceTemplatePdf(design)).pdfBase64).toBe(first.pdfBase64);
    // A design is found by its type and slug together.
    await expect(
      teacher.school.previewMarketplaceTemplatePdf({ ...design, slug: 'report_card-default' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // A print size is a Notice design's choice; it is refused for every other type.
    await expect(
      teacher.school.previewMarketplaceTemplatePdf({ ...design, printSize: 'half' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(outsider.school.previewMarketplaceTemplatePdf(design)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(createTestClient(null).school.previewMarketplaceTemplatePdf(design)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
  it('lists every revision of a template newest first and reads one, behind the template read gate', async () => {
    const scope = { schoolId, documentType: 'admit_card' as const };
    const current = await manager.school.getActiveDocumentTemplate(scope);
    const first = await manager.school.saveDocumentTemplate({ ...scope, name: 'First', content: '<p>one {{school.name}}</p>', pageSize: 'full', expectedRevisionId: current?.revisionId ?? null });
    const second = await manager.school.saveDocumentTemplate({ ...scope, name: 'Second', content: '<p>two</p>', pageSize: 'half', expectedRevisionId: first.revisionId });
    const listed = await teacher.school.listDocumentTemplateRevisions({ ...scope, limit: 20 });
    const [newest, older] = listed.items;
    expect(newest).toMatchObject({ revisionId: second.revisionId, name: 'Second', pageSize: 'half', selected: true });
    expect(older).toMatchObject({ revisionId: first.revisionId, name: 'First', selected: false });
    expect(newest!.revisionNo).toBe(older!.revisionNo + 1);
    expect(newest!.createdByName).toEqual(expect.any(String));
    expect(listed.pagination.totalItems).toBe(newest!.revisionNo);
    const read = await teacher.school.getDocumentTemplateRevision({ ...scope, revisionId: first.revisionId });
    expect(read).toMatchObject({ content: '<p>one {{school.name}}</p>', revision: { revisionId: first.revisionId, selected: false } });
    // A revision of another type is not found here, and the gate is the template read gate.
    await expect(teacher.school.getDocumentTemplateRevision({ schoolId, documentType: 'id_card', revisionId: first.revisionId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(outsider.school.listDocumentTemplateRevisions({ ...scope, limit: 20 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(outsider.school.getDocumentTemplateRevision({ ...scope, revisionId: first.revisionId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
