import { describe, expect, it } from 'vitest';

import { encodeAltchaSolution, solveAltchaChallenge } from './altcha-solver';
import { ALTCHA_TTL_MS, createAltchaChallenge, verifyAltchaSolution } from './proof-of-work';

const key = 'k'.repeat(32);
/** A small search space keeps the tests fast; the format is the same. */
const maxNumber = 500;

async function solved(now = Date.now()) {
  const challenge = createAltchaChallenge({ key, now, maxNumber });
  const solution = await solveAltchaChallenge(challenge);
  if (!solution) throw new Error('The challenge was not solvable.');
  return solution;
}

describe('lead proof-of-work', () => {
  it('accepts a solved challenge it issued', async () => {
    const solution = await solved();
    const verdict = verifyAltchaSolution(encodeAltchaSolution(solution), { key });
    expect(verdict).toEqual({ ok: true, signature: solution.signature, expiresAt: expect.any(Number) });
  });

  it('refuses a missing or malformed header', () => {
    expect(verifyAltchaSolution(null, { key })).toEqual({ ok: false, reason: 'missing' });
    expect(verifyAltchaSolution('not base64 json', { key })).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyAltchaSolution(btoa(JSON.stringify({ algorithm: 'SHA-1' })), { key })).toEqual({ ok: false, reason: 'malformed' });
  });

  it('refuses a challenge signed with another key', async () => {
    const solution = await solved();
    expect(verifyAltchaSolution(encodeAltchaSolution(solution), { key: 'x'.repeat(32) })).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses a wrong number', async () => {
    const solution = await solved();
    const wrong = { ...solution, number: solution.number + 1 };
    expect(verifyAltchaSolution(encodeAltchaSolution(wrong), { key })).toEqual({ ok: false, reason: 'wrong_number' });
  });

  it('refuses an expired challenge', async () => {
    const issuedAt = Date.now() - ALTCHA_TTL_MS - 1_000;
    const solution = await solved(issuedAt);
    expect(verifyAltchaSolution(encodeAltchaSolution(solution), { key })).toEqual({ ok: false, reason: 'expired' });
  });

  it('refuses a salt whose expiry was extended, because the signature covers it', async () => {
    const solution = await solved();
    const salt = solution.salt.replace(/expires=\d+/, 'expires=99999999999');
    expect(verifyAltchaSolution(encodeAltchaSolution({ ...solution, salt }), { key })).toEqual({ ok: false, reason: 'wrong_number' });
  });
});
