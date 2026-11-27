import { encodeAltchaSolution, solveAltchaChallenge, type AltchaChallenge } from "@campuspilot/api/leads/altcha-solver";
import { LEAD_CHALLENGE_PATH, PROOF_OF_WORK_HEADER } from "@campuspilot/api/leads/demo-request";
import { SCHOOL_ONBOARDING_FIELDS, SCHOOL_ONBOARDING_PATH, type SchoolOnboardingSubmission } from "@campuspilot/api/leads/school-onboarding";
import { env } from "@campuspilot/env/web";

/**
 * What one School Onboarding submission came to:
 * - `saved`: the request and its files are stored;
 * - `invalid`: the server refused the answers or a file, with its message;
 * - `unavailable`: the API could not be reached or kept refusing after every
 *   retry, so the person is offered the contact page instead.
 */
export type OnboardingOutcome = { kind: "saved"; requestId: string } | { kind: "invalid"; message: string } | { kind: "unavailable" };

export type OnboardingFiles = { logo: File | null; voiceNote: { blob: Blob; mimeType: string } | null };

/** Tries in all, with 1 s and 2 s pauses between them. Each try re-sends the files, so fewer than the demo form. */
const ATTEMPTS = 3;

function apiUrl(path: string) {
  return `${env.VITE_SERVER_URL.replace(/\/+$/, "")}${path}`;
}

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A file name the server ignores but multipart needs; the extension only helps people reading logs. */
function voiceNoteFileName(mimeType: string) {
  if (mimeType.includes("mp4")) return "voice-note.m4a";
  if (mimeType.includes("ogg")) return "voice-note.ogg";
  return "voice-note.webm";
}

function body(submission: SchoolOnboardingSubmission, files: OnboardingFiles) {
  const form = new FormData();
  form.set(SCHOOL_ONBOARDING_FIELDS.submission, JSON.stringify(submission));
  if (files.logo) form.set(SCHOOL_ONBOARDING_FIELDS.logo, files.logo, files.logo.name);
  if (files.voiceNote) form.set(SCHOOL_ONBOARDING_FIELDS.voiceNote, files.voiceNote.blob, voiceNoteFileName(files.voiceNote.mimeType));
  return form;
}

/**
 * One try: fetch a fresh challenge, solve it in the browser and post the
 * multipart body with the solution in the `x-altcha` header. Returns null
 * for a failure worth retrying (a refused or expired proof-of-work, a server
 * error); network errors throw and are retried the same way.
 */
async function attempt(submission: SchoolOnboardingSubmission, files: OnboardingFiles): Promise<OnboardingOutcome | null> {
  const challengeResponse = await fetch(apiUrl(LEAD_CHALLENGE_PATH), { cache: "no-store" });
  if (challengeResponse.status === 429) return { kind: "unavailable" };
  if (!challengeResponse.ok) return null;
  const solution = await solveAltchaChallenge((await challengeResponse.json()) as AltchaChallenge);
  if (!solution) return null;
  const response = await fetch(apiUrl(SCHOOL_ONBOARDING_PATH), {
    method: "POST",
    headers: { [PROOF_OF_WORK_HEADER]: encodeAltchaSolution(solution) },
    body: body(submission, files),
  });
  if (response.ok) return { kind: "saved", requestId: ((await response.json()) as { requestId: string }).requestId };
  if (response.status === 429) return { kind: "unavailable" };
  const error = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
  if (response.status === 413 || response.status === 415 || (response.status === 400 && error?.code === "BAD_REQUEST")) {
    return { kind: "invalid", message: error?.message ?? "Some answers could not be accepted." };
  }
  return null;
}

/**
 * Submits the form, retrying lost or failed tries. Every try resends the same
 * `submissionId`, so a try whose response was lost after the request was
 * saved returns that request instead of creating a second one.
 */
export async function submitSchoolOnboarding(submission: SchoolOnboardingSubmission, files: OnboardingFiles): Promise<OnboardingOutcome> {
  for (let index = 0; index < ATTEMPTS; index += 1) {
    if (index > 0) await pause(1000 * 2 ** (index - 1));
    try {
      const outcome = await attempt(submission, files);
      if (outcome) return outcome;
    } catch {
      // A network failure: the next try starts over with a new challenge.
    }
  }
  return { kind: "unavailable" };
}
