import { describe, expect, it } from 'vitest';

import { assertLegacyStatePolicy, assertSourceEvidence, captureSourceEvidence } from './source-evidence.ts';
import { EXPECTED_LEGACY_CATALOG } from './legacy-catalog-contract.ts';

const client = {
  query: async (sql: string) => ({ rows: [{ id: sql.split(/\s+/)[3] ?? 'row', value: 1 }] }),
} as any;
const legacyState = {
  defaultSessionConfigs: [], defaultSessionDiffs: [], features: [], aiUsage: [], aiQuota: [],
  studentPortal: { admissionEmailLinkedNonStaffUsers: 0, accounts: 0, studentSessions: 0 },
};

describe('source evidence', () => {
  it('creates deterministic per-table and aggregate digests using a mocked database', async () => {
    const input = { client, sourceVersion: 'v1', sourceDatabaseIdentity: 'host:5432/snapshot', migrationHistory: [{ hash: 'h', created_at: 1 }], catalog: EXPECTED_LEGACY_CATALOG, legacyState };
    const left = await captureSourceEvidence(input);
    const right = await captureSourceEvidence(input);
    expect(left).toEqual(right);
    expect(Object.keys(left.tables).length).toBeGreaterThan(10);
    expect(() => assertSourceEvidence(left, right)).not.toThrow();
  });

  it('rejects any connected-source digest drift', async () => {
    const evidence = await captureSourceEvidence({ client, sourceVersion: 'v1', sourceDatabaseIdentity: 'host:5432/snapshot', migrationHistory: [], catalog: EXPECTED_LEGACY_CATALOG, legacyState });
    expect(() => assertSourceEvidence(evidence, { ...evidence, sourceVersion: 'v2' })).toThrow('does not match');
  });

  it('blocks unknown feature keys and invalid AI dimensions', () => {
    expect(() => assertLegacyStatePolicy({
      ...legacyState,
      features: [{ schoolId: 'school', key: 'unknown:durable', value: true }],
    })).toThrow('feature');
    expect(() => assertLegacyStatePolicy({
      ...legacyState,
      aiUsage: [{ usageType: 'template:ai', year: 2026, month: 13, count: 1 }],
    })).toThrow('AI');
  });
});
