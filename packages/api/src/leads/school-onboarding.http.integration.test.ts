import { GetObjectCommand } from '@aws-sdk/client-s3';
import { db } from '@campuspilot/db';
import { schoolRegistrationRequestTable } from '@campuspilot/db/schema/school-registration-request';
import { env } from '@campuspilot/env/server';
import { getRedisClient } from '@campuspilot/redis/client';
import { getS3Client } from '@campuspilot/s3/client';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { encodeAltchaSolution, solveAltchaChallenge, type AltchaChallenge } from './altcha-solver';
import { PROOF_OF_WORK_HEADER } from './demo-request';
import { handleLeadChallenge } from './lead.http';
import { SCHOOL_ONBOARDING_FIELDS, SCHOOL_ONBOARDING_PATH, type SchoolOnboardingSubmission } from './school-onboarding';
import { handleSchoolOnboardingSubmit } from './school-onboarding.http';

const deps = { db, redis: getRedisClient() };
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const WEBM = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01]);

async function solvedHeader() {
  const challenge = (await handleLeadChallenge().json()) as AltchaChallenge;
  const solution = await solveAltchaChallenge(challenge);
  if (!solution) throw new Error('unsolvable challenge');
  return encodeAltchaSolution(solution);
}

function submission(overrides: Partial<SchoolOnboardingSubmission['response']> = {}): SchoolOnboardingSubmission {
  return {
    submissionId: crypto.randomUUID(),
    sourcePath: '/onboarding',
    response: {
      schoolName: 'Green Valley School',
      phone: '+919876543210',
      email: 'office@gmail.com',
      address: '12 Station Road, Jaipur',
      classes: [
        { name: 'LKG', sections: ['A'], subjects: ['English', 'Hindi'] },
        { name: 'Class 1', sections: ['A', 'B'], subjects: ['English', 'Mathematics', 'EVS'] },
      ],
      notes: 'We start the session in April.',
      voiceNoteSeconds: null,
      ...overrides,
    },
  };
}

function post(body: unknown, header: string | null, files: { logo?: Uint8Array<ArrayBuffer>; voiceNote?: Uint8Array<ArrayBuffer> } = {}) {
  const form = new FormData();
  form.set(SCHOOL_ONBOARDING_FIELDS.submission, JSON.stringify(body));
  if (files.logo) form.set(SCHOOL_ONBOARDING_FIELDS.logo, new Blob([files.logo], { type: 'image/png' }), 'logo.png');
  if (files.voiceNote) form.set(SCHOOL_ONBOARDING_FIELDS.voiceNote, new Blob([files.voiceNote], { type: 'audio/webm' }), 'note.webm');
  const headers = new Headers({ 'user-agent': 'vitest' });
  if (header) headers.set(PROOF_OF_WORK_HEADER, header);
  return handleSchoolOnboardingSubmit(new Request(`http://api.test${SCHOOL_ONBOARDING_PATH}`, { method: 'POST', headers, body: form }), deps);
}

async function requestsWith(submissionId: string) {
  return db.select().from(schoolRegistrationRequestTable).where(eq(schoolRegistrationRequestTable.submissionId, submissionId));
}

describe('school onboarding submission', () => {
  it('saves the answers, the logo and the voice note', async () => {
    const body = submission({ voiceNoteSeconds: 42 });
    const response = await post(body, await solvedHeader(), { logo: PNG, voiceNote: WEBM });
    expect(response.status).toBe(201);
    const { requestId } = (await response.json()) as { requestId: string };
    const [row] = await requestsWith(body.submissionId);
    expect(row).toMatchObject({
      id: requestId,
      formVersion: 1,
      sourcePath: '/onboarding',
      userAgent: 'vitest',
      logoS3Key: `school-registration-requests/${requestId}/logo.png`,
      logoContentType: 'image/png',
      logoBytes: PNG.byteLength,
      voiceNoteS3Key: `school-registration-requests/${requestId}/voice-note.webm`,
      voiceNoteContentType: 'audio/webm',
      voiceNoteBytes: WEBM.byteLength,
      response: expect.objectContaining({ schoolName: 'Green Valley School', voiceNoteSeconds: 42 }),
    });
    const stored = await getS3Client().send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: row!.voiceNoteS3Key! }));
    expect(Buffer.from(await stored.Body!.transformToByteArray())).toEqual(Buffer.from(WEBM));
  });

  it('saves a request without files', async () => {
    const body = submission();
    expect((await post(body, await solvedHeader())).status).toBe(201);
    const [row] = await requestsWith(body.submissionId);
    expect(row).toMatchObject({ logoS3Key: null, voiceNoteS3Key: null });
  });

  it('returns the saved request for a retry with the same submission id, even with a spent solution', async () => {
    const body = submission();
    const header = await solvedHeader();
    const first = (await (await post(body, header)).json()) as { requestId: string };
    const retry = await post(body, header);
    expect(retry.status).toBe(201);
    expect(await retry.json()).toEqual(first);
    expect(await requestsWith(body.submissionId)).toHaveLength(1);
  });

  it('refuses a missing or spent proof-of-work', async () => {
    const body = submission();
    expect(await (await post(body, null)).json()).toMatchObject({ code: 'PROOF_OF_WORK_INVALID' });
    const header = await solvedHeader();
    expect((await post(submission(), header)).status).toBe(201);
    expect(await (await post(body, header)).json()).toMatchObject({ code: 'PROOF_OF_WORK_SPENT' });
    expect(await requestsWith(body.submissionId)).toHaveLength(0);
  });

  it('refuses a file that is not what its field accepts', async () => {
    const body = submission({ voiceNoteSeconds: 10 });
    const response = await post(body, await solvedHeader(), { logo: WEBM, voiceNote: WEBM });
    expect(response.status).toBe(415);
    expect(await requestsWith(body.submissionId)).toHaveLength(0);
  });

  it('refuses a voice note without its length, and invalid answers', async () => {
    const withoutLength = await post(submission(), await solvedHeader(), { voiceNote: WEBM });
    expect(withoutLength.status).toBe(400);
    const invalid = await post(submission({ classes: [] }), await solvedHeader());
    expect(await invalid.json()).toMatchObject({ code: 'BAD_REQUEST', issues: expect.objectContaining({ response: expect.anything() }) });
  });
});
