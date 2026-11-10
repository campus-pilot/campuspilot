import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { db } from '@campuspilot/db';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { noticeTable } from '@campuspilot/db/schema/notice';
import { notificationDeliveryTable, notificationEventTable, notificationTable } from '@campuspilot/db/schema/notification';
import { env } from '@campuspilot/env/server';
import { getS3Client } from '@campuspilot/s3/client';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { expectFeatureDisabled } from '../../../test/feature-flags';
import {
  createSchoolStaffSession,
  createTestAdmission,
  createTestClass,
  createTestClient,
  createTestSchool,
  createTestSession,
  createTestStudent,
  setTestSchoolFeature,
  type TestClient,
} from '../../../test/fixtures';
import { createCadetLogin, dispatchNow, drainSchool } from '../../../test/notifications';
import { noticePdfKey } from '../../routers/school/notice/notice.render';
import type { ChannelFetch, NotificationChannelAdapter } from '../channels';
import { createWhatsAppAdapter } from '../channels/whatsapp/adapter';
import { createNoticeDocumentSource } from '../documents/notice';
import { sweepWhatsAppFailureAlerts } from '../failure-alerts';
import { MAX_EVENT_RECIPIENTS, noticeEventKey, noticeStaffEventKey } from './notices';

const config = { accessToken: 'test-token-0123456789', phoneNumberId: '1234567890', graphApiVersion: 'v24.0', graphBaseUrl: 'https://graph.test' };
const pushOff: NotificationChannelAdapter = { channel: 'web_push', available: false, unavailableReason: 'test' };

