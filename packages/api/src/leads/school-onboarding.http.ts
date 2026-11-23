import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { Database } from '@campuspilot/db';
import { generateId } from '@campuspilot/db/id';
import { schoolRegistrationRequestTable } from '@campuspilot/db/schema/school-registration-request';
import { env } from '@campuspilot/env/server';
import type { getRedisClient } from '@campuspilot/redis/client';
import { createLogger } from '@campuspilot/logger';
import { getS3Client } from '@campuspilot/s3/client';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { PROOF_OF_WORK_HEADER } from './demo-request';
import { claimAltchaSolution, verifyAltchaSolution } from './proof-of-work';
import { SCHOOL_ONBOARDING_FORM_VERSION, schoolOnboardingSubmissionSchema } from './school-onboarding';
import {
  MAX_SCHOOL_ONBOARDING_BODY_BYTES,
  OnboardingUploadError,
  parseSchoolOnboardingUpload,
  type OnboardingFile,
} from './school-onboarding.upload';

/**
 * The public School Onboarding route (no session), gated like the demo
 * request form: the browser solves the lead proof-of-work challenge and
 * sends the solution in the `x-altcha` header, and the route is rate limited
 * per IP (`apps/server/src/http.ts`). Nothing is scheduled after the save;
 * platform admins read requests in the admin app.
 */

/** Never log names, phone numbers or answers, only request ids and outcomes. */
const log = createLogger({ pkg: 'school-onboarding' });

const MAX_USER_AGENT_LENGTH = 300;

type SchoolOnboardingHttpDeps = { db: Database; redis: ReturnType<typeof getRedisClient> };

function errorResponse(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return Response.json({ code, message, ...extra }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Private S3 key of one of a request's files; the extension comes from the sniffed format. */
function objectKey(requestId: string, name: 'logo' | 'voice-note', file: OnboardingFile) {
  return `school-registration-requests/${requestId}/${name}.${file.extension}`;
}

async function putObject(key: string, file: OnboardingFile) {
  await getS3Client().send(
    new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: file.bytes, ContentLength: file.bytes.byteLength, ContentType: file.contentType }),
  );
}

/** Removes objects no row will ever name (a concurrent retry won the insert); failures are only logged. */
function discardObjects(keys: string[]) {
  for (const key of keys) {
    void getS3Client()
      .send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }))
      .catch((error: unknown) => log.warn({ key, err: error instanceof Error ? error.message : String(error) }, 'school-onboarding.discard.failed'));
  }
}

/**
 * `POST /public/leads/school-onboarding` (multipart). In order:
 * 1. the proof-of-work must verify, else 400 `PROOF_OF_WORK_INVALID`;
 * 2. a declared body over {@link MAX_SCHOOL_ONBOARDING_BODY_BYTES} is 413
 *    before anything is read;
 * 3. the body must parse (`school-onboarding.upload.ts`: answers JSON, at
 *    most one logo and one voice note, each within its cap and recognised
 *    by its bytes), else 400/413/415;
 * 4. the answers must match the form, else 400 `BAD_REQUEST` with issues;
 *    a voice note and its reported length must come together;
 * 5. a submission id already saved returns that request (201), so a retry
 *    after a lost response never creates a second one;
 * 6. the solution is spent (Redis), else 400 `PROOF_OF_WORK_SPENT`;
 * 7. the files are written to S3 under a fresh request id, then the row is
 *    inserted. If a concurrent retry inserted first, this try's objects
 *    are discarded and the saved request returned.
 */
export async function handleSchoolOnboardingSubmit(request: Request, deps: SchoolOnboardingHttpDeps): Promise<Response> {
  const verdict = verifyAltchaSolution(request.headers.get(PROOF_OF_WORK_HEADER));
  if (!verdict.ok) {
    log.info({ reason: verdict.reason }, 'school-onboarding.proof-of-work.refused');
    return errorResponse(400, 'PROOF_OF_WORK_INVALID', 'The security check did not pass. Reload the page and try again.');
  }
  if (Number(request.headers.get('content-length') ?? '0') > MAX_SCHOOL_ONBOARDING_BODY_BYTES) {
    return errorResponse(413, 'PAYLOAD_TOO_LARGE', 'The request is too large.');
  }

  let upload: Awaited<ReturnType<typeof parseSchoolOnboardingUpload>>;
  try {
    upload = await parseSchoolOnboardingUpload(request);
  } catch (error) {
    if (error instanceof OnboardingUploadError) return errorResponse(error.status, error.code, error.message);
    throw error;
  }

  const parsed = schoolOnboardingSubmissionSchema.safeParse(upload.submission);
  if (!parsed.success) {
    return errorResponse(400, 'BAD_REQUEST', 'Some answers are not valid.', { issues: z.flattenError(parsed.error).fieldErrors });
  }
  const submission = parsed.data;
  if ((upload.voiceNote === null) !== (submission.response.voiceNoteSeconds === null)) {
    return errorResponse(400, 'BAD_REQUEST', 'A voice note and its length must be sent together.');
  }

  const findExisting = async () => {
    const [existing] = await deps.db
      .select({ id: schoolRegistrationRequestTable.id })
      .from(schoolRegistrationRequestTable)
      .where(eq(schoolRegistrationRequestTable.submissionId, submission.submissionId))
      .limit(1);
    return existing ?? null;
  };
  const existing = await findExisting();
  if (existing) return Response.json({ requestId: existing.id }, { status: 201 });

  if (!(await claimAltchaSolution(deps.redis, verdict))) {
    return errorResponse(400, 'PROOF_OF_WORK_SPENT', 'The security check was already used. Try again.');
  }

  const requestId = generateId('schoolRegistrationRequest');
  const logoKey = upload.logo ? objectKey(requestId, 'logo', upload.logo) : null;
  const voiceNoteKey = upload.voiceNote ? objectKey(requestId, 'voice-note', upload.voiceNote) : null;
  await Promise.all([
    logoKey && upload.logo ? putObject(logoKey, upload.logo) : null,
    voiceNoteKey && upload.voiceNote ? putObject(voiceNoteKey, upload.voiceNote) : null,
  ]);

  const [inserted] = await deps.db
    .insert(schoolRegistrationRequestTable)
    .values({
      id: requestId,
      formVersion: SCHOOL_ONBOARDING_FORM_VERSION,
      submissionId: submission.submissionId,
      response: submission.response,
      logoS3Key: logoKey,
      logoContentType: upload.logo?.contentType ?? null,
      logoBytes: upload.logo?.bytes.byteLength ?? null,
      voiceNoteS3Key: voiceNoteKey,
      voiceNoteContentType: upload.voiceNote?.contentType ?? null,
      voiceNoteBytes: upload.voiceNote?.bytes.byteLength ?? null,
      sourcePath: submission.sourcePath ?? null,
      userAgent: request.headers.get('user-agent')?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
    })
    .onConflictDoNothing({ target: schoolRegistrationRequestTable.submissionId })
    .returning({ id: schoolRegistrationRequestTable.id });
  if (!inserted) {
    discardObjects([logoKey, voiceNoteKey].filter((key): key is string => key !== null));
    const winner = await findExisting();
    if (!winner) throw new Error('The school registration request was neither inserted nor found.');
    return Response.json({ requestId: winner.id }, { status: 201 });
  }
  log.info({ requestId, logo: logoKey !== null, voiceNote: voiceNoteKey !== null }, 'school-onboarding.created');
  return Response.json({ requestId }, { status: 201 });
}
