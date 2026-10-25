import { describe, expect, it } from 'vitest';

import {
  EXPECTED_LEGACY_CATALOG,
  LEGACY_CONSTRAINT_CATALOG_QUERY,
  LEGACY_ENUM_CATALOG_QUERY,
  LEGACY_INDEX_CATALOG_QUERY,
  assertExpectedLegacyCatalog,
  normalizeLegacyCatalogColumns,
  normalizeLegacyDefaultExpression,
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

  it('does not use PostgreSQL reserved constraint aliases in catalog SQL', () => {
    for (const query of [
      LEGACY_CONSTRAINT_CATALOG_QUERY,
      LEGACY_INDEX_CATALOG_QUERY,
    ]) {
      expect(query).not.toMatch(/\bAS\s+constraint\b/i);
      expect(query).not.toMatch(/\bconstraint\.(?:con|oid)/i);
    }
  });

  it('uses JSON aggregation and accepts the legacy driver array shape defensively', () => {
    expect(LEGACY_CONSTRAINT_CATALOG_QUERY).toContain('jsonb_agg');
    expect(LEGACY_INDEX_CATALOG_QUERY).toContain('jsonb_agg');
    expect(LEGACY_ENUM_CATALOG_QUERY).toContain('jsonb_agg');
    expect(normalizeLegacyCatalogColumns(['id'])).toEqual(['id']);
    expect(normalizeLegacyCatalogColumns('{id}')).toEqual(['id']);
    expect(normalizeLegacyCatalogColumns('{school_id,usage_type}')).toEqual([
      'school_id',
      'usage_type',
    ]);
    expect(() => normalizeLegacyCatalogColumns('{"unreviewed,shape"}')).toThrow(
      'unexpected driver shape',
    );
  });

  it('keeps the tracked admission column order aligned with PostgreSQL attnum', () => {
    const admission = EXPECTED_LEGACY_CATALOG.tables.find(
      ({ name }) => name === 'public.admission',
    );
    expect(admission?.columns.slice(0, 5).map(({ name }) => name)).toEqual([
      'id',
      'school_id',
      'name',
      'admissionNo',
      'admission_class_id',
    ]);
  });

  it.each([
    ["'default'::text", "'default'"],
    ["('current'::character varying)", "'current'"],
    ["'0'::numeric", "'0'"],
    ["'draft'::exam_plan_status", "'draft'"],
    ["'{}'::jsonb", "'{}'::jsonb"],
    ['now()', 'now()'],
    ['(CURRENT_TIMESTAMP)', 'CURRENT_TIMESTAMP'],
  ])('normalizes the catalog default %s without changing semantics', (input, expected) => {
    expect(normalizeLegacyDefaultExpression(input)).toBe(expected);
  });
});
