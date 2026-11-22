import { DEFAULT_SCHOOL_KINDS } from '@campuspilot/db/school-kind';
import type { AnyRouter } from '@orpc/server';
import { describe, expect, it } from 'vitest';

import { expectPermissionDenied } from '../../test/feature-flags';
import { createAdminSession, createSchoolStaffSession, createTestClient, createTestSchool } from '../../test/fixtures';
import { googleNewcomer, personalSpaceOwner } from '../../test/personal-space';
import { db } from '@campuspilot/db';
import { schoolMemberTable } from '@campuspilot/db/schema/school-member';

import { appRouter } from '../routers/index';
import { SCHOOL_KIND_UNSUPPORTED_REASON, schoolKindRefusalOf } from './school-access.contract';
import { listingSchoolKindsOf, readSchoolKind } from './school-kind.service';

/** The school kind gate (docs/personal-space.md). */

async function refusalOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, 'the call should have been refused').not.toBeNull();
  return error as { code?: string; data?: { reason?: string } };
}

describe('the school kind gate', () => {
  it('refuses a real-school procedure for a personal space, reads included, with its reason', async () => {
    const { client, schoolId } = await personalSpaceOwner();
    const read = await refusalOf(client.school.listSessions({ schoolId, limit: 1 }));
    expect(read).toMatchObject({ code: 'FORBIDDEN', data: { reason: SCHOOL_KIND_UNSUPPORTED_REASON, schoolKind: 'personal' } });
    expect(schoolKindRefusalOf(read)).toBe('personal');
    const write = await refusalOf(client.school.createClass({ schoolId, slug: 'class-1', label: 'Class 1', sections: [{ slug: 'a', label: 'A' }] }));
    expect(schoolKindRefusalOf(write)).toBe('personal');
  });

  it('serves a personal space the procedures that say so', async () => {
    const { client, schoolId } = await personalSpaceOwner();
    await expect(client.school.getFeatureFlags({ schoolId })).resolves.toMatchObject({ schoolId });
    await expect(client.school.listStandalonePapers({ schoolId })).resolves.toMatchObject({ items: [] });
  });

  it('refuses a personal space procedure for a real school', async () => {
    const school = await createTestSchool({ features: ['assistant'] });
    const principal = await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }]);
    const error = await refusalOf(createTestClient(principal.session).school.listStandalonePapers({ schoolId: school.id }));
    expect(schoolKindRefusalOf(error)).toBe('school');
  });

  it('tells an outsider nothing: a plain permission denial', async () => {
    const { schoolId } = await personalSpaceOwner();
    const outsider = await googleNewcomer('Outsider');
    await expectPermissionDenied(outsider.client.school.listSessions({ schoolId, limit: 1 }));
    await expectPermissionDenied(outsider.client.school.listStandalonePapers({ schoolId }));
  });

  it('keeps the read-only gate after the kind gate: a suspended personal space refuses its own changes', async () => {
    const { client, schoolId } = await personalSpaceOwner();
    const admin = createTestClient(await createAdminSession());
    await admin.systemAdmin.suspendSchool({ id: schoolId, reason: 'Test' });
    const error = await refusalOf(client.school.createStandalonePaper({ schoolId }));
    expect(error).toMatchObject({ code: 'FORBIDDEN', data: { reason: 'SCHOOL_SUSPENDED' } });
    // Reads keep working, and the kind refusal still comes first for a real-school procedure.
    await expect(client.school.listStandalonePapers({ schoolId })).resolves.toMatchObject({ items: [] });
    expect(schoolKindRefusalOf(await refusalOf(client.school.listSessions({ schoolId, limit: 1 })))).toBe('personal');
  });

  it('does not hold platform administration, also where its input names the school as schoolId', async () => {
    const { schoolId } = await personalSpaceOwner();
    const admin = createTestClient(await createAdminSession());
    await expect(admin.systemAdmin.getSchool({ id: schoolId })).resolves.toMatchObject({ id: schoolId, kind: 'personal' });
    // `getSchoolStats` takes `schoolId`, the field the gate reads: only its platform administration meta lets it through.
    await expect(admin.systemAdmin.getSchoolStats({ schoolId })).resolves.toBeDefined();
  });
});

describe('the cached school kind', () => {
  it("remembers a school's kind, which never changes, and does not remember a missing school", async () => {
    const { schoolId } = await personalSpaceOwner();
    await expect(readSchoolKind(db, schoolId)).resolves.toBe('personal');
    // Served from the process cache: even a reader that would fail is not asked.
    const failingReader = new Proxy(db, {
      get: () => {
        throw new Error('the cached kind should not be read again');
      },
    });
    await expect(readSchoolKind(failingReader, schoolId)).resolves.toBe('personal');
    await expect(readSchoolKind(db, 'no-such-school')).resolves.toBeNull();
  });
});

