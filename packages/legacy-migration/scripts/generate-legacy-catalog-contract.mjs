import { readFile, writeFile } from 'node:fs/promises';

const [snapshotPath, outputPath] = process.argv.slice(2);
if (!snapshotPath || !outputPath) {
  throw new Error('usage: generate-legacy-catalog-contract.mjs <drizzle-snapshot.json> <output.json>');
}

const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
const normalizeDefault = (value) => value === undefined ? null : String(value);
const tables = Object.entries(snapshot.tables).map(([qualifiedName, table]) => ({
  name: qualifiedName,
  columns: Object.values(table.columns).map((column) => ({
    name: column.name,
    type: column.type,
    nullable: !column.notNull,
    default: normalizeDefault(column.default),
  })),
  constraints: [
    ...(Object.values(table.columns).some((column) => column.primaryKey) ? [{
      name: `${table.name}_pkey`,
      kind: 'p',
      columns: Object.values(table.columns).filter((column) => column.primaryKey).map((column) => column.name),
      referencedTable: null,
      referencedColumns: [],
      onDelete: null,
      onUpdate: null,
    }] : []),
    ...Object.values(table.foreignKeys).map((constraint) => ({
      name: constraint.name,
      kind: 'f',
      columns: constraint.columnsFrom,
      referencedTable: `public.${constraint.tableTo}`,
      referencedColumns: constraint.columnsTo,
      onDelete: constraint.onDelete,
      onUpdate: constraint.onUpdate,
    })),
    ...Object.values(table.uniqueConstraints).map((constraint) => ({
      name: constraint.name,
      kind: 'u',
      columns: constraint.columns,
      referencedTable: null,
      referencedColumns: [],
      onDelete: null,
      onUpdate: null,
    })),
  ].sort((left, right) => left.name.localeCompare(right.name)),
  indexes: Object.values(table.indexes).map((index) => ({
    name: index.name,
    unique: index.isUnique,
    columns: index.columns.map((column) => column.expression),
  })).sort((left, right) => left.name.localeCompare(right.name)),
})).sort((left, right) => left.name.localeCompare(right.name));

const enums = Object.entries(snapshot.enums).map(([qualifiedName, value]) => ({
  name: qualifiedName,
  values: value.values,
})).sort((left, right) => left.name.localeCompare(right.name));

await writeFile(outputPath, `${JSON.stringify({
  schemaVersion: 1,
  source: 'legacy Drizzle snapshot 0008_black_bishop',
  tables,
  enums,
  otherRelations: [],
}, null, 2)}\n`, { mode: 0o644 });
