import { db } from '@campuspilot/db';
import { classTable, sectionTable } from '@campuspilot/db/schema/class';
import { schoolBillingPeriodTable } from '@campuspilot/db/schema/school-billing';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolFeatureFlagTable } from '@campuspilot/db/schema/school-feature-flag';
import { schoolRegistrationRequestTable } from '@campuspilot/db/schema/school-registration-request';
import { schoolSetupTable } from '@campuspilot/db/schema/school-setup';
import { schoolUserRoleTable } from '@campuspilot/db/schema/school-user-role';
import { schoolSessionTable } from '@campuspilot/db/schema/session';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createAdminSession } from '../../test/fixtures';
import { SCHOOL_SETUP_RUN_STEPS, initialSchoolSetupDraft, readRequestFacts, type SchoolSetupDraft } from './school-setup.contract';
import { readSchoolSetupResult, runSchoolSetupStep } from './school-setup.service';
import { selectedTemplateSlugs } from '../../test/documents';
import { DEFAULT_DOCUMENT_TEMPLATE_SLUGS } from '../routers/school/document/document.catalog';

async function runningSetup(overrides: (draft: SchoolSetupDraft) => SchoolSetupDraft = (draft) => draft) {
  const admin = await createAdminSession();
  const marker = crypto.randomUUID().slice(0, 8);
  const response = {
    schoolName: `Setup School ${marker}`,
    phone: `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
    email: null,
    address: '14 Station Road, Jaipur',
    classes: [
      { name: 'Nursery', sections: ['A'], subjects: ['English', 'Hindi'] },
      { name: 'Class 1', sections: ['A', 'B'], subjects: ['English', 'Mathematics'] },
    ],
  };
  const [request] = await db
    .insert(schoolRegistrationRequestTable)
    .values({ formVersion: 1, submissionId: crypto.randomUUID(), response })
    .returning({ id: schoolRegistrationRequestTable.id });
  const draft = overrides(initialSchoolSetupDraft(readRequestFacts(response, false), new Date()));
  draft.school.slug = `setup-${marker}`;
  draft.features.adjustments = { assistant: true };
  draft.features.assistantMonthlyLimitUsd = 10;
  const [setup] = await db
    .insert(schoolSetupTable)
    .values({ requestId: request!.id, draft, draftStep: 'people', status: 'running', requestedBy: admin.user.id })
    .returning();
  return { setup: setup!, slug: draft.school.slug, draft, adminId: admin.user.id, phone: response.phone };
}

async function runAll(setupId: string, attempt = 1) {
  for (const step of SCHOOL_SETUP_RUN_STEPS) await runSchoolSetupStep(setupId, attempt, step, new Date());
}

describe('school setup steps', () => {
  it('creates the school with its plan, session, classes and people', async () => {
    const { setup, adminId, phone } = await runningSetup();
    await runAll(setup.id);
    const result = await readSchoolSetupResult(setup.id);
    const [school] = await db.select().from(schoolTable).where(eq(schoolTable.id, result.schoolId));
    expect(school).toMatchObject({ isDemo: false, tier: null, location: '14 Station Road, Jaipur' });
    // Like every new school, it starts with the CampusPilot Standard templates selected.
    expect(await selectedTemplateSlugs(result.schoolId)).toEqual(DEFAULT_DOCUMENT_TEMPLATE_SLUGS);
    expect(await db.select({ tier: schoolBillingPeriodTable.tier, kind: schoolBillingPeriodTable.kind }).from(schoolBillingPeriodTable).where(eq(schoolBillingPeriodTable.schoolId, result.schoolId))).toEqual([{ tier: 'pro', kind: 'trial' }]);
    const [assistant] = await db.select().from(schoolFeatureFlagTable).where(and(eq(schoolFeatureFlagTable.schoolId, result.schoolId), eq(schoolFeatureFlagTable.feature, 'assistant')));
    expect(assistant).toMatchObject({ enabled: true, config: expect.objectContaining({ monthlyLimitUsd: 10 }) });
    expect(await db.select({ id: schoolSessionTable.id }).from(schoolSessionTable).where(eq(schoolSessionTable.schoolId, result.schoolId))).toHaveLength(1);
    const classes = await db.select({ slug: classTable.slug }).from(classTable).where(eq(classTable.schoolId, result.schoolId));
    expect(classes.map((entry) => entry.slug).sort()).toEqual(['class-1', 'nursery']);
    expect(await db.select({ id: sectionTable.id }).from(sectionTable).where(eq(sectionTable.schoolId, result.schoolId))).toHaveLength(3);
    expect(result).toMatchObject({ classCount: 2, examCount: 4, principalHasPassword: false });
    const roles = await db.select({ userId: schoolUserRoleTable.userId, role: schoolUserRoleTable.role }).from(schoolUserRoleTable).where(eq(schoolUserRoleTable.schoolId, result.schoolId));
    expect(roles).toEqual(expect.arrayContaining([{ userId: adminId, role: 'manager' }, { userId: result.principalUserId, role: 'principal' }]));
    expect(school!.ownerUserId).toBe(result.principalUserId);
    const principal = await db.query.user.findFirst({ where: (table, { eq: equals }) => equals(table.id, result.principalUserId) });
    expect(principal).toMatchObject({ phoneNumber: phone, emailIsPlaceholder: true });
  });

  it('never repeats a finished step, across replays and attempts', async () => {
    const { setup, slug } = await runningSetup();
    await runSchoolSetupStep(setup.id, 1, 'school', new Date());
    await runSchoolSetupStep(setup.id, 1, 'school', new Date());
    await db.update(schoolSetupTable).set({ attempt: 2 }).where(eq(schoolSetupTable.id, setup.id));
    await runAll(setup.id, 2);
    const [row] = await db.select().from(schoolSetupTable).where(eq(schoolSetupTable.id, setup.id));
    expect(row!.completedSteps).toEqual([...SCHOOL_SETUP_RUN_STEPS]);
    expect(await db.select({ id: schoolTable.id }).from(schoolTable).where(eq(schoolTable.slug, slug))).toHaveLength(1);
  });

  it('refuses a stale attempt and a taken slug', async () => {
    const { setup, slug } = await runningSetup();
    await expect(runSchoolSetupStep(setup.id, 9, 'school', new Date())).rejects.toThrow('no longer the running one');
    const other = await runningSetup();
    await db.update(schoolSetupTable).set({ draft: { ...other.draft, school: { ...other.draft.school, slug } } }).where(eq(schoolSetupTable.id, other.setup.id));
    await runSchoolSetupStep(setup.id, 1, 'school', new Date());
    await expect(runSchoolSetupStep(other.setup.id, 1, 'school', new Date())).rejects.toThrow('already uses the address');
  });
});
