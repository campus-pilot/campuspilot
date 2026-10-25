import { describe, it } from 'vitest';

describe.skip('DB-only PostgreSQL and Gotenberg migration fixture', () => {
  it('runs snapshot, dry-run, import, and verify without mutating shared S3', () => {
    // Temporary rollout suppression: the previous fixture exercised the removed
    // S3 copy/signature/recovery design. Keep this named gate visible until the
    // PostgreSQL/Gotenberg fixture is rebuilt around exact shared-object keys.
  });
});
