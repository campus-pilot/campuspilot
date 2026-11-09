import { NOTIFICATION_TYPES, notificationCatalogue } from '@campuspilot/db/notifications/catalogue';
import { requireWebPushConfigWhenEnabled, WEB_PUSH_ENV_SHAPE } from '@campuspilot/env/server/web-push.env';
import { requireWhatsAppConfigWhenEnabled, WHATSAPP_ENV_SHAPE } from '@campuspilot/env/server/whatsapp.env';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { classifyWhatsAppFailure } from './client';
import { mapWhatsAppMessage, templateParam } from './templates';

const facts = {
  'bill.issued': { billId: 'b', sessionId: 's', admissionId: 'a', billNumber: 'BILL/1', totalAmountMinor: '100', currency: 'INR', issueDate: '2026-10-05', studentName: 'Asha' },
  'payment.received': { paymentId: 'p', sessionId: 's', admissionId: 'a', receiptNumber: 'RCP/1', amountMinor: '100', currency: 'INR', receivedAt: '2026-10-05T00:00:00Z', studentName: 'Asha' },
  'exam.results_published': { sessionId: 's', examSlug: 'half-yearly', examName: 'Half-Yearly Examination 2026', admissionId: 'a', studentName: 'Asha' },
  'exam.results_publish_finished': { sessionId: 's', examSlug: 'e', examName: 'E', recipientCount: 1, sentCount: 1, failedCount: 0, skippedCount: 0 },
  'notification.whatsapp_failed': { admissionId: 'a', studentName: 'Asha', failedType: 'bill.issued' },
  'billing.run_posted': { billRunId: 'r', sessionId: 's', periodKey: '2026-10', billCount: 1 },
} as const;

const noPdf = { schoolName: 'Maple Grove', canAttach: () => false };

describe('WhatsApp template mapper', () => {
  it('maps every student type to a template and every staff type to nothing', () => {
    for (const type of NOTIFICATION_TYPES) {
      const plan = mapWhatsAppMessage(type, facts[type] as never, noPdf);
      const expectsMessage = (notificationCatalogue[type].channels as readonly string[]).includes('whatsapp');
      expect(Boolean(plan), type).toBe(expectsMessage);
    }
  });

  it('uses the document template only when the PDF can be produced', () => {
    expect(mapWhatsAppMessage('exam.results_published', facts['exam.results_published'], noPdf)).toEqual({
      template: 'school_update',
      params: { student_name: 'Asha', school_name: 'Maple Grove', update_text: 'the results of Half-Yearly Examination 2026 are now available', reference: 'Half-Yearly Examination 2026' },
    });
    const withPdf = mapWhatsAppMessage('exam.results_published', facts['exam.results_published'], { schoolName: 'Maple Grove', canAttach: (kind) => kind === 'report_card' });
    expect(withPdf).toMatchObject({
      template: 'school_document',
      params: { document_name: 'report card for Half-Yearly Examination 2026' },
      document: { kind: 'report_card', sessionId: 's', examSlug: 'half-yearly', admissionId: 'a' },
    });
  });

  it('describes manual bills by issue date', () => {
    const plan = mapWhatsAppMessage('bill.issued', facts['bill.issued'], noPdf);
    expect(plan?.params).toMatchObject({ update_text: 'a bill of ₹1.00 has been issued on 5 October 2026' });
  });

  it('flattens parameters Meta would refuse', () => {
    expect(templateParam('  Asha\n\tKumari     Singh ')).toBe('Asha Kumari Singh');
    expect(templateParam('   ')).toBe('-');
    expect(templateParam('x'.repeat(400))).toHaveLength(300);
  });
});

describe('WhatsApp failure classification', () => {
  const error = (status: number, code: number | null) => ({ error: { status, code, subcode: null } });
  it('retries throttling and outages, per recipient or for the whole number', () => {
    expect(classifyWhatsAppFailure(error(400, 131056))).toMatchObject({ kind: 'retry', scope: 'recipient', errorCode: 'wa_131056' });
    for (const code of [4, 80007, 130429, 131048, 131057, 1, 2, 131000, 131016, 133004]) {
      expect(classifyWhatsAppFailure(error(400, code)), String(code)).toMatchObject({ kind: 'retry', scope: 'channel' });
    }
    expect(classifyWhatsAppFailure(error(429, null))).toMatchObject({ kind: 'retry', errorCode: 'http_429' });
    expect(classifyWhatsAppFailure(error(503, null))).toMatchObject({ kind: 'retry', errorCode: 'http_503' });
    expect(classifyWhatsAppFailure({ error: 'network' })).toMatchObject({ kind: 'retry', errorCode: 'network_error' });
  });

  it('fails permanently on everything else', () => {
    for (const code of [100, 131026, 131030, 132000, 132001, 132015, 190]) {
      expect(classifyWhatsAppFailure(error(400, code)), String(code)).toEqual({ kind: 'failed', errorCode: `wa_${code}` });
    }
  });
});

describe('channel environment', () => {
  const parse = (shape: Record<string, z.ZodType>, refine: (value: never, context: z.RefinementCtx) => void, input: Record<string, string>) =>
    z.object(shape).superRefine(refine as never).safeParse(input);

  it('keeps both channels off by default and needs no secrets while off', () => {
    const whatsapp = parse(WHATSAPP_ENV_SHAPE, requireWhatsAppConfigWhenEnabled, {});
    expect(whatsapp.success && whatsapp.data.WHATSAPP_ENABLED).toBe(false);
    const push = parse(WEB_PUSH_ENV_SHAPE, requireWebPushConfigWhenEnabled, {});
    expect(push.success && push.data.WEB_PUSH_ENABLED).toBe(false);
  });

  it('requires every value once a channel is enabled', () => {
    const whatsapp = parse(WHATSAPP_ENV_SHAPE, requireWhatsAppConfigWhenEnabled, { WHATSAPP_ENABLED: 'true', WHATSAPP_ACCESS_TOKEN: 'x'.repeat(30) });
    expect(whatsapp.success).toBe(false);
    expect(whatsapp.error!.issues.map((issue) => issue.path[0]).sort()).toEqual([
      'WHATSAPP_APP_SECRET',
      'WHATSAPP_BUSINESS_ACCOUNT_ID',
      'WHATSAPP_GRAPH_API_VERSION',
      'WHATSAPP_PHONE_NUMBER_ID',
      'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
    ]);
    const push = parse(WEB_PUSH_ENV_SHAPE, requireWebPushConfigWhenEnabled, { WEB_PUSH_ENABLED: 'true' });
    expect(push.success).toBe(false);
  });
});
