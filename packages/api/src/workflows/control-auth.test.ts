import { describe, expect, it } from 'vitest';

import {
  WORKER_CONTROL_SIGNATURE_HEADER,
  WORKER_CONTROL_SIGNATURE_WINDOW_MS,
  WORKER_CONTROL_TIMESTAMP_HEADER,
  signWorkerControlCall,
  verifyWorkerControlCall,
} from './control-auth';

const secret = 'x'.repeat(64);
const input = { jobId: `dsj_${'a'.repeat(21)}`, attempt: 1 };
const now = 1_800_000_000_000;
const startSeed = { service: 'DemoSchoolControl', handler: 'startSeed' };
const startPurge = { service: 'DemoSchoolControl', handler: 'startPurge' };

function headersFor(values: Record<string, string>) {
  return new Map(Object.entries(values));
}

describe('demo control call signatures', () => {
  it('accepts a call signed for the same handler and input, whatever the key order', () => {
    const headers = headersFor(signWorkerControlCall(secret, startSeed, input, now));
    expect(verifyWorkerControlCall({ secret, target: startSeed, input: { attempt: 1, jobId: input.jobId }, headers, acceptedAt: now + 1_000 })).toEqual({ ok: true });
  });

  it('refuses unsigned, malformed, forged and rebound calls', () => {
    const signed = signWorkerControlCall(secret, startSeed, input, now);
    const verify = (headers: Map<string, string>, overrides: Partial<Parameters<typeof verifyWorkerControlCall>[0]> = {}) =>
      verifyWorkerControlCall({ secret, target: startSeed, input, headers, acceptedAt: now, ...overrides });
    expect(verify(new Map())).toEqual({ ok: false, reason: 'missing' });
    expect(verify(headersFor({ ...signed, [WORKER_CONTROL_SIGNATURE_HEADER]: 'zz' }))).toEqual({ ok: false, reason: 'malformed' });
    expect(verify(headersFor(signed), { secret: 'y'.repeat(64) })).toEqual({ ok: false, reason: 'mismatch' });
    expect(verify(headersFor(signed), { input: { ...input, attempt: 2 } })).toEqual({ ok: false, reason: 'mismatch' });
    expect(verify(headersFor(signed), { target: startPurge })).toEqual({ ok: false, reason: 'mismatch' });
    // Changing the timestamp invalidates the signature.
    expect(verify(headersFor({ ...signed, [WORKER_CONTROL_TIMESTAMP_HEADER]: String(now + 1) }))).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('measures freshness against when Restate accepted the call', () => {
    const headers = headersFor(signWorkerControlCall(secret, startPurge, input, now));
    const verify = (acceptedAt: number) => verifyWorkerControlCall({ secret, target: startPurge, input, headers, acceptedAt });
    expect(verify(now + WORKER_CONTROL_SIGNATURE_WINDOW_MS)).toEqual({ ok: true });
    expect(verify(now - WORKER_CONTROL_SIGNATURE_WINDOW_MS)).toEqual({ ok: true });
    expect(verify(now + WORKER_CONTROL_SIGNATURE_WINDOW_MS + 1)).toEqual({ ok: false, reason: 'stale' });
    expect(verify(now - WORKER_CONTROL_SIGNATURE_WINDOW_MS - 1)).toEqual({ ok: false, reason: 'stale' });
  });
});