/** A school with two classes; Asha and Bela (Grade 6) can receive WhatsApp, Chetan (Grade 7) has no number. */
describe('notice notifications', () => {
  let schoolId: string, sessionId: string, grade6: string, grade7: string;
  let asha: string, bela: string, chetan: string;
  let principal: TestClient, teacher: TestClient, accountant: TestClient;
  let principalId: string, managerId: string, teacherId: string, accountantId: string;

  const body = (overrides: Record<string, unknown> = {}) => ({
    schoolId,
    sessionId,
    title: 'Sports Day',
    bodyMode: 'plain' as const,
    body: 'The Annual Sports Day is on Saturday.',
    toStaff: true,
    cadetScope: 'none' as const,
    classIds: [] as string[],
    ...overrides,
  });
  const eventsOf = (noticeId: string) =>
    db
      .select()
      .from(notificationEventTable)
      .where(and(eq(notificationEventTable.schoolId, schoolId), like(notificationEventTable.key, `notice%:${noticeId}%`)));
  async function publish(overrides: Record<string, unknown>) {
    const draft = await principal.school.createNotice(body(overrides));
    await principal.school.publishNotice({ schoolId, noticeId: draft.id, expectedVersion: draft.version });
    return draft.id;
  }
  /** Fans out a notice's events and sends its WhatsApp copies through the real adapter with a mocked Graph API. */
  async function deliver(noticeId: string, fetchMock: ChannelFetch) {
    const whatsapp = createWhatsAppAdapter({ config, fetch: fetchMock }) as NotificationChannelAdapter;
    const adapters = { web_push: pushOff, whatsapp };
    for (const event of await eventsOf(noticeId)) await dispatchNow(event.id, adapters);
    await drainSchool(schoolId, { adapters });
  }
  const whatsappCopies = (noticeId: string) =>
    db
      .select({ status: notificationDeliveryTable.status, skipReason: notificationDeliveryTable.skipReason, errorCode: notificationDeliveryTable.errorCode, admissionId: notificationTable.admissionId, revision: notificationDeliveryTable.documentTemplateRevisionId, id: notificationDeliveryTable.id })
      .from(notificationDeliveryTable)
      .innerJoin(notificationTable, eq(notificationTable.id, notificationDeliveryTable.notificationId))
      .innerJoin(notificationEventTable, eq(notificationEventTable.id, notificationTable.eventId))
      .where(and(eq(notificationEventTable.schoolId, schoolId), eq(notificationEventTable.batchId, noticeId), eq(notificationDeliveryTable.channel, 'whatsapp')));

  beforeAll(async () => {
    schoolId = (await createTestSchool({ name: 'Notice Delivery School', features: ['notices', 'cadet'] })).id;
    sessionId = (await createTestSession({ schoolId, sessionStartYear: 2026, sessionEndYear: 2027, isActive: true })).id;
    grade6 = (await createTestClass({ schoolId, label: 'Grade 6' })).schoolClass.id;
    grade7 = (await createTestClass({ schoolId, label: 'Grade 7' })).schoolClass.id;
    const enroll = async (name: string, classId: string, whatsappNo: string | null) => {
      const admissionId = (await createTestAdmission({ schoolId, name })).id;
      if (whatsappNo) {
        await db.update(admissionTable).set({ phoneNo: whatsappNo, whatsappNo, whatsappSameAsPhone: true, whatsappVerified: true, whatsappConsent: true }).where(eq(admissionTable.id, admissionId));
      }
      await createTestStudent({ schoolId, sessionId, classId, admissionId });
      return admissionId;
    };
    asha = await enroll('Asha Six', grade6, '+919876500001');
    bela = await enroll('Bela Six', grade6, '+919876500002');
    chetan = await enroll('Chetan Seven', grade7, null);
    const principalSession = await createSchoolStaffSession(schoolId, [{ role: 'principal' }]);
    principal = createTestClient(principalSession.session);
    principalId = principalSession.user.id;
    managerId = (await createSchoolStaffSession(schoolId, [{ role: 'manager' }])).user.id;
    const teacherSession = await createSchoolStaffSession(schoolId, [{ role: 'teacher', meta: { classIds: [grade6] } }]);
    teacher = createTestClient(teacherSession.session);
    teacherId = teacherSession.user.id;
    const accountantSession = await createSchoolStaffSession(schoolId, [{ role: 'accountant' }]);
    accountant = createTestClient(accountantSession.session);
    accountantId = accountantSession.user.id;
  });

  it('derives stable event keys within the key limit and chunks staff at the event recipient limit', () => {
    expect(noticeEventKey('ntc_1', 'adm_1')).toBe('notice:ntc_1:adm_1');
    expect(noticeStaffEventKey('ntc_1', 0)).toBe('notice-staff:ntc_1');
    expect(noticeStaffEventKey('ntc_1', 2)).toBe('notice-staff:ntc_1:2');
    expect(MAX_EVENT_RECIPIENTS).toBe(10_000);
  });

  it('puts a staff notice in every member\'s inbox and nowhere else', async () => {
    const noticeId = await publish({ title: 'Staff meeting' });
    const events = await eventsOf(noticeId);
    expect(events.map((event) => event.type)).toEqual(['notice.published_staff']);
    for (const event of events) await dispatchNow(event.id);
    const rows = await db.select().from(notificationTable).where(eq(notificationTable.eventId, events[0]!.id));
    expect(rows.map((row) => row.userId).sort()).toEqual([principalId, managerId, teacherId, accountantId].sort());
    expect(rows.every((row) => row.recipientKind === 'staff_user' && row.schoolId === schoolId)).toBe(true);
    // Staff types have no remote copies at all.
    expect(await db.select().from(notificationDeliveryTable).where(inArray(notificationDeliveryTable.notificationId, rows.map((row) => row.id)))).toHaveLength(0);
    const inbox = await teacher.school.listNotifications({ schoolId });
    expect(inbox.items.find((item) => (item.data as { noticeId?: string }).noticeId === noticeId)).toMatchObject({
      type: 'notice.published_staff',
      data: { noticeId, sessionId, noticeTitle: 'Staff meeting' },
    });
  });

  it('notifies exactly the students of the chosen classes, in their own inbox, with the notice PDF on WhatsApp rendered once', async () => {
    const noticeId = await publish({ title: 'Grade 6 picnic', toStaff: false, cadetScope: 'selected_classes', classIds: [grade6] });
    expect((await eventsOf(noticeId)).map((event) => (event.data as { admissionId: string }).admissionId).sort()).toEqual([asha, bela].sort());

    const uploads: Uint8Array[] = [];
    const messages: Array<{ to: string; template: { name: string; components: Array<{ type: string; parameters: Array<Record<string, unknown>> }> } }> = [];
    const graph = vi.fn<ChannelFetch>(async (url, init) => {
      if (String(url).endsWith('/media')) {
        uploads.push(new Uint8Array(await ((init.body as FormData).get('file') as File).arrayBuffer()));
        return new Response(JSON.stringify({ id: `media-${uploads.length}` }), { status: 200 });
      }
      messages.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ messages: [{ id: `wamid.${randomUUID()}` }] }), { status: 200 });
    });
    await deliver(noticeId, graph);

    const copies = await whatsappCopies(noticeId);
    expect(copies.map((copy) => copy.admissionId).sort()).toEqual([asha, bela].sort());
    expect(copies.every((copy) => copy.status === 'sent')).toBe(true);
    // A plain notice published without a selected template pins none: no revision to record.
    expect(copies.every((copy) => copy.revision === null)).toBe(true);
    expect(messages).toHaveLength(2);
    for (const message of messages) {
      expect(message.template.name).toBe('school_document');
      expect(message.template.components[0]).toMatchObject({ type: 'header', parameters: [{ type: 'document', document: { filename: 'Notice Grade 6 picnic.pdf' } }] });
      const text = Object.fromEntries(message.template.components[1]!.parameters.map((parameter) => [parameter.parameter_name, parameter.text]));
      expect(text).toMatchObject({ school_name: 'Notice Delivery School', document_name: 'school notice', reference: 'Grade 6 picnic' });
      expect(['Asha Six', 'Bela Six']).toContain(text.student_name);
    }
    // Both recipients got the very same bytes: one render, cached, reused.
    expect(uploads).toHaveLength(2);
    expect(Buffer.from(uploads[0]!).equals(Buffer.from(uploads[1]!))).toBe(true);
    expect((await PDFDocument.load(uploads[0]!)).getPageCount()).toBe(1);
    await expect(getS3Client().send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: noticePdfKey(schoolId, noticeId) }))).resolves.toMatchObject({ ContentType: 'application/pdf' });

    // Each student reads their own copy; a student of another class has none.
    const ashaInbox = await (await createCadetLogin(asha)).client.listNotifications({});
    expect(ashaInbox.items.filter((item) => (item.data as { noticeId?: string }).noticeId === noticeId)).toEqual([
      expect.objectContaining({ type: 'notice.published', data: { noticeId, sessionId, noticeTitle: 'Grade 6 picnic', admissionId: asha, studentName: 'Asha Six' } }),
    ]);
    const chetanInbox = await (await createCadetLogin(chetan)).client.listNotifications({});
    expect(chetanInbox.items.filter((item) => (item.data as { noticeId?: string }).noticeId === noticeId)).toHaveLength(0);
  });

  it('addresses every enrolled student for all classes and skips WhatsApp for one without a number', async () => {
    const noticeId = await publish({ title: 'Holiday', toStaff: false, cadetScope: 'all_classes' });
    const graph = vi.fn<ChannelFetch>(async (url) =>
      String(url).endsWith('/media')
        ? new Response(JSON.stringify({ id: 'media' }), { status: 200 })
        : new Response(JSON.stringify({ messages: [{ id: `wamid.${randomUUID()}` }] }), { status: 200 }),
    );
    await deliver(noticeId, graph);
    const copies = await whatsappCopies(noticeId);
    expect(copies).toHaveLength(3);
    expect(copies.find((copy) => copy.admissionId === chetan)).toMatchObject({ status: 'skipped', skipReason: 'no_number' });
    expect(copies.filter((copy) => copy.status === 'sent')).toHaveLength(2);
  });

  it('lists a notice\'s deliveries in the delivery log by notice, to log readers only and only with the notices feature', async () => {
    const noticeId = await publish({ title: 'Log notice', toStaff: false, cadetScope: 'selected_classes', classIds: [grade6] });
    const failing = vi.fn<ChannelFetch>(async (url) =>
      String(url).endsWith('/media')
        ? new Response(JSON.stringify({ id: 'media' }), { status: 200 })
        : new Response(JSON.stringify({ error: { code: 131026, message: 'undeliverable' } }), { status: 400 }),
    );
    await deliver(noticeId, failing);
    const scope = { kind: 'notice' as const, noticeId };
    await expect(teacher.school.listNotificationDeliveries({ schoolId, scope })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const log = await accountant.school.listNotificationDeliveries({ schoolId, scope });
    expect(log.pagination.totalItems).toBe(2);
    expect(log.items.map((item) => item.studentName).sort()).toEqual(['Asha Six', 'Bela Six']);
    for (const item of log.items) {
      expect(item).toMatchObject({ type: 'notice.published', reference: 'Log notice' });
      expect(item.deliveries.find((delivery) => delivery.channel === 'whatsapp')).toMatchObject({ status: 'failed', errorCode: 'wa_131026', resendable: true });
    }
    // Another notice's log does not contain them, nor does another school's.
    await expect(principal.school.listNotificationDeliveries({ schoolId, scope: { kind: 'notice', noticeId: 'ntc_other' } })).resolves.toMatchObject({ pagination: { totalItems: 0 } });
    await expect(principal.school.listNotificationDeliveries({ schoolId, scope, onlyFailed: true })).resolves.toMatchObject({ pagination: { totalItems: 2 } });

    // One grouped alert for the notice, to the publishers' grant only (never the accountant or the teacher).
    await sweepWhatsAppFailureAlerts();
    const alerts = (await db.select().from(notificationEventTable).where(and(eq(notificationEventTable.schoolId, schoolId), eq(notificationEventTable.type, 'notification.whatsapp_batch_failed')))).filter(
      (event) => (event.data as { noticeId?: string }).noticeId === noticeId,
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ data: { batchKind: 'notice', failedType: 'notice.published', failedCount: 2, sessionId, noticeId, noticeTitle: 'Log notice' } });
    expect((alerts[0]!.recipients as { userIds: string[] }).userIds.sort()).toEqual([principalId, managerId].sort());
    expect((alerts[0]!.recipients as { userIds: string[] }).userIds).not.toContain(accountantId);

    await setTestSchoolFeature(schoolId, 'notices', false);
    await expectFeatureDisabled(principal.school.listNotificationDeliveries({ schoolId, scope }), 'notices');
    // Other scopes of the log are unaffected by the notices feature.
    await expect(principal.school.listNotificationDeliveries({ schoolId, scope: { kind: 'admission', admissionId: asha } })).resolves.toMatchObject({ items: expect.any(Array) });
    await setTestSchoolFeature(schoolId, 'notices', true);
  });

  /**
   * Review round 1, B7: with `notices` off (or `cadet` off, for the student
   * type) nothing new goes out. Inbox rows are still written.
   */
  describe('while the school lacks a feature the notice needs', () => {
    const ok = () =>
      vi.fn<ChannelFetch>(async (url) =>
        String(url).endsWith('/media')
          ? new Response(JSON.stringify({ id: 'media' }), { status: 200 })
          : new Response(JSON.stringify({ messages: [{ id: `wamid.${randomUUID()}` }] }), { status: 200 }),
      );
    const rejecting = () =>
      vi.fn<ChannelFetch>(async (url) =>
        String(url).endsWith('/media')
          ? new Response(JSON.stringify({ id: 'media' }), { status: 200 })
          : new Response(JSON.stringify({ error: { code: 131026, message: 'undeliverable' } }), { status: 400 }),
      );

    it.each(['notices', 'cadet'] as const)('plans copies of events not fanned out yet as skipped (%s off) and still writes the inbox rows', async (feature) => {
      const noticeId = await publish({ title: `Planned while ${feature} off`, toStaff: true, cadetScope: 'selected_classes', classIds: [grade6] });
      await setTestSchoolFeature(schoolId, feature, false);
      try {
        const graph = ok();
        await deliver(noticeId, graph);
        expect(graph).not.toHaveBeenCalled();
        const copies = await whatsappCopies(noticeId);
        expect(copies).toHaveLength(2);
        expect(copies.every((copy) => copy.status === 'skipped' && copy.skipReason === 'feature_disabled')).toBe(true);
        // The inbox is the record: both students and the staff have their row.
        const rows = await db.select().from(notificationTable).where(and(eq(notificationTable.schoolId, schoolId), inArray(notificationTable.eventId, (await eventsOf(noticeId)).map((event) => event.id))));
        expect(rows.filter((row) => row.recipientKind === 'admission')).toHaveLength(2);
        expect(rows.filter((row) => row.recipientKind === 'staff_user').length).toBeGreaterThan(0);
      } finally {
        await setTestSchoolFeature(schoolId, feature, true);
      }
    });

    it.each(['notices', 'cadet'] as const)('skips a copy that was already queued when %s was switched off, without calling the provider', async (feature) => {
      const noticeId = await publish({ title: `Queued before ${feature} off`, toStaff: false, cadetScope: 'selected_classes', classIds: [grade6] });
      const whatsapp = (fetchMock: ChannelFetch) => ({ web_push: pushOff, whatsapp: createWhatsAppAdapter({ config, fetch: fetchMock }) as NotificationChannelAdapter });
      const graph = ok();
      // Fanned out while the feature is on: two copies are owed...
      for (const event of await eventsOf(noticeId)) await dispatchNow(event.id, whatsapp(graph));
      expect((await whatsappCopies(noticeId)).every((copy) => copy.status === 'owed')).toBe(true);
      // ...then the feature goes off before the sender reaches them.
      await setTestSchoolFeature(schoolId, feature, false);
      try {
        await drainSchool(schoolId, { adapters: whatsapp(graph) });
        expect(graph).not.toHaveBeenCalled();
        const copies = await whatsappCopies(noticeId);
        expect(copies.every((copy) => copy.status === 'skipped' && copy.skipReason === 'feature_disabled')).toBe(true);
      } finally {
        await setTestSchoolFeature(schoolId, feature, true);
      }
    });

    it('refuses a staff resend with the disabled-feature error and creates no event; other types are unaffected', async () => {
      const noticeId = await publish({ title: 'Resend gate', toStaff: false, cadetScope: 'selected_classes', classIds: [grade6] });
      await deliver(noticeId, rejecting());
      const [failed] = (await whatsappCopies(noticeId)).filter((copy) => copy.status === 'failed');
      expect(failed).toBeDefined();
      const resendEvents = () => db.select().from(notificationEventTable).where(and(eq(notificationEventTable.schoolId, schoolId), eq(notificationEventTable.key, `resend:${failed!.id}`)));
      for (const feature of ['notices', 'cadet'] as const) {
        await setTestSchoolFeature(schoolId, feature, false);
        try {
          await expectFeatureDisabled(principal.school.resendNotificationDelivery({ schoolId, deliveryId: failed!.id }), feature);
          expect(await resendEvents()).toHaveLength(0);
        } finally {
          await setTestSchoolFeature(schoolId, feature, true);
        }
      }
      // With both features back the same delivery is resendable.
      await expect(principal.school.resendNotificationDelivery({ schoolId, deliveryId: failed!.id })).resolves.toBeDefined();
      expect(await resendEvents()).toHaveLength(1);
    });

    it('produces no notice PDF', async () => {
      const source = createNoticeDocumentSource();
      const noticeId = await publish({ title: 'No PDF while off' });
      const request = { kind: 'notice' as const, filename: 'Notice.pdf', noticeId };
      for (const feature of ['notices', 'cadet'] as const) {
        await setTestSchoolFeature(schoolId, feature, false);
        try {
          await expect(source.produce(request, { schoolId })).resolves.toBeNull();
        } finally {
          await setTestSchoolFeature(schoolId, feature, true);
        }
      }
      await expect(source.produce(request, { schoolId })).resolves.toMatchObject({ mimeType: 'application/pdf' });
    });
  });

  it('counts a notice\'s events still being prepared from that notice\'s batch only', async () => {
    const first = await publish({ title: 'Preparing one', toStaff: false, cadetScope: 'selected_classes', classIds: [grade6] });
    const second = await publish({ title: 'Preparing two', toStaff: false, cadetScope: 'all_classes' });
    const log = (noticeId: string) => accountant.school.listNotificationDeliveries({ schoolId, scope: { kind: 'notice', noticeId } });
    // Nothing fanned out yet: each notice reports its own pending events, not the other's.
    expect((await log(first)).preparation).toEqual({ pendingCount: 2, failedCount: 0 });
    expect((await log(second)).preparation).toEqual({ pendingCount: 3, failedCount: 0 });
    for (const event of await eventsOf(first)) await dispatchNow(event.id);
    expect((await log(first)).preparation).toEqual({ pendingCount: 0, failedCount: 0 });
    expect((await log(second)).preparation).toEqual({ pendingCount: 3, failedCount: 0 });
    // The batch-scoped read uses the batch index, the others the per-school partial index.
    const indexes = await db.execute<{ indexname: string }>(sql`select indexname from pg_indexes where tablename = 'notification_event'`);
    expect(indexes.rows.map((row) => row.indexname)).toEqual(expect.arrayContaining(['notification_event_batch_idx', 'notification_event_school_unsettled_idx']));
  });

  it('produces the PDF only for a published notice of the delivery\'s own school', async () => {
    const source = createNoticeDocumentSource();
    await expect(source.available({ schoolId })).resolves.toBe(true);
    const draft = await principal.school.createNotice(body());
    const request = { kind: 'notice' as const, filename: 'Notice.pdf' };
    await expect(source.produce({ ...request, noticeId: draft.id }, { schoolId })).resolves.toBeNull();
    await expect(source.produce({ ...request, noticeId: 'ntc_missing' }, { schoolId })).resolves.toBeNull();

    // A plain notice published with a selected template records that revision as the attachment's provenance.
    const template = await principal.school.selectMarketplaceTemplate({ schoolId, documentType: 'notice', slug: 'notice-default', expectedRevisionId: null });
    const noticeId = await publish({ title: 'With template' });
    const other = await createTestSchool({ features: ['notices'] });
    await expect(source.produce({ ...request, noticeId }, { schoolId: other.id })).resolves.toBeNull();
    const document = await source.produce({ ...request, noticeId }, { schoolId });
    expect(document).toMatchObject({ mimeType: 'application/pdf', templateRevisionId: template.artifact.id });
    if (!document || document === 'template_unavailable') throw new Error('Expected a notice PDF.');
    expect(Buffer.from(document.bytes.subarray(0, 5)).toString()).toBe('%PDF-');
    // The second request returns the cached bytes.
    const again = await source.produce({ ...request, noticeId }, { schoolId });
    if (!again || again === 'template_unavailable') throw new Error('Expected a notice PDF.');
    expect(Buffer.from(again.bytes).equals(Buffer.from(document.bytes))).toBe(true);

    // A published notice whose template no longer renders can never produce a PDF (not retried forever).
    const broken = await publish({ title: 'Broken', bodyMode: 'template', body: '<p>{{notice.title}}</p>' });
    await db.update(noticeTable).set({ body: '{{unknownHelper notice.title}}' }).where(eq(noticeTable.id, broken));
    await expect(source.produce({ ...request, noticeId: broken }, { schoolId })).resolves.toBeNull();
  });
});
