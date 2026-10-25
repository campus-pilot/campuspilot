import { describe, expect, it } from 'vitest';

import {
  EXPECTED_LEGACY_CATALOG,
  assertExpectedLegacyCatalog,
} from './legacy-catalog-contract.ts';

const clone = () => structuredClone(EXPECTED_LEGACY_CATALOG);

describe('tracked legacy catalog contract', () => {
  it('accepts the exact tracked catalog', () => {
    expect(() => assertExpectedLegacyCatalog(clone())).not.toThrow();
  });

  it('blocks an unknown empty table', () => {
    const catalog = clone();
    catalog.tables.push({ name: 'public.unknown_empty', columns: [], constraints: [], indexes: [] });
    expect(() => assertExpectedLegacyCatalog(catalog)).toThrow('differs');
  });

  it('blocks an extra empty column', () => {
    const catalog = clone();
    catalog.tables[0]!.columns.push({ name: 'unexpected', type: 'text', nullable: true, default: null });
    expect(() => assertExpectedLegacyCatalog(catalog)).toThrow('differs');
  });

  it('blocks enum drift', () => {
    const catalog = clone();
    catalog.enums[0]!.values.push('UNREVIEWED');
    expect(() => assertExpectedLegacyCatalog(catalog)).toThrow('differs');
  });

  it('blocks an unknown empty catalog relation', () => {
    const catalog = clone();
    catalog.otherRelations.push({ name: 'public.unknown_view', kind: 'view' });
    expect(() => assertExpectedLegacyCatalog(catalog)).toThrow('differs');
  });
});
