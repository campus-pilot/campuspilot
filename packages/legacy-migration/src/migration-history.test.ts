import { createHash } from 'node:crypto';

import { expect, it } from 'vitest';

import { migrationHistoryCopyBytes } from './migration-history.ts';

it('matches the ordered PostgreSQL COPY representation used by the complete gate', () => {
  const bytes = migrationHistoryCopyBytes([
    { hash: 'a'.repeat(64), created_at: 1 },
    { hash: 'b'.repeat(64), created_at: 2 },
  ]);
  expect(bytes.toString('utf8')).toBe(
    `${'a'.repeat(64)}|1\n${'b'.repeat(64)}|2\n`,
  );
  expect(createHash('sha256').update(bytes).digest('hex')).toMatch(
    /^[0-9a-f]{64}$/,
  );
});
