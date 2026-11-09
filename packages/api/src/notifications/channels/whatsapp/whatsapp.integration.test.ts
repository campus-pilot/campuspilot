import { db } from '@campuspilot/db';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { notificationDeliveryTable, notificationTable } from '@campuspilot/db/schema/notification';
import type { NotificationType } from '@campuspilot/db/notifications/catalogue';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { createTestAdmission, createTestSchool } from '../../../../test/fixtures';
import { billIssuedData } from '../../../../test/notifications';
import { MAX_SEND_ROUNDS, runNotificationDispatch, type NotificationStepRunner } from '../../dispatch';
import { notify, type NotifyInput } from '../../notify';
import type { ChannelFetch, NotificationChannelAdapter } from '../types';
import { createWhatsAppAdapter } from './adapter';
import type { WhatsAppDocumentSources } from './documents';

const config = { accessToken: 'test-token-0123456789', phoneNumberId: '1234567890', graphApiVersion: 'v24.0', graphBaseUrl: 'https://graph.test' };
const pushOff = { channel: 'web_push', available: false, unavailableReason: 'test' } as const;
const noDocuments: WhatsAppDocumentSources = { payment_receipt: null, report_card: null };

type Contact = { whatsappNo: string | null; whatsappVerified: boolean; whatsappConsent: boolean };
const reachable: Contact = { whatsappNo: '+919876543210', whatsappVerified: true, whatsappConsent: true };

async function student(schoolId: string, contact: Contact = reachable, name = 'Meera Singh') {
  const admission = await createTestAdmission({ schoolId, name });
  await db.update(admissionTable).set(contact).where(eq(admissionTable.id, admission.id));
  return admission;
}

function sent(id = `wamid.${randomUUID()}`) {
  return new Response(JSON.stringify({ messaging_product: 'whatsapp', messages: [{ id }] }), { status: 200 });
}
function graphError(status: number, code: number) {
  return new Response(JSON.stringify({ error: { message: 'x', type: 'OAuthException', code, fbtrace_id: 't' } }), { status });
}

async function dispatch<T extends NotificationType>(
  input: Omit<NotifyInput<T>, 'key'>,
  fetchMock: ChannelFetch,
  options: { documentSources?: WhatsAppDocumentSources; step?: NotificationStepRunner } = {},
) {
  const whatsapp = createWhatsAppAdapter({ config, fetch: fetchMock, documentSources: options.documentSources ?? noDocuments }) as NotificationChannelAdapter;
  const { eventId } = await db.transaction((tx) => notify(tx, { ...input, key: `wa:${randomUUID()}` } as NotifyInput<T>));
  const sleep = vi.fn(async (_name: string, _ms: number) => undefined);
  await runNotificationDispatch({ eventId, step: options.step ?? ((_name, action) => action()), sleep, adapters: { web_push: pushOff, whatsapp } });
  const notifications = await db.select().from(notificationTable).where(eq(notificationTable.eventId, eventId));
  const deliveries = await db
    .select()
    .from(notificationDeliveryTable)
    .where(inArray(notificationDeliveryTable.notificationId, notifications.map((row) => row.id)));
  const byAdmission = new Map(notifications.map((row) => [row.admissionId!, deliveries.find((d) => d.notificationId === row.id && d.channel === 'whatsapp')!]));
  return { sleep, byAdmission };
}

function bill(schoolId: string, admissionIds: string[]) {
  return {
    type: 'bill.issued' as const,
    data: billIssuedData(admissionIds[0]!, { billNumber: 'BILL/2026-27/000042' }),
    schoolId,
    recipients: { kind: 'admissions' as const, admissionIds },
  };
}

function requestBody(call: Parameters<ChannelFetch>) {
  return JSON.parse(call[1].body as string);
}

