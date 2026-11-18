import { db } from '@campuspilot/db';
import { leadTable } from '@campuspilot/db/schema/lead';
import { getRedisClient } from '@campuspilot/redis/client';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { encodeAltchaSolution, solveAltchaChallenge, type AltchaChallenge } from './altcha-solver';
import { DEMO_REQUEST_PATH, PROOF_OF_WORK_HEADER, type DemoRequestSubmission } from './demo-request';
import { handleDemoRequestSubmit, handleLeadChallenge } from './lead.http';
import { dispatchLeadAlert } from './lead.outbox';

const deps = { db, redis: getRedisClient() };

async function solvedHeader() {
  const challenge = (await handleLeadChallenge().json()) as AltchaChallenge;
  const solution = await solveAltchaChallenge(challenge);
  if (!solution) throw new Error('unsolvable challenge');
  return encodeAltchaSolution(solution);
}

function submission(overrides: Partial<DemoRequestSubmission['response']> = {}): DemoRequestSubmission {
  return {
    submissionId: crypto.randomUUID(),
    sourcePath: '/book-demo',
    response: {
      name: 'Asha Verma',
      phone: '+919876543210',
      hasWhatsAppOnPhone: true,
      whatsappNumber: null,
      email: 'asha@example.com',
      preferredContact: 'whatsapp',
      schoolName: 'Green Valley School',
      approxStudents: 450,
      approxStaff: 30,
      ...overrides,
    },
  };
}

function post(body: unknown, header: string | null) {
  const headers = new Headers({ 'content-type': 'application/json', 'user-agent': 'vitest' });
  if (header) headers.set(PROOF_OF_WORK_HEADER, header);
  return handleDemoRequestSubmit(new Request(`http://api.test${DEMO_REQUEST_PATH}`, { method: 'POST', headers, body: JSON.stringify(body) }), deps);
}

async function leadsWith(submissionId: string) {
  return db.select().from(leadTable).where(eq(leadTable.submissionId, submissionId));
}

describe('demo request submission', () => {
  it('saves the lead with the WhatsApp number filled in and a pending alert', async () => {
    const body = submission();
    const response = await post(body, await solvedHeader());
    expect(response.status).toBe(201);
    const { leadId } = (await response.json()) as { leadId: string };
    const [lead] = await leadsWith(body.submissionId);
    expect(lead).toMatchObject({
      id: leadId,
      form: 'book_demo',
      formVersion: 1,
      sourcePath: '/book-demo',
      userAgent: 'vitest',
      alertStatus: 'pending',
      response: expect.objectContaining({ phone: '+919876543210', whatsappNumber: '+919876543210', preferredContact: 'whatsapp' }),
    });
  });

  it('returns the saved lead for a retry with the same submission id, even with a spent solution', async () => {
    const body = submission();
    const header = await solvedHeader();
    const first = (await (await post(body, header)).json()) as { leadId: string };
    const retry = await post(body, header);
    expect(retry.status).toBe(201);
    expect(await retry.json()).toEqual(first);
    expect(await leadsWith(body.submissionId)).toHaveLength(1);
  });

  it('refuses a spent solution for a different submission', async () => {
    const header = await solvedHeader();
    expect((await post(submission(), header)).status).toBe(201);
    const second = submission();
    const response = await post(second, header);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'PROOF_OF_WORK_SPENT' });
    expect(await leadsWith(second.submissionId)).toHaveLength(0);
  });

  it('refuses a request without a valid proof-of-work', async () => {
    const body = submission();
    const missing = await post(body, null);
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ code: 'PROOF_OF_WORK_INVALID' });
    expect((await post(body, btoa('{}'))).status).toBe(400);
    expect(await leadsWith(body.submissionId)).toHaveLength(0);
  });

  it('refuses invalid answers with field issues', async () => {
    const body = submission({ name: '', hasWhatsAppOnPhone: false, whatsappNumber: null, preferredContact: 'whatsapp' });
    const response = await post(body, await solvedHeader());
    expect(response.status).toBe(400);
    const json = (await response.json()) as { code: string; issues: Record<string, unknown> };
    expect(json.code).toBe('BAD_REQUEST');
    expect(Object.keys(json.issues)).toContain('response');
  });

  it('keeps the lead pending and records why when Restate cannot take the alert', async () => {
    const body = submission();
    const { leadId } = (await (await post(body, await solvedHeader())).json()) as { leadId: string };
    // Tests run without Restate and without WORKER_CONTROL_SECRET: the hand-over fails, the lead stays.
    expect(await dispatchLeadAlert(db, leadId)).toBe(false);
    const [lead] = await leadsWith(body.submissionId);
    expect(lead).toMatchObject({ alertStatus: 'pending', alertHandedOverAt: null });
    expect(lead!.alertHandoverAttempts).toBeGreaterThanOrEqual(1);
    expect(lead!.alertLastHandoverError).toEqual(expect.any(String));
  });
});
