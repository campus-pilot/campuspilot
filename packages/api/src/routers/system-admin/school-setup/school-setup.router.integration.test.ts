import { db } from '@campuspilot/db';
import { schoolRegistrationRequestTable } from '@campuspilot/db/schema/school-registration-request';
import { schoolSetupTable } from '@campuspilot/db/schema/school-setup';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { createAdminSession, createRegularUserSession, createTestClient, type TestClient } from '../../../../test/fixtures';

let admin: TestClient;

async function request() {
  const [row] = await db
    .insert(schoolRegistrationRequestTable)
    .values({
      formVersion: 1,
      submissionId: crypto.randomUUID(),
      response: {
        schoolName: `Router School ${crypto.randomUUID().slice(0, 6)}`,
        phone: '+919812345678',
        address: 'Hazratganj, Lucknow',
        classes: [{ name: 'Class 6', sections: ['A'], subjects: ['English'] }],
      },
    })
    .returning({ id: schoolRegistrationRequestTable.id });
  return row!.id;
}

beforeAll(async () => {
  admin = createTestClient(await createAdminSession());
});

describe('school setup procedures', () => {
  it('proposes a draft from the answers, then saves and reopens it', async () => {
    const requestId = await request();
    const first = await admin.systemAdmin.getSchoolSetup({ requestId });
    expect(first.setup).toBeNull();
    expect(first.proposedDraft.classes).toEqual([{ name: 'Class 6', sections: ['A'], subjects: ['English'] }]);
    const draft = { ...first.proposedDraft, school: { ...first.proposedDraft.school, registrationNo: 'REG-1' } };
    await admin.systemAdmin.saveSchoolSetupDraft({ requestId, draft, step: 'plan' });
    const reopened = await admin.systemAdmin.getSchoolSetup({ requestId });
    expect(reopened.setup).toMatchObject({ status: 'draft', draftStep: 'plan', draft: { school: { registrationNo: 'REG-1' } } });
  });

  it('starts a ready setup and refuses edits while it runs', async () => {
    const requestId = await request();
    const { proposedDraft } = await admin.systemAdmin.getSchoolSetup({ requestId });
    const started = await admin.systemAdmin.startSchoolSetup({ requestId, draft: proposedDraft, step: 'people' });
    expect(started).toMatchObject({ status: 'queued', attempt: 1 });
    await expect(admin.systemAdmin.saveSchoolSetupDraft({ requestId, draft: proposedDraft, step: 'school' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await db.update(schoolSetupTable).set({ status: 'failed', error: { step: 'school', message: 'x' } }).where(eq(schoolSetupTable.requestId, requestId));
    const retried = await admin.systemAdmin.startSchoolSetup({ requestId, draft: proposedDraft, step: 'people' });
    expect(retried).toMatchObject({ status: 'queued', attempt: 2, error: null });
  });

  it('refuses an incomplete draft with the steps that need attention', async () => {
    const requestId = await request();
    const { proposedDraft } = await admin.systemAdmin.getSchoolSetup({ requestId });
    const incomplete = { ...proposedDraft, classes: [], people: { ...proposedDraft.people, principal: { name: '', phone: '', email: '' } } };
    await expect(admin.systemAdmin.startSchoolSetup({ requestId, draft: incomplete, step: 'people' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      data: { issues: expect.arrayContaining([expect.objectContaining({ step: 'classes' }), expect.objectContaining({ step: 'people' })]) },
    });
  });

  it('is refused to anyone but a platform admin', async () => {
    const requestId = await request();
    const user = createTestClient(await createRegularUserSession());
    await expect(user.systemAdmin.getSchoolSetup({ requestId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
