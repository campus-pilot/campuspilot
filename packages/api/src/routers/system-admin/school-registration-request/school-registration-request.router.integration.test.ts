import { db } from '@campuspilot/db';
import { schoolRegistrationRequestTable } from '@campuspilot/db/schema/school-registration-request';
import { beforeAll, describe, expect, it } from 'vitest';

import { createAdminSession, createRegularUserSession, createTestClient, type TestClient } from '../../../../test/fixtures';

let admin: TestClient;
const marker = `Onboard${crypto.randomUUID().slice(0, 8)}`;
let withFilesId = '';

beforeAll(async () => {
  admin = createTestClient(await createAdminSession());
  const rows = await db
    .insert(schoolRegistrationRequestTable)
    .values([
      { formVersion: 1, submissionId: crypto.randomUUID(), response: { schoolName: `${marker} Older`, phone: '+919876543210' }, createdAt: new Date(Date.now() - 60_000) },
      {
        formVersion: 1,
        submissionId: crypto.randomUUID(),
        response: { schoolName: `${marker} Newer`, phone: '+919876543211' },
        logoS3Key: 'school-registration-requests/test/logo.png',
        logoContentType: 'image/png',
        logoBytes: 10,
        voiceNoteS3Key: 'school-registration-requests/test/voice-note.webm',
        voiceNoteContentType: 'audio/webm',
        voiceNoteBytes: 20,
      },
    ])
    .returning({ id: schoolRegistrationRequestTable.id });
  withFilesId = rows[1]!.id;
});

describe('systemAdmin.listSchoolRegistrationRequests', () => {
  it('lists requests newest first with their answers and files, never their storage keys', async () => {
    const result = await admin.systemAdmin.listSchoolRegistrationRequests({ searchQuery: marker });
    expect(result.items.map((item) => item.response.schoolName)).toEqual([`${marker} Newer`, `${marker} Older`]);
    expect(result.items[0]).toMatchObject({ logo: { contentType: 'image/png', bytes: 10 }, voiceNote: { contentType: 'audio/webm', bytes: 20 } });
    expect(result.items[1]).toMatchObject({ logo: null, voiceNote: null });
    expect(JSON.stringify(result)).not.toContain('school-registration-requests/');
  });

  it('presigns the files of one request', async () => {
    const media = await admin.systemAdmin.getSchoolRegistrationRequestMedia({ requestId: withFilesId });
    expect(media.logoUrl).toContain('logo.png');
    expect(media.voiceNoteUrl).toContain('voice-note.webm');
  });

  it('is refused to anyone but a platform admin', async () => {
    const user = createTestClient(await createRegularUserSession());
    await expect(user.systemAdmin.listSchoolRegistrationRequests({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(user.systemAdmin.getSchoolRegistrationRequestMedia({ requestId: withFilesId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
