import { expect, it, vi } from 'vitest';
import { withAuthorizedSnapshotAdmin } from './snapshot-safety.ts';

function runtime(systemIdentifier: string, currentUser: string) {
  return {
    systemIdentifier,
    serverVersion: '17',
    timeZone: 'Asia/Kolkata',
    database: 'legacy_fixture',
    currentUser,
    sessionUser: currentUser,
    configuredHost: '127.0.0.1',
    configuredPort: '55433',
    serverAddress: '127.0.0.1',
    serverPort: 55433,
    tls: { active: false, version: null, cipher: null },
  };
}

it('performs no DDL when admin and canonical cluster identities differ', async () => {
  const ddl = vi.fn(async () => undefined);
  await expect(withAuthorizedSnapshotAdmin({
    adminConnectionString:
      'postgresql://snapshot_admin:secret@127.0.0.1:55433/postgres',
    authorization: {
      allowedDatabaseIdentities: '127.0.0.1:55433/postgres',
      expectedSystemIdentifier: 'admin-cluster',
      expectedRole: 'snapshot_admin',
      requireTls: false,
    },
    canonicalRuntime: runtime('canonical-cluster', 'reader'),
    adminRuntime: runtime('admin-cluster', 'snapshot_admin'),
    action: ddl,
  })).rejects.toThrow('does not match the connected canonical');
  expect(ddl).not.toHaveBeenCalled();
});
