import { describe, expect, it } from 'vitest';

import {
  assertCanonicalExceptionArtifact,
  canonicalBlockingIssues,
} from './exception-contract.ts';

const findings = [
  {
    code: 'E_SECOND',
    domain: 'examination',
    sourceKey: '2',
    severity: 'blocking' as const,
    message: 'second',
  },
  {
    code: 'A_FIRST',
    domain: 'academic',
    sourceKey: '1',
    severity: 'blocking' as const,
    message: 'first',
  },
];

describe('canonical exception contract', () => {
  it('sorts deterministically and refuses any unresolved blocker', () => {
    const blocking = canonicalBlockingIssues(findings);
    expect(blocking.map((entry) => entry.code)).toEqual(['A_FIRST', 'E_SECOND']);
    expect(() => assertCanonicalExceptionArtifact(
      { schemaVersion: 2, blocking, rebuilds: [], warnings: [] },
      findings,
      [],
    )).toThrow('unresolved');
  });

  it('accepts an exact blocker-free artifact and rejects omissions', () => {
    expect(() => assertCanonicalExceptionArtifact(
      { schemaVersion: 2, blocking: [], rebuilds: [], warnings: [] },
      [],
      [],
    )).not.toThrow();
    expect(() => assertCanonicalExceptionArtifact(
      { schemaVersion: 2, blocking: [], rebuilds: [], warnings: [] },
      findings,
      [],
    )).toThrow('do not exactly match');
  });

  it('requires every typed tracked rebuild decision without relabeling', () => {
    const rebuilds = [{
      code: 'F_PROJECTION_REBUILD' as const,
      domain: 'finance' as const,
      sourceKey: 'student',
      disposition: 'rebuild-from-events' as const,
      evidence: { status: 'stale' },
    }];
    expect(() => assertCanonicalExceptionArtifact(
      { schemaVersion: 2, blocking: [], rebuilds, warnings: [] }, [], rebuilds,
    )).not.toThrow();
    expect(() => assertCanonicalExceptionArtifact(
      { schemaVersion: 2, blocking: [], rebuilds: [], warnings: [] }, [], rebuilds,
    )).toThrow('do not exactly match');
  });
});
