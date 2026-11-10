import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { createCadetTestClient, signInCadet } from '../../../test/cadet';
import { expectRpcCode } from '../../../test/finance/assertions';
import {
  createSchoolStaffSession,
  createTestAdmission,
  createTestClient,
  createTestSchool,
} from '../../../test/fixtures';
import {
  billIssuedData,
  billingRunPostedData,
  createCadetClientForAdmission,
  emitAndDispatch,
} from '../../../test/notifications';
import { notificationRowId } from '../../notifications/ids';

async function studentInbox() {
  const school = await createTestSchool();
  const admission = await createTestAdmission({ schoolId: school.id });
  const { eventId } = await emitAndDispatch({
    type: 'bill.issued',
    data: billIssuedData(admission.id, { billNumber: 'BILL/1' }),
    schoolId: school.id,
    recipients: { kind: 'admissions', admissionIds: [admission.id] },
  });
  const id = notificationRowId(eventId, { kind: 'admission', id: admission.id });
  return { school, admission, id, client: createCadetClientForAdmission(admission.id) };
}

describe('cadet notification inbox', () => {
  it('rejects anonymous callers', async () => {
    await expectRpcCode(createCadetTestClient(new Headers()).getUnreadNotificationCount(), 'UNAUTHORIZED');
  });

  it("shows the signed-in admission's own rows only, without delivery status", async () => {
    const { school, admission, id, client } = await studentInbox();
    // A classmate's row and a staff row in the same school.
    const classmate = await createTestAdmission({ schoolId: school.id });
    await emitAndDispatch({ type: 'bill.issued', data: billIssuedData(classmate.id), schoolId: school.id, recipients: { kind: 'admissions', admissionIds: [classmate.id] } });
    const staff = await createSchoolStaffSession(school.id, []);
    await emitAndDispatch({ type: 'billing.run_posted', data: billingRunPostedData(), schoolId: school.id, recipients: { kind: 'staff_users', userIds: [staff.user.id] } });

    const page = await client.listNotifications({});
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id, type: 'bill.issued', data: { admissionId: admission.id, billNumber: 'BILL/1' }, readAt: null });
    // The DTO has no channel or delivery fields at all.
    expect(Object.keys(page.items[0]!).sort()).toEqual(['createdAt', 'data', 'id', 'readAt', 'type']);
    expect(await client.getUnreadNotificationCount()).toEqual({ count: 1 });
    // The staff member never sees the student's row either.
    expect((await createTestClient(staff.session).school.listNotifications({ schoolId: school.id })).items.map((item) => item.type)).toEqual(['billing.run_posted']);
  });

  it('marks read, marks all read and dismisses only its own rows', async () => {
    const { school, id, client } = await studentInbox();
    const classmate = await createTestAdmission({ schoolId: school.id });
    const { eventId } = await emitAndDispatch({ type: 'bill.issued', data: billIssuedData(classmate.id), schoolId: school.id, recipients: { kind: 'admissions', admissionIds: [classmate.id] } });
    const classmateRow = notificationRowId(eventId, { kind: 'admission', id: classmate.id });

    expect(await client.dismissNotifications({ ids: [id] })).toEqual({ changed: 0 });
    expect(await client.markNotificationsRead({ ids: [id, classmateRow] })).toEqual({ changed: 1 });
    expect(await client.markAllNotificationsRead({})).toEqual({ changed: 0 });
    expect(await client.dismissNotifications({ ids: [id, classmateRow] })).toEqual({ changed: 1 });
    expect((await client.listNotifications({})).items).toEqual([]);
    expect(await createCadetClientForAdmission(classmate.id).getUnreadNotificationCount()).toEqual({ count: 1 });
  });

  it('works through a real cadet sign-in', async () => {
    const school = await createTestSchool();
    const principal = await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }]);
    const created = await createTestClient(principal.session).school.createAdmission({
      schoolId: school.id,
      name: 'Inbox Student',
      admissionNo: `NTF-${randomUUID().slice(0, 6)}`,
      address: 'Test address',
      phoneNo: '9999999999',
      whatsappSameAsPhone: true,
      dob: '2017-02-03',
      fatherName: 'Father',
      motherName: 'Mother',
      generateCadetPassword: true,
    });
    await emitAndDispatch({ type: 'bill.issued', data: billIssuedData(created.id), schoolId: school.id, recipients: { kind: 'admissions', admissionIds: [created.id] } });
    const { cookie } = await signInCadet(created.cadetPassword!);
    const client = createCadetTestClient(new Headers({ cookie }));
    expect(await client.getUnreadNotificationCount()).toEqual({ count: 1 });
  });
});