describe('the school kinds an MCP listing may narrow by', () => {
  it('narrows by the kinds of the schools a member belongs to', async () => {
    const owner = await personalSpaceOwner();
    expect(await listingSchoolKindsOf(db, owner.session.user)).toEqual(new Set(['personal']));
    const school = await createTestSchool();
    await db.insert(schoolMemberTable).values({ schoolId: school.id, userId: owner.userId });
    expect(await listingSchoolKindsOf(db, owner.session.user)).toEqual(new Set(['personal', 'school']));
  });

  it('never narrows a platform administrator, who acts on any school through platform grants', async () => {
    const admin = await createAdminSession();
    expect(await listingSchoolKindsOf(db, admin.user)).toBeUndefined();
    // Not even one whose only membership is a personal space.
    const { schoolId } = await personalSpaceOwner();
    await db.insert(schoolMemberTable).values({ schoolId, userId: admin.user.id });
    expect(await listingSchoolKindsOf(db, admin.user)).toBeUndefined();
  });

  it('never narrows a user with no membership: nothing proves a tool unusable', async () => {
    const newcomer = await googleNewcomer('No School');
    expect(await listingSchoolKindsOf(db, newcomer.session.user)).toBeUndefined();
  });
});

type ProcedureLike = { '~orpc': { meta: { schoolKinds?: readonly string[]; platformAdministration?: true } } };

/** Every leaf of a router with its dotted path. */
function leavesOf(router: AnyRouter, path: string[] = []): Array<[string, ProcedureLike]> {
  return Object.entries(router as unknown as Record<string, unknown>).flatMap(([name, value]) => {
    if (value && typeof value === 'object' && '~orpc' in value) return [[[...path, name].join('.'), value as ProcedureLike]] as Array<[string, ProcedureLike]>;
    return value && typeof value === 'object' ? leavesOf(value as AnyRouter, [...path, name]) : [];
  });
}

describe('every procedure is classified by the kinds of school it serves', () => {
  /**
   * The procedures that serve personal spaces. Serving one more is a
   * deliberate product decision (docs/personal-space.md): add it here and to
   * the guide. Every other procedure serves real schools only, the default.
   */
  const PERSONAL_SPACE_PROCEDURES = {
    'school.getFeatureFlags': ['school', 'personal'],
    'school.listStandalonePapers': ['personal'],
    'school.listStandalonePaperFilterOptions': ['personal'],
    'school.createStandalonePaper': ['personal'],
    'school.getStandalonePaper': ['personal'],
    'school.getStandalonePaperDraft': ['personal'],
    'school.listStandalonePaperVersions': ['personal'],
    'school.learn_standalone_question_paper': ['personal'],
    'school.validateStandalonePaperDraft': ['personal'],
    'school.saveStandalonePaperVersion': ['personal'],
    'school.editStandalonePaper': ['personal'],
    'school.startStandalonePaperGeneration': ['personal'],
    'school.getStandalonePaperDetail': ['personal'],
    'school.reorderStandalonePaperPages': ['personal'],
    'school.reserveStandalonePaperPages': ['personal'],
    'school.releaseStandalonePaperPage': ['personal'],
    'school.deleteStandalonePaperPage': ['personal'],
    'school.rotateStandalonePaperPage': ['personal'],
    'school.deleteStandalonePaper': ['personal'],
    'school.getStandalonePaperPreview': ['personal'],
    'school.previewStandalonePaperDraft': ['personal'],
    'school.getStandalonePaperDownload': ['personal'],
  } as const;

  it('lists exactly the procedures that serve personal spaces, and leaves every other one to real schools', () => {
    const leaves = leavesOf(appRouter as unknown as AnyRouter);
    expect(leaves.length).toBeGreaterThan(200);
    const declared = Object.fromEntries(
      leaves.filter(([, procedure]) => procedure['~orpc'].meta.schoolKinds !== undefined).map(([name, procedure]) => [name, [...procedure['~orpc'].meta.schoolKinds!]]),
    );
    expect(declared).toEqual(PERSONAL_SPACE_PROCEDURES);
    // Without a declaration a procedure serves real schools only, so a new one fails closed for a personal space.
    expect(DEFAULT_SCHOOL_KINDS).toEqual(['school']);
  });

  it('marks exactly the systemAdmin procedures as platform administration, which no school gate holds', () => {
    const leaves = leavesOf(appRouter as unknown as AnyRouter);
    const marked = leaves.filter(([, procedure]) => procedure['~orpc'].meta.platformAdministration === true).map(([name]) => name);
    const systemAdmin = leaves.map(([name]) => name).filter((name) => name.startsWith('systemAdmin.'));
    expect(systemAdmin.length).toBeGreaterThan(10);
    expect(marked.sort()).toEqual(systemAdmin.sort());
  });
});