describe('WhatsApp channel', () => {
  it('sends only to verified, consenting numbers and records why others were skipped', async () => {
    const school = await createTestSchool({ name: 'Maple Grove School' });
    const ok = await student(school.id);
    const noNumber = await student(school.id, { whatsappNo: null, whatsappVerified: false, whatsappConsent: true });
    const unverified = await student(school.id, { ...reachable, whatsappNo: '+919876543211', whatsappVerified: false });
    const noConsent = await student(school.id, { ...reachable, whatsappNo: '+919876543212', whatsappConsent: false });
    const fetchMock = vi.fn<ChannelFetch>(async () => sent('wamid.ok'));
    const { byAdmission } = await dispatch(bill(school.id, [ok.id, noNumber.id, unverified.id, noConsent.id]), fetchMock);

    expect(byAdmission.get(ok.id)).toMatchObject({ status: 'sent', providerMessageId: 'wamid.ok', destination: '+919876543210' });
    expect(byAdmission.get(noNumber.id)).toMatchObject({ status: 'skipped', skipReason: 'no_number' });
    expect(byAdmission.get(unverified.id)).toMatchObject({ status: 'skipped', skipReason: 'not_verified' });
    expect(byAdmission.get(noConsent.id)).toMatchObject({ status: 'skipped', skipReason: 'no_consent' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://graph.test/v24.0/1234567890/messages');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token-0123456789');
    expect(requestBody(fetchMock.mock.calls[0]!)).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919876543210',
      type: 'template',
      template: {
        name: 'school_update',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', parameter_name: 'student_name', text: 'Test Student' },
              { type: 'text', parameter_name: 'school_name', text: 'Maple Grove School' },
              { type: 'text', parameter_name: 'update_text', text: 'a bill of ₹2,500.00 has been issued for October 2026' },
              { type: 'text', parameter_name: 'reference', text: 'BILL/2026-27/000042' },
            ],
          },
        ],
      },
    });
  });

  it('sends a receipt as text while no receipt PDF exists, and as a document once a source produces one', async () => {
    const school = await createTestSchool();
    const admission = await student(school.id);
    const payment = {
      type: 'payment.received' as const,
      data: { paymentId: 'fpay_1', sessionId: 'sess_1', admissionId: admission.id, receiptNumber: 'RCP/2026-27/000001', amountMinor: '250000', currency: 'INR', receivedAt: '2026-11-09T10:00:00.000Z', studentName: 'Meera Singh' },
      schoolId: school.id,
      recipients: { kind: 'admissions' as const, admissionIds: [admission.id] },
    };
    const textOnly = vi.fn<ChannelFetch>(async () => sent());
    await dispatch(payment, textOnly);
    expect(requestBody(textOnly.mock.calls[0]!).template.name).toBe('school_update');

    const receipt = vi.fn(async () => ({ bytes: new TextEncoder().encode('%PDF-1.7 test'), mimeType: 'application/pdf' as const }));
    const withPdf = vi
      .fn<ChannelFetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'media-1' }), { status: 200 }))
      .mockResolvedValueOnce(sent('wamid.doc'));
    const { byAdmission } = await dispatch(payment, withPdf, { documentSources: { payment_receipt: receipt, report_card: null } });
    expect(receipt).toHaveBeenCalledWith(expect.objectContaining({ kind: 'payment_receipt', paymentId: 'fpay_1', admissionId: admission.id }), { schoolId: school.id });
    const [uploadUrl, uploadInit] = withPdf.mock.calls[0]!;
    expect(uploadUrl).toBe('https://graph.test/v24.0/1234567890/media');
    const form = uploadInit.body as FormData;
    expect(form.get('messaging_product')).toBe('whatsapp');
    expect((form.get('file') as File).name).toBe('Receipt RCP-2026-27-000001.pdf');
    const message = requestBody(withPdf.mock.calls[1]!);
    expect(message.template.name).toBe('school_document');
    expect(message.template.components[0]).toEqual({ type: 'header', parameters: [{ type: 'document', document: { id: 'media-1', filename: 'Receipt RCP-2026-27-000001.pdf' } }] });
    expect(message.template.components[1].parameters.find((p: { parameter_name: string }) => p.parameter_name === 'document_name').text).toBe('payment receipt for ₹2,500.00');
    expect(byAdmission.get(admission.id)).toMatchObject({ status: 'sent', providerMessageId: 'wamid.doc' });
  });

  it('re-checks consent and the number right before sending', async () => {
    const school = await createTestSchool();
    const stopped = await student(school.id);
    const renumbered = await student(school.id, { ...reachable, whatsappNo: '+919876543299' });
    const fetchMock = vi.fn<ChannelFetch>(async () => sent());
    // Between fan-out and send: a STOP reply and a staff edit of the number.
    let changed = false;
    const step: NotificationStepRunner = async (name, action) => {
      if (name.startsWith('send:') && !changed) {
        changed = true;
        await db.update(admissionTable).set({ whatsappConsent: false }).where(eq(admissionTable.id, stopped.id));
        await db.update(admissionTable).set({ whatsappNo: '+919876543200' }).where(eq(admissionTable.id, renumbered.id));
      }
      return action();
    };
    const { byAdmission } = await dispatch(bill(school.id, [stopped.id, renumbered.id]), fetchMock, { step });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(byAdmission.get(stopped.id)).toMatchObject({ status: 'skipped', skipReason: 'no_consent' });
    expect(byAdmission.get(renumbered.id)).toMatchObject({ status: 'failed', errorCode: 'number_changed' });
  });

  it('retries a pair rate limit (131056) for that recipient only while the others go out', async () => {
    const school = await createTestSchool();
    const first = await student(school.id, { ...reachable, whatsappNo: '+919800000001' });
    const second = await student(school.id, { ...reachable, whatsappNo: '+919800000002' });
    const attemptsTo = new Map<string, number>();
    const fetchMock = vi.fn<ChannelFetch>(async (_url, init) => {
      const to: string = JSON.parse(init.body as string).to;
      const attempt = (attemptsTo.get(to) ?? 0) + 1;
      attemptsTo.set(to, attempt);
      return to === '919800000001' && attempt === 1 ? graphError(400, 131056) : sent();
    });
    const { byAdmission, sleep } = await dispatch(bill(school.id, [first.id, second.id]), fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0]![1]).toBe(60_000);
    expect(byAdmission.get(first.id)).toMatchObject({ status: 'sent', attempts: 2 });
    expect(byAdmission.get(second.id)).toMatchObject({ status: 'sent', attempts: 1 });
  });

  it('defers the rest of the round on a throughput limit (130429) instead of sending into it', async () => {
    const school = await createTestSchool();
    const admissions = await Promise.all([1, 2, 3].map((n) => student(school.id, { ...reachable, whatsappNo: `+91980000010${n}` })));
    const fetchMock = vi.fn<ChannelFetch>().mockResolvedValueOnce(graphError(400, 130429)).mockImplementation(async () => sent());
    const { byAdmission, sleep } = await dispatch(bill(school.id, admissions.map((a) => a.id)), fetchMock);
    // Round 1: one call, limited; round 2: all three.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(1);
    for (const admission of admissions) expect(byAdmission.get(admission.id)!.status).toBe('sent');
    expect(admissions.map((a) => byAdmission.get(a.id)!.attempts).sort()).toEqual([1, 1, 2]);
  });

  it('fails at once on a permanent error and after the bounded rounds on persistent 5xx', async () => {
    const school = await createTestSchool();
    const permanent = await student(school.id);
    const missingTemplate = vi.fn<ChannelFetch>(async () => graphError(404, 132001));
    const first = await dispatch(bill(school.id, [permanent.id]), missingTemplate);
    expect(first.byAdmission.get(permanent.id)).toMatchObject({ status: 'failed', errorCode: 'wa_132001', attempts: 1 });
    expect(first.sleep).not.toHaveBeenCalled();

    const outage = vi.fn<ChannelFetch>(async () => new Response('bad gateway', { status: 502 }));
    const second = await dispatch(bill(school.id, [permanent.id]), outage);
    expect(outage).toHaveBeenCalledTimes(MAX_SEND_ROUNDS);
    expect(second.sleep.mock.calls.map(([, ms]) => ms)).toEqual([60_000, 240_000, 960_000, 3_840_000, 15_360_000, 21_600_000, 21_600_000]);
    expect(second.byAdmission.get(permanent.id)).toMatchObject({ status: 'failed', errorCode: 'http_502', attempts: MAX_SEND_ROUNDS });
  });
});
