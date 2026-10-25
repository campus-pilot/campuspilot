import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

import type pg from 'pg';

type Client = InstanceType<typeof pg.Client>;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

export type LegacyCatalogColumn = {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
};

export type LegacyCatalogConstraint = {
  name: string;
  kind: 'f' | 'p' | 'u';
  columns: string[];
  referencedTable: string | null;
  referencedColumns: string[];
  onDelete: string | null;
  onUpdate: string | null;
};

export type LegacyCatalogInventory = {
  schemaVersion: 1;
  source: string;
  tables: Array<{
    name: string;
    columns: LegacyCatalogColumn[];
    constraints: LegacyCatalogConstraint[];
    indexes: Array<{ name: string; unique: boolean; columns: string[] }>;
  }>;
  enums: Array<{ name: string; values: string[] }>;
  otherRelations: Array<{ name: string; kind: 'foreign-table' | 'materialized-view' | 'sequence' | 'view' }>;
};

export const EXPECTED_LEGACY_CATALOG = JSON.parse(readFileSync(
  new URL('../legacy-schema-contract.json', import.meta.url),
  'utf8',
)) as LegacyCatalogInventory;

const normalizeType = (value: string) => value
  .replace(/^character varying$/, 'varchar')
  .replace(/^timestamp without time zone$/, 'timestamp');

function removeRedundantOuterParentheses(value: string): string {
  let normalized = value.trim();
  while (normalized.startsWith('(') && normalized.endsWith(')')) {
    let depth = 0;
    let quoted = false;
    let wrapsExpression = true;
    for (let index = 0; index < normalized.length; index += 1) {
      const character = normalized[index];
      if (character === "'") {
        if (quoted && normalized[index + 1] === "'") index += 1;
        else quoted = !quoted;
      } else if (!quoted && character === '(') depth += 1;
      else if (!quoted && character === ')') {
        depth -= 1;
        if (depth === 0 && index !== normalized.length - 1) {
          wrapsExpression = false;
          break;
        }
      }
    }
    if (!wrapsExpression || depth !== 0 || quoted) break;
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized;
}

/** Normalize only literal casts emitted by PostgreSQL's catalog printer. */
export function normalizeLegacyDefaultExpression(value: string | null): string | null {
  if (value === null) return null;
  const normalized = removeRedundantOuterParentheses(value);
  const cast = normalized.match(
    /^(?<literal>'(?:[^']|'')*')::(?<type>(?:public\.)?(?:text|character varying|varchar|numeric|decimal|smallint|integer|bigint|bill_generation_event_type|exam_plan_status|ledger_event_type|staff_role))$/,
  );
  if (!cast?.groups) return normalized;
  const { literal, type } = cast.groups;
  if (!literal || !type) return normalized;
  if (/^(?:public\.)?(?:numeric|decimal|smallint|integer|bigint)$/.test(type)) {
    const numeric = literal.slice(1, -1).replaceAll("''", "'");
    if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(numeric)) return normalized;
  }
  return literal;
}

/** Accept JSON aggregation and defensively normalize the legacy driver's array shape. */
export function normalizeLegacyCatalogColumns(value: unknown): string[] {
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value;
  }
  if (typeof value === 'string' && /^\{(?:[A-Za-z_][A-Za-z0-9_]*(?:,[A-Za-z_][A-Za-z0-9_]*)*)?\}$/.test(value)) {
    const content = value.slice(1, -1);
    return content ? content.split(',') : [];
  }
  throw new Error('Legacy catalog column aggregation has an unexpected driver shape');
}

const action = (code: string | null) => ({
  a: 'no action', r: 'restrict', c: 'cascade', n: 'set null', d: 'set default',
}[code ?? ''] ?? null);

/**
 * Keep the catalog alias explicit and non-keyword. PostgreSQL 17 parses
 * `constraint` as a reserved token, so using it as an unquoted alias makes
 * this evidence query fail before any migration validation can run.
 */
