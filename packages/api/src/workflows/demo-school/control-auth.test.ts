import { describe, expect, it } from 'vitest';

import {
  DEMO_CONTROL_SIGNATURE_HEADER,
  DEMO_CONTROL_SIGNATURE_WINDOW_MS,
  DEMO_CONTROL_TIMESTAMP_HEADER,
  signDemoControlCall,
  verifyDemoControlCall,
} from './control-auth';

const secret = 'x'.repeat(64);
const input = { jobId: `dsj_${'a'.repeat(21)}`, attempt: 1 };
const now = 1_800_000_000_000;

function headersFor(values: Record<string, string>) {
  return new Map(Object.entries(values));
}

describe('demo control call signatures', () => {
  it('accepts a call signed for the same handler and input, whatever the key order', () => {
    const headers = headersFor(signDemoControlCall(secret, 'startSeed', input, now));
    expect(verifyDemoControlCall({ secret, handler: 'startSeed', input: { attempt: 1, jobId: input.jobId }, headers, acceptedAt: now + 1_000 })).toEqual({ ok: true });
  });

  it('refuses unsigned, malformed, forged and rebound calls', () => {
    const signed = signDemoControlCall(secret, 'startSeed', input, now);
    const verify = (headers: Map<string, string>, overrides: Partial<Parameters<typeof verifyDemoControlCall>[0]> = {}) =>
      verifyDemoControlCall({ secret, handler: 'startSeed', input, headers, acceptedAt: now, ...overrides });
    expect(verify(new Map())).toEqual({ ok: false, reason: 'missing' });
    expect(verify(headersFor({ ...signed, [DEMO_CONTROL_SIGNATURE_HEADER]: 'zz' }))).toEqual({ ok: false, reason: 'malformed' });
    expect(verify(headersFor(signed), { secret: 'y'.repeat(64) })).toEqual({ ok: false, reason: 'mismatch' });
    expect(verify(headersFor(signed), { input: { ...input, attempt: 2 } })).toEqual({ ok: false, reason: 'mismatch' });
    expect(verify(headersFor(signed), { handler: 'startPurge' })).toEqual({ ok: false, reason: 'mismatch' });
    // Changing the timestamp invalidates the signature.
    expect(verify(headersFor({ ...signed, [DEMO_CONTROL_TIMESTAMP_HEADER]: String(now + 1) }))).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('measures freshness against when Restate accepted the call', () => {
    const headers = headersFor(signDemoControlCall(secret, 'startPurge', input, now));
    const verify = (acceptedAt: number) => verifyDemoControlCall({ secret, handler: 'startPurge', input, headers, acceptedAt });
    expect(verify(now + DEMO_CONTROL_SIGNATURE_WINDOW_MS)).toEqual({ ok: true });
    expect(verify(now - DEMO_CONTROL_SIGNATURE_WINDOW_MS)).toEqual({ ok: true });
    expect(verify(now + DEMO_CONTROL_SIGNATURE_WINDOW_MS + 1)).toEqual({ ok: false, reason: 'stale' });
    expect(verify(now - DEMO_CONTROL_SIGNATURE_WINDOW_MS - 1)).toEqual({ ok: false, reason: 'stale' });
  });
});
