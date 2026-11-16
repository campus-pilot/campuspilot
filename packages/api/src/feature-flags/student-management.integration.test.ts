import { db } from '@campuspilot/db';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { expectFeatureDisabled, expectPermissionDenied } from '../../test/feature-flags';
import {
  createRegularUserSession,
  createSchoolStaffSession,
  createTestClient,
  createTestSchool,
  createTestSession,
  setTestSchoolFeature,
} from '../../test/fixtures';
import { isSchoolFeatureEnabled, readSchoolFeatureFlags } from './feature-flags.service';

const admissionInput = (schoolId: string) => ({
  schoolId,
  name: 'Student SM-1',
  admissionNo: 'SM-1',
  address: 'Test address',
  phoneNo: '9999999999',
  whatsappSameAsPhone: true,
  email: 'sm-1@example.com',
  dob: '2015-01-01',
  fatherName: 'Test Father',
  motherName: 'Test Mother',
});

/** A school whose principal is signed in, with an active session, and student management switched off. */
async function staffOnlySchool() {
  const school = await createTestSchool();
  const session = await createTestSession({ schoolId: school.id, sessionStartYear: 2026, sessionEndYear: 2027, isActive: true });
  const principal = await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }]);
  await setTestSchoolFeature(school.id, 'studentManagement', false);
  return { school, session, client: createTestClient(principal.session) };
}

describe('student management feature', () => {
  it('is on for a school with no stored row, existing or new', async () => {
    const school = await createTestSchool();
    const principal = await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }]);
    expect(await isSchoolFeatureEnabled(db, school.id, 'studentManagement')).toBe(true);
    await expect(createTestClient(principal.session).school.listAdmissions({ schoolId: school.id })).resolves.toMatchObject({ items: [] });
  });

  it('refuses admissions, students, fees and student documents without it, and writes nothing', async () => {
    const { school, session, client } = await staffOnlySchool();

    await expectFeatureDisabled(client.school.listAdmissions({ schoolId: school.id }), 'studentManagement');
    await expectFeatureDisabled(client.school.createAdmission(admissionInput(school.id)), 'studentManagement');
    expect(await db.select().from(admissionTable).where(eq(admissionTable.schoolId, school.id))).toEqual([]);
    await expectFeatureDisabled(client.school.listStudents({ schoolId: school.id, sessionId: session.id }), 'studentManagement');
    await expectFeatureDisabled(client.school.getSessionFinance({ schoolId: school.id, sessionId: session.id }), 'studentManagement');
    await expectFeatureDisabled(client.school.listDocumentArtifacts({ schoolId: school.id, filters: {} }), 'studentManagement');
    await expectFeatureDisabled(
      client.school.getActiveDocumentTemplate({ schoolId: school.id, documentType: 'report_card' }),
      'studentManagement',
    );
  });

  it('keeps staff, classes and examinations working without it', async () => {
    const { school, session, client } = await staffOnlySchool();
    await expect(client.school.listMembers({ schoolId: school.id })).resolves.toMatchObject({ items: expect.any(Array) });
    await expect(client.school.listClasses({ schoolId: school.id, sessionId: session.id })).resolves.toEqual([]);
    await expect(client.school.listExams({ schoolId: school.id, sessionId: session.id })).resolves.toBeDefined();
  });

  it('checks the permission first, so a caller without access learns nothing about the school', async () => {
    const { school } = await staffOnlySchool();
    const outsider = createTestClient(await createRegularUserSession());
    await expectPermissionDenied(outsider.school.listAdmissions({ schoolId: school.id }));
  });

  it('leaves the dashboard without admissions, students and billing, and without their jobs', async () => {
    const { school, session, client } = await staffOnlySchool();
    const dashboard = await client.school.getDashboard({ schoolId: school.id, sessionId: session.id });
    expect(dashboard).toMatchObject({
      admissions: null,
      classrooms: null,
      billing: null,
      actions: { createAdmission: false, recordPayment: false, enterResults: false, createNotice: false },
    });
    expect(dashboard.examinations).not.toBeNull();
  });

  it('takes notices and the Cadet Portal with it, keeping their switches, and gives them back', async () => {
    const { school, session, client } = await staffOnlySchool();
    await setTestSchoolFeature(school.id, 'notices', true);
    await setTestSchoolFeature(school.id, 'cadet', true);

    const { features } = await readSchoolFeatureFlags(db, school.id);
    expect(features.notices).toEqual({ enabled: true, active: false, config: null });
    expect(features.cadet).toEqual({ enabled: true, active: false, config: null });
    // Refused for the feature that was asked for, as every gate refuses.
    await expectFeatureDisabled(client.school.listNotices({ schoolId: school.id, sessionId: session.id }), 'notices');

    await setTestSchoolFeature(school.id, 'studentManagement', true);
    await expect(client.school.listNotices({ schoolId: school.id, sessionId: session.id })).resolves.toMatchObject({ items: [] });
    await expect(client.school.listAdmissions({ schoolId: school.id })).resolves.toMatchObject({ items: [] });
    expect((await readSchoolFeatureFlags(db, school.id)).features.cadet).toEqual({ enabled: true, active: true, config: null });
  });

  it('is read by the school\'s staff as not active', async () => {
    const { school, client } = await staffOnlySchool();
    const { features } = await client.school.getFeatureFlags({ schoolId: school.id });
    expect(features.studentManagement).toEqual({ enabled: false, active: false, config: null });
  });
});