export const LEGACY_CONSTRAINT_CATALOG_QUERY = `
  SELECT catalog_constraint.conname AS name, catalog_constraint.contype AS kind,
    (SELECT COALESCE(jsonb_agg(attribute.attname ORDER BY key.ordinality), '[]'::jsonb)
      FROM unnest(catalog_constraint.conkey) WITH ORDINALITY key(attnum,ordinality)
      JOIN pg_catalog.pg_attribute AS attribute ON attribute.attrelid=catalog_constraint.conrelid AND attribute.attnum=key.attnum
    ) AS columns,
    CASE WHEN catalog_constraint.contype='f' THEN target_namespace.nspname || '.' || target.relname END AS referenced_table,
    CASE WHEN catalog_constraint.contype='f' THEN (SELECT COALESCE(jsonb_agg(attribute.attname ORDER BY key.ordinality), '[]'::jsonb)
      FROM unnest(catalog_constraint.confkey) WITH ORDINALITY key(attnum,ordinality)
      JOIN pg_catalog.pg_attribute AS attribute ON attribute.attrelid=catalog_constraint.confrelid AND attribute.attnum=key.attnum
    ) ELSE '[]'::jsonb END AS referenced_columns,
    CASE WHEN catalog_constraint.contype='f' THEN catalog_constraint.confdeltype::text END AS delete_action,
    CASE WHEN catalog_constraint.contype='f' THEN catalog_constraint.confupdtype::text END AS update_action
  FROM pg_catalog.pg_constraint AS catalog_constraint
  JOIN pg_catalog.pg_class AS relation ON relation.oid=catalog_constraint.conrelid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=relation.relnamespace
  LEFT JOIN pg_catalog.pg_class AS target ON target.oid=catalog_constraint.confrelid
  LEFT JOIN pg_catalog.pg_namespace AS target_namespace ON target_namespace.oid=target.relnamespace
  WHERE namespace.nspname=$1 AND relation.relname=$2 AND catalog_constraint.contype IN ('f','p','u')
  ORDER BY catalog_constraint.conname
`;

export const LEGACY_INDEX_CATALOG_QUERY = `
  SELECT index_relation.relname AS name, index.indisunique AS unique,
    (SELECT COALESCE(jsonb_agg(attribute.attname ORDER BY key.ordinality), '[]'::jsonb)
      FROM unnest(index.indkey::smallint[]) WITH ORDINALITY key(attnum,ordinality)
      JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid=index.indrelid AND attribute.attnum=key.attnum
      WHERE key.ordinality<=index.indnatts) AS columns
  FROM pg_catalog.pg_index AS index
  JOIN pg_catalog.pg_class AS relation ON relation.oid=index.indrelid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=relation.relnamespace
  JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid=index.indexrelid
  LEFT JOIN pg_catalog.pg_constraint AS catalog_constraint ON catalog_constraint.conindid=index.indexrelid
  WHERE namespace.nspname=$1 AND relation.relname=$2 AND catalog_constraint.oid IS NULL
  ORDER BY index_relation.relname
`;

export const LEGACY_ENUM_CATALOG_QUERY = `
  SELECT namespace.nspname || '.' || type.typname AS name,
    jsonb_agg(enum.enumlabel ORDER BY enum.enumsortorder) AS values
  FROM pg_catalog.pg_type AS type
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=type.typnamespace
  JOIN pg_catalog.pg_enum AS enum ON enum.enumtypid=type.oid
  WHERE namespace.nspname='public'
  GROUP BY namespace.nspname,type.typname
  ORDER BY name
`;

