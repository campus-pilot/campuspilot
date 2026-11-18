import type { Database } from '@campuspilot/db';
import { leadTable } from '@campuspilot/db/schema/lead';
import type { getRedisClient } from '@campuspilot/redis/client';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { log } from '../workflows/lead-alert/log';
import { DEMO_REQUEST_FORM, DEMO_REQUEST_FORM_VERSION, PROOF_OF_WORK_HEADER, demoRequestSubmissionSchema } from './demo-request';
import { handOffLeadAlert } from './lead.outbox';
import { claimAltchaSolution, createAltchaChallenge, verifyAltchaSolution } from './proof-of-work';

/**
 * The public lead routes (no session): the website fetches a proof-of-work
 * challenge, solves it in the browser and submits the demo request with the
 * solution in the `x-altcha` header. The submission's only synchronous work
 * is the database insert; the WhatsApp alert is scheduled after commit and
 * can never fail the request.
 */

/** Largest accepted request body; the form's answers are a few hundred bytes. */
const MAX_BODY_BYTES = 16 * 1024;
const MAX_USER_AGENT_LENGTH = 300;

type LeadHttpDeps = { db: Database; redis: ReturnType<typeof getRedisClient> };

function errorResponse(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return Response.json({ code, message, ...extra }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** `GET /public/leads/challenge`: a fresh, signed challenge. Never cached. */
export function handleLeadChallenge(): Response {
  return Response.json(createAltchaChallenge(), { headers: { 'Cache-Control': 'no-store' } });
}

async function readJsonBody(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return { ok: false, response: errorResponse(413, 'PAYLOAD_TOO_LARGE', 'The request is too large.') };
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return { ok: false, response: errorResponse(413, 'PAYLOAD_TOO_LARGE', 'The request is too large.') };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, response: errorResponse(400, 'BAD_REQUEST', 'The request body is not JSON.') };
  }
}

/**
 * `POST /public/leads/demo-request`. In order:
 * 1. the proof-of-work must verify (signed by this server, solved, not
 *    expired), else 400 `PROOF_OF_WORK_INVALID`;
 * 2. the body must match the form ({@link demoRequestSubmissionSchema}),
 *    else 400 `BAD_REQUEST` with the field issues;
 * 3. a submission id already saved returns that lead (201): the browser
 *    retries with the same id after a lost response, so a retry never
 *    creates a second lead and never fails because its solution was spent;
 * 4. the solution is spent (Redis), else 400 `PROOF_OF_WORK_SPENT`;
 * 5. the lead is inserted, and only then the alert is scheduled in the
 *    background.
 */
export async function handleDemoRequestSubmit(request: Request, deps: LeadHttpDeps): Promise<Response> {
  const verdict = verifyAltchaSolution(request.headers.get(PROOF_OF_WORK_HEADER));
  if (!verdict.ok) {
    log.info({ reason: verdict.reason }, 'lead.proof-of-work.refused');
    return errorResponse(400, 'PROOF_OF_WORK_INVALID', 'The security check did not pass. Reload the page and try again.');
  }
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = demoRequestSubmissionSchema.safeParse(body.value);
  if (!parsed.success) {
    return errorResponse(400, 'BAD_REQUEST', 'Some answers are not valid.', { issues: z.flattenError(parsed.error).fieldErrors });
  }
  const submission = parsed.data;

  const findExisting = async () => {
    const [existing] = await deps.db.select({ id: leadTable.id }).from(leadTable).where(eq(leadTable.submissionId, submission.submissionId)).limit(1);
    return existing ?? null;
  };
  const existing = await findExisting();
  if (existing) return Response.json({ leadId: existing.id }, { status: 201 });

  if (!(await claimAltchaSolution(deps.redis, verdict))) {
    return errorResponse(400, 'PROOF_OF_WORK_SPENT', 'The security check was already used. Try again.');
  }

  const [inserted] = await deps.db
    .insert(leadTable)
    .values({
      form: DEMO_REQUEST_FORM,
      formVersion: DEMO_REQUEST_FORM_VERSION,
      submissionId: submission.submissionId,
      response: submission.response,
      sourcePath: submission.sourcePath ?? null,
      userAgent: request.headers.get('user-agent')?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
    })
    .onConflictDoNothing({ target: leadTable.submissionId })
    .returning({ id: leadTable.id });
  // A concurrent retry with the same submission id won the insert.
  const lead = inserted ?? (await findExisting());
  if (!lead) throw new Error('The lead was neither inserted nor found.');
  if (inserted) {
    log.info({ leadId: lead.id, form: DEMO_REQUEST_FORM }, 'lead.created');
    handOffLeadAlert(lead.id, deps.db);
  }
  return Response.json({ leadId: lead.id }, { status: 201 });
}
