import { db } from '@campuspilot/db';
import { artifactTable, schoolDocumentTemplateTable } from '@campuspilot/db/schema/artifact';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { expectFeatureDisabled, expectPermissionDenied } from '../../../../test/feature-flags';
import {
  createSchoolStaffSession,
  createTestClient,
  createTestSchool,
  createTestSession,
  setTestSchoolFeature,
  type TestClient,
} from '../../../../test/fixtures';
import { SAMPLE_NOTICE_CONTEXT } from '../document/document.catalog';
import { NOTICE_CONTEXT_FIELDS } from './notice-template-guide';
import { buildNoticeContext } from './notice.render';

/** Dotted leaf paths of a context object; an array is one leaf. */
function leafPaths(value: object, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) =>
    child !== null && typeof child === 'object' && !Array.isArray(child) ? leafPaths(child, `${prefix}${key}.`) : [`${prefix}${key}`],
  );
}

/** The `notice` document type through the document system's template procedures. */
describe('notice document template', () => {
  let schoolId: string, sessionId: string;
  let manager: TestClient, teacher: TestClient;
  const scope = () => ({ schoolId, documentType: 'notice' as const });

  beforeAll(async () => {
    schoolId = (await createTestSchool({ name: 'Notice Template School', features: ['notices'] })).id;
    sessionId = (await createTestSession({ schoolId, sessionStartYear: 2026, sessionEndYear: 2027 })).id;
    manager = createTestClient((await createSchoolStaffSession(schoolId, [{ role: 'manager' }])).session);
    teacher = createTestClient((await createSchoolStaffSession(schoolId, [{ role: 'teacher', meta: { classIds: [] } }])).session);
  });

  it('builds a real notice context with exactly the fields of the sample and of the editor\'s variable guide', async () => {
    const context = await buildNoticeContext(db, { schoolId, sessionId, title: 'Holiday', bodyMode: 'plain', body: 'School is closed.' }, { generatedAt: new Date('2026-11-10T06:00:00.000Z'), issuedOn: null });
    const paths = leafPaths(context).sort();
    expect(paths).toEqual(leafPaths(SAMPLE_NOTICE_CONTEXT).sort());
    expect(paths).toEqual(Object.keys(NOTICE_CONTEXT_FIELDS).sort());
  });

  it('offers the built-in design in the marketplace, previewed with notice-only sample data in the flowing layout', async () => {
    const list = await teacher.school.listMarketplaceTemplates(scope());
    expect(list.items).toEqual([expect.objectContaining({ slug: 'notice-default', documentType: 'notice', pageSize: 'full' })]);
    const item = await teacher.school.getMarketplaceTemplate({ ...scope(), slug: 'notice-default' });
    expect(item.html).toContain('Annual Sports Day');
    expect(item.html).toContain('Greenwood Public School');
    expect(item.html).toContain('@page{size:A4;margin:16mm}');
    expect(item.html).not.toContain('overflow:hidden');
    // No student, exam or finance sample data is rendered into a notice.
    expect(item.html).not.toContain('Aarav Sharma');
    expect(item.contextHelp).toContain('notice.{title,issuedOn,issuedOnDisplay,paragraphs[]}');
    await expect(teacher.school.getMarketplaceTemplate({ ...scope(), slug: 'report_card-default' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('selects, saves and previews a school notice template with the usual grants and optimistic concurrency', async () => {
    await expect(manager.school.getActiveDocumentTemplate(scope())).resolves.toBeNull();
    await expectPermissionDenied(teacher.school.selectMarketplaceTemplate({ ...scope(), slug: 'notice-default', expectedRevisionId: null }));
    const selected = await manager.school.selectMarketplaceTemplate({ ...scope(), slug: 'notice-default', expectedRevisionId: null });
    expect(selected.artifact).toMatchObject({ kind: 'template', documentType: 'notice', marketplaceSlug: 'notice-default', pageSize: 'full' });
    const [pointer] = await db.select().from(schoolDocumentTemplateTable).where(and(eq(schoolDocumentTemplateTable.schoolId, schoolId), eq(schoolDocumentTemplateTable.documentType, 'notice')));
    expect(pointer?.artifactId).toBe(selected.artifact.id);

    const content = '<article class="mine"><h1>{{notice.title}}</h1>{{#each notice.paragraphs}}<p>{{this}}</p>{{/each}}<script>bad()</script></article>';
    const preview = await teacher.school.previewDocumentTemplate({ ...scope(), content });
    expect(preview.html).toContain('<h1>Annual Sports Day</h1>');
    expect(preview.html).not.toContain('<script');
    await expectPermissionDenied(teacher.school.saveDocumentTemplate({ ...scope(), name: 'Mine', content, pageSize: 'full', expectedRevisionId: selected.artifact.id }));
    await expect(manager.school.saveDocumentTemplate({ ...scope(), name: 'Mine', content, pageSize: 'full', expectedRevisionId: null })).rejects.toMatchObject({ code: 'CONFLICT' });
    const saved = await manager.school.saveDocumentTemplate({ ...scope(), name: 'Mine', content, pageSize: 'full', expectedRevisionId: selected.artifact.id });
    await expect(teacher.school.getActiveDocumentTemplate(scope())).resolves.toMatchObject({ artifact: { id: saved.artifact.id, name: 'Mine' }, content });
    // The earlier revision is kept: published notices may have pinned it.
    expect(await db.select().from(artifactTable).where(and(eq(artifactTable.schoolId, schoolId), eq(artifactTable.documentType, 'notice')))).toHaveLength(2);

    // Notices have no half-A4 footprint, and invalid Handlebars is refused.
    await expect(manager.school.saveDocumentTemplate({ ...scope(), name: 'Half', content, pageSize: 'half', expectedRevisionId: saved.artifact.id })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(manager.school.saveDocumentTemplate({ ...scope(), name: 'Bad', content: '{{#each notice.paragraphs}}', pageSize: 'full', expectedRevisionId: saved.artifact.id })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('has no generator: a notice is never a document source and never in document history', async () => {
    const template = await manager.school.getActiveDocumentTemplate(scope());
    const source = { documentType: 'notice', sessionId } as never;
    await expect(manager.school.previewDocument({ schoolId, source, templateRevisionId: template!.artifact.id })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(manager.school.generateDocument({ schoolId, source, templateRevisionId: template!.artifact.id })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(manager.school.listDocumentArtifacts({ schoolId, filters: { documentType: 'notice' } })).resolves.toMatchObject({ pagination: { totalItems: 0 } });
  });

  it('refuses every notice template procedure without the notices feature, and leaves other document types alone', async () => {
    const off = await createTestSchool();
    const client = createTestClient((await createSchoolStaffSession(off.id, [{ role: 'manager' }])).session);
    const offScope = { schoolId: off.id, documentType: 'notice' as const };
    await expectFeatureDisabled(client.school.listMarketplaceTemplates(offScope), 'notices');
    await expectFeatureDisabled(client.school.getMarketplaceTemplate({ ...offScope, slug: 'notice-default' }), 'notices');
    await expectFeatureDisabled(client.school.getActiveDocumentTemplate(offScope), 'notices');
    await expectFeatureDisabled(client.school.selectMarketplaceTemplate({ ...offScope, slug: 'notice-default', expectedRevisionId: null }), 'notices');
    await expectFeatureDisabled(client.school.saveDocumentTemplate({ ...offScope, name: 'N', content: '<p>x</p>', pageSize: 'full', expectedRevisionId: null }), 'notices');
    await expectFeatureDisabled(client.school.previewDocumentTemplate({ ...offScope, content: '<p>x</p>' }), 'notices');
    expect(await db.select().from(artifactTable).where(eq(artifactTable.schoolId, off.id))).toHaveLength(0);
    await expect(client.school.listMarketplaceTemplates({ schoolId: off.id, documentType: 'report_card' })).resolves.toMatchObject({ items: expect.any(Array) });
    // The permission is still checked first: an outsider learns nothing about the feature.
    await expectPermissionDenied(manager.school.listMarketplaceTemplates(offScope));

    await setTestSchoolFeature(schoolId, 'notices', false);
    await expectFeatureDisabled(manager.school.getActiveDocumentTemplate(scope()), 'notices');
    await setTestSchoolFeature(schoolId, 'notices', true);
    await expect(manager.school.getActiveDocumentTemplate(scope())).resolves.toMatchObject({ artifact: { documentType: 'notice' } });
  });
});