/** Capture all non-system public catalog objects used by the frozen legacy app. */
export async function captureLegacyCatalog(client: Client): Promise<LegacyCatalogInventory> {
  const tableRows = (await client.query<{ name: string }>(`
    SELECT namespace.nspname || '.' || relation.relname AS name
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname='public' AND relation.relkind IN ('r','p')
    ORDER BY name
  `)).rows;
  const tables = [] as LegacyCatalogInventory['tables'];
  for (const { name } of tableRows) {
    const [schema, table] = name.split('.');
    if (!schema || !table) throw new Error(`Invalid catalog relation ${name}`);
    const columns = (await client.query<{
      name: string; type: string; nullable: boolean; default: string | null;
    }>(`
      SELECT attribute.attname AS name,
        pg_catalog.format_type(attribute.atttypid,attribute.atttypmod) AS type,
        NOT attribute.attnotnull AS nullable,
        pg_catalog.pg_get_expr(default_value.adbin,default_value.adrelid) AS default
      FROM pg_catalog.pg_attribute AS attribute
      JOIN pg_catalog.pg_class AS relation ON relation.oid=attribute.attrelid
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=relation.relnamespace
      LEFT JOIN pg_catalog.pg_attrdef AS default_value
        ON default_value.adrelid=relation.oid AND default_value.adnum=attribute.attnum
      WHERE namespace.nspname=$1 AND relation.relname=$2
        AND attribute.attnum>0 AND NOT attribute.attisdropped
      ORDER BY attribute.attnum
    `, [schema, table])).rows.map((column) => ({
      ...column,
      type: normalizeType(column.type),
      default: normalizeLegacyDefaultExpression(column.default),
    }));
    const constraints = (await client.query<{
      name: string; kind: 'f' | 'p' | 'u'; columns: string[];
      referenced_table: string | null; referenced_columns: string[];
      delete_action: string | null; update_action: string | null;
    }>(LEGACY_CONSTRAINT_CATALOG_QUERY, [schema, table])).rows.map((constraint) => ({
      name: constraint.name,
      kind: constraint.kind,
      columns: normalizeLegacyCatalogColumns(constraint.columns),
      referencedTable: constraint.referenced_table,
      referencedColumns: normalizeLegacyCatalogColumns(constraint.referenced_columns),
      onDelete: action(constraint.delete_action),
      onUpdate: action(constraint.update_action),
    }));
    const indexes = (await client.query<{
      name: string; unique: boolean; columns: string[];
    }>(LEGACY_INDEX_CATALOG_QUERY, [schema, table])).rows.map((index) => ({
      ...index,
      columns: normalizeLegacyCatalogColumns(index.columns),
    }));
    tables.push({ name, columns, constraints, indexes });
  }
  const enums = (await client.query<{ name: string; values: string[] }>(
    LEGACY_ENUM_CATALOG_QUERY,
  )).rows.map((catalogEnum) => ({
    ...catalogEnum,
    values: normalizeLegacyCatalogColumns(catalogEnum.values),
  }));
  const otherRelations = (await client.query<{
    name: string; kind: LegacyCatalogInventory['otherRelations'][number]['kind'];
  }>(`
    SELECT namespace.nspname || '.' || relation.relname AS name,
      CASE relation.relkind
        WHEN 'f' THEN 'foreign-table'
        WHEN 'm' THEN 'materialized-view'
        WHEN 'S' THEN 'sequence'
        WHEN 'v' THEN 'view'
      END AS kind
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname='public' AND relation.relkind IN ('f','m','S','v')
    ORDER BY name
  `)).rows;
  return {
    schemaVersion: 1,
    source: EXPECTED_LEGACY_CATALOG.source,
    tables,
    enums,
    otherRelations,
  };
}

export function assertExpectedLegacyCatalog(actual: LegacyCatalogInventory): void {
  if (stableJson(actual) !== stableJson(EXPECTED_LEGACY_CATALOG))
    throw new Error('Legacy PostgreSQL catalog differs from the tracked expected schema contract');
}

export function legacyCatalogSha256(catalog: LegacyCatalogInventory): string {
  return createHash('sha256').update(stableJson(catalog)).digest('hex');
}
