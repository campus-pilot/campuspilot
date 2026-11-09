import { db } from '@campuspilot/db';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { notificationDeliveryTable, notificationTable } from '@campuspilot/db/schema/notification';
import { and, eq } from 'drizzle-orm';
import { createHmac, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { createTestAdmission, createTestSchool } from '../../../../test/fixtures';
import { billIssuedData, emitAndDispatch } from '../../../../test/notifications';
import {
  handleWhatsAppWebhook,
  handleWhatsAppWebhookVerification,
  verifyWhatsAppSignature,
  WHATSAPP_WEBHOOK_MAX_BYTES,
  type WhatsAppWebhookConfig,
} from './webhook';

const config: WhatsAppWebhookConfig = { appSecret: 'test-app-secret-0123456789', verifyToken: 'verify-token-0123456789', phoneNumberId: '1234567890' };

function sign(body: string, secret = config.appSecret) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function post(payload: unknown, signature?: string) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return handleWhatsAppWebhook(
    new Request('http://localhost/webhooks/whatsapp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(signature === undefined ? { 'x-hub-signature-256': sign(body) } : signature ? { 'x-hub-signature-256': signature } : {}) },
      body,
    }),
    config,
    db,
  );
}

function callback(value: Record<string, unknown>, phoneNumberId = config.phoneNumberId!) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'waba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '15550000000', phone_number_id: phoneNumberId }, ...value } }] }],
  };
}

function status(id: string, value: string, timestamp: number, errors?: Array<{ code: number }>) {
  return { id, status: value, timestamp: String(timestamp), recipient_id: '919876543210', ...(errors ? { errors } : {}) };
}

/** A WhatsApp delivery turned into a sent one with a known wamid (the channel is off in tests). */
async function sentDelivery() {
  const school = await createTestSchool();
  const admission = await createTestAdmission({ schoolId: school.id });
  const { eventId } = await emitAndDispatch({ type: 'bill.issued', data: billIssuedData(admission.id), schoolId: school.id, recipients: { kind: 'admissions', admissionIds: [admission.id] } });
  const [notification] = await db.select().from(notificationTable).where(eq(notificationTable.eventId, eventId));
  const wamid = `wamid.${randomUUID()}`;
  const [delivery] = await db
    .update(notificationDeliveryTable)
    .set({ status: 'sent', skipReason: null, providerMessageId: wamid, sentAt: new Date(1_000_000) })
    .where(and(eq(notificationDeliveryTable.notificationId, notification!.id), eq(notificationDeliveryTable.channel, 'whatsapp')))
    .returning();
  const read = async () => (await db.select().from(notificationDeliveryTable).where(eq(notificationDeliveryTable.id, delivery!.id)))[0]!;
  return { wamid, read };
}

