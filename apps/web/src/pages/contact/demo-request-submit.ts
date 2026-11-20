import { encodeAltchaSolution, solveAltchaChallenge, type AltchaChallenge } from "@campuspilot/api/leads/altcha-solver";
import {
  DEMO_REQUEST_PATH,
  LEAD_CHALLENGE_PATH,
  PROOF_OF_WORK_HEADER,
  type DemoRequestSubmission,
} from "@campuspilot/api/leads/demo-request";
import { env } from "@campuspilot/env/web";

/**
 * What one demo request submission came to:
 * - `saved`: the lead is in the database (the only success the server
 *   reports; the WhatsApp alert is its own background work and never fails
 *   this);
 * - `invalid`: the server refused the answers, which the form's own checks
 *   should have caught;
 * - `unavailable`: the API could not be reached or kept refusing after every
 *   retry, so the person is offered the direct channels instead.
 */
export type DemoRequestOutcome = { kind: "saved"; leadId: string } | { kind: "invalid" } | { kind: "unavailable" };

/** Tries in all, with 1 s, 2 s and 4 s pauses between them. */
const ATTEMPTS = 4;

function apiUrl(path: string) {
  return `${env.VITE_SERVER_URL.replace(/\/+$/, "")}${path}`;
}

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One try: fetch a fresh challenge, solve it in the browser and post the
 * answers with the solution in the `x-altcha` header. Returns null for a
 * failure worth retrying (a refused or expired proof-of-work, a server
 * error); network errors throw and are retried the same way.
 */
async function attempt(submission: DemoRequestSubmission): Promise<DemoRequestOutcome | null> {
  const challengeResponse = await fetch(apiUrl(LEAD_CHALLENGE_PATH), { cache: "no-store" });
  if (challengeResponse.status === 429) return { kind: "unavailable" };
  if (!challengeResponse.ok) return null;
  const solution = await solveAltchaChallenge((await challengeResponse.json()) as AltchaChallenge);
  if (!solution) return null;
  const response = await fetch(apiUrl(DEMO_REQUEST_PATH), {
    method: "POST",
    headers: { "Content-Type": "application/json", [PROOF_OF_WORK_HEADER]: encodeAltchaSolution(solution) },
    body: JSON.stringify(submission),
  });
  if (response.ok) return { kind: "saved", leadId: ((await response.json()) as { leadId: string }).leadId };
  if (response.status === 429) return { kind: "unavailable" };
  const body = (await response.json().catch(() => null)) as { code?: string } | null;
  if (response.status === 400 && body?.code === "BAD_REQUEST") return { kind: "invalid" };
  return null;
}

/**
 * Submits a demo request, retrying lost or failed tries. Every try resends
 * the same `submissionId`, so a try whose response was lost after the lead
 * was saved returns that lead instead of creating a second one.
 */
export async function submitDemoRequest(submission: DemoRequestSubmission): Promise<DemoRequestOutcome> {
  for (let index = 0; index < ATTEMPTS; index += 1) {
    if (index > 0) await pause(1000 * 2 ** (index - 1));
    try {
      const outcome = await attempt(submission);
      if (outcome) return outcome;
    } catch {
      // A network failure: the next try starts over with a new challenge.
    }
  }
  return { kind: "unavailable" };
}
