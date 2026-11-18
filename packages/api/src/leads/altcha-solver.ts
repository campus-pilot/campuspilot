/**
 * The client half of the lead form's proof-of-work, in the ALTCHA format
 * (https://altcha.org/docs/proof-of-work): the server hands out
 * `{ algorithm, challenge, maxnumber, salt, signature }`, where `challenge` is
 * `SHA-256(salt + number)` for a secret random `number` up to `maxnumber`;
 * the browser finds that number by trying them in order and sends the
 * solution back as base64 JSON in a header. Nothing is shown to the person.
 *
 * Isomorphic on purpose (Web Crypto only): the web app runs it in the
 * browser and the API tests run it in Node.
 */

export type AltchaChallenge = {
  algorithm: 'SHA-256';
  challenge: string;
  maxnumber: number;
  salt: string;
  signature: string;
};

export type AltchaSolution = AltchaChallenge & { number: number };

/** Numbers hashed between yields, so a slow device keeps the page responsive. */
const BATCH = 2_000;

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Finds the number of a challenge (on average `maxnumber / 2` hashes).
 * Returns null when no number up to `maxnumber` matches, which only happens
 * for a challenge that was not issued by the server.
 */
export async function solveAltchaChallenge(challenge: AltchaChallenge, signal?: AbortSignal): Promise<AltchaSolution | null> {
  for (let start = 0; start <= challenge.maxnumber; start += BATCH) {
    signal?.throwIfAborted();
    const end = Math.min(start + BATCH - 1, challenge.maxnumber);
    for (let number = start; number <= end; number += 1) {
      if ((await sha256Hex(`${challenge.salt}${number}`)) === challenge.challenge) return { ...challenge, number };
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return null;
}

/** The header value of a solution: base64 of its JSON, as ALTCHA sends it. */
export function encodeAltchaSolution(solution: AltchaSolution): string {
  return btoa(JSON.stringify(solution));
}
