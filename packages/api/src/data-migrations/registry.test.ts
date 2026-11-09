import { describe, expect, it } from 'vitest';

import { DATA_MIGRATIONS, findDataMigration } from './registry';

describe('data migration registry', () => {
  it('has unique, stable-looking IDs and positive batch sizes', () => {
    const ids = DATA_MIGRATIONS.map((migration) => migration.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const migration of DATA_MIGRATIONS) {
      expect(migration.id).toMatch(/^[a-z0-9][a-z0-9-]{2,99}$/);
      expect(migration.batchSize).toBeGreaterThan(0);
      expect(findDataMigration(migration.id)).toBe(migration);
    }
  });
});