describe('WhatsApp webhook', () => {
  it('answers Meta’s subscription check only with the right verify token', async () => {
    const ok = handleWhatsAppWebhookVerification(config, new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': config.verifyToken, 'hub.challenge': '12345' }));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('12345');
    expect(handleWhatsAppWebhookVerification(config, new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '1' })).status).toBe(403);
    expect(handleWhatsAppWebhookVerification(null, new URLSearchParams()).status).toBe(404);
  });

  it('verifies X-Hub-Signature-256 over the raw body', async () => {
    const body = JSON.stringify(callback({}));
    expect(verifyWhatsAppSignature(new TextEncoder().encode(body), sign(body), config.appSecret)).toBe(true);
    expect(verifyWhatsAppSignature(new TextEncoder().encode(`${body} `), sign(body), config.appSecret)).toBe(false);
    expect(verifyWhatsAppSignature(new TextEncoder().encode(body), sign(body, 'another-secret-0123456789'), config.appSecret)).toBe(false);
    expect(verifyWhatsAppSignature(new TextEncoder().encode(body), null, config.appSecret)).toBe(false);
    expect(verifyWhatsAppSignature(new TextEncoder().encode(body), 'sha256=zz', config.appSecret)).toBe(false);

    expect((await post(callback({}), 'sha256=' + '0'.repeat(64))).status).toBe(401);
    expect((await post(callback({}), '')).status).toBe(401);
    expect((await post(callback({}))).status).toBe(200);
    expect((await handleWhatsAppWebhook(new Request('http://localhost/', { method: 'POST', body: '{}' }), null, db)).status).toBe(404);
    expect((await post('x'.repeat(WHATSAPP_WEBHOOK_MAX_BYTES + 1))).status).toBe(413);
  });

  it('moves delivery status forward only (sent → delivered → read), whatever the arrival order', async () => {
    const { wamid, read } = await sentDelivery();
    await post(callback({ statuses: [status(wamid, 'read', 2_000)] }));
    expect(await read()).toMatchObject({ status: 'read', readAt: new Date(2_000_000), deliveredAt: new Date(2_000_000) });
    // Late and repeated receipts change nothing.
    await post(callback({ statuses: [status(wamid, 'delivered', 1_500), status(wamid, 'sent', 1_200), status(wamid, 'failed', 1_600, [{ code: 131026 }])] }));
    expect(await read()).toMatchObject({ status: 'read', deliveredAt: new Date(2_000_000), errorCode: null });
  });

  it('records an asynchronous failure with its error code, but never after delivery', async () => {
    const failing = await sentDelivery();
    await post(callback({ statuses: [status(failing.wamid, 'failed', 3_000, [{ code: 131026 }])] }));
    expect(await failing.read()).toMatchObject({ status: 'failed', errorCode: 'wa_131026', failedAt: new Date(3_000_000) });

    const delivered = await sentDelivery();
    await post(callback({ statuses: [status(delivered.wamid, 'delivered', 3_000)] }));
    await post(callback({ statuses: [status(delivered.wamid, 'failed', 3_100, [{ code: 131000 }])] }));
    expect(await delivered.read()).toMatchObject({ status: 'delivered' });
  });

  it('ignores callbacks for another phone number on the same app', async () => {
    const { wamid, read } = await sentDelivery();
    await post(callback({ statuses: [status(wamid, 'delivered', 2_000)] }, '999999'));
    expect((await read()).status).toBe('sent');
  });

  it('withdraws WhatsApp consent of every admission with the sender’s number on STOP', async () => {
    const number = `+9198${String(Date.now()).slice(-8)}`;
    const [schoolA, schoolB] = await Promise.all([createTestSchool(), createTestSchool()]);
    const siblings = await Promise.all([createTestAdmission({ schoolId: schoolA.id }), createTestAdmission({ schoolId: schoolA.id }), createTestAdmission({ schoolId: schoolB.id })]);
    const other = await createTestAdmission({ schoolId: schoolA.id });
    for (const admission of siblings) {
      await db.update(admissionTable).set({ whatsappNo: number, whatsappVerified: true, whatsappConsent: true }).where(eq(admissionTable.id, admission.id));
    }
    await db.update(admissionTable).set({ whatsappNo: '+919811111111', whatsappVerified: true, whatsappConsent: true }).where(eq(admissionTable.id, other.id));
    const from = number.slice(1);

    // Any other text changes nothing.
    await post(callback({ messages: [{ from, id: 'wamid.in1', timestamp: '1', type: 'text', text: { body: 'Thank you' } }] }));
    const consentOf = async (id: string) => (await db.select({ c: admissionTable.whatsappConsent }).from(admissionTable).where(eq(admissionTable.id, id)))[0]!.c;
    expect(await consentOf(siblings[0]!.id)).toBe(true);

    const response = await post(callback({ messages: [{ from, id: 'wamid.in2', timestamp: '2', type: 'text', text: { body: '  stop ' } }] }));
    expect(response.status).toBe(200);
    for (const admission of siblings) expect(await consentOf(admission.id)).toBe(false);
    expect(await consentOf(other.id)).toBe(true);
    // Verification is a separate fact and stays.
    const [row] = await db.select().from(admissionTable).where(eq(admissionTable.id, siblings[0]!.id));
    expect(row!.whatsappVerified).toBe(true);
  });
});
