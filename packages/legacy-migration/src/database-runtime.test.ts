import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { postgresRuntimeIdentity } from './database-runtime.ts';

type Client = InstanceType<typeof pg.Client>;

const connectionString =
  'postgresql://migration:secret@db.internal:5432/campuspilot-plus?sslmode=require';

function runtimeRow(currentUser: string, sessionUser: string) {
  return {
    system_identifier: '123',
    server_version: '17.2',
    timezone: 'UTC',
    database: 'campuspilot-plus',
    current_user_name: currentUser,
    session_user_name: sessionUser,
    server_address: '10.0.0.2',
    server_port: 5432,
  };
}

function result(rows: unknown[]) {
  return { rows };
}

describe('postgresRuntimeIdentity', () => {
  it('reads TLS as the session login and restores an identifier-safe owner role', async () => {
    const owner = 'owner"quoted';
    const login = 'migration-login';
    const query = vi
      .fn()
      .mockResolvedValueOnce(result([runtimeRow(owner, login)]))
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(
        result([{ current_user_name: login, session_user_name: login }]),
      )
      .mockResolvedValueOnce(
        result([{ ssl: true, version: 'TLSv1.3', cipher: 'TLS_AES_256_GCM_SHA384' }]),
      )
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(
        result([{ current_user_name: owner, session_user_name: login }]),
      );
    const client = { query } as unknown as Client;

    const identity = await postgresRuntimeIdentity(client, connectionString, {
      expectedCurrentUser: owner,
      expectedSessionUser: login,
    });

    expect(identity.currentUser).toBe(owner);
    expect(identity.sessionUser).toBe(login);
    expect(identity.tls).toEqual({
      active: true,
      version: 'TLSv1.3',
      cipher: 'TLS_AES_256_GCM_SHA384',
    });
    expect(query.mock.calls.map(([sql]) => String(sql).trim())).toEqual([
      expect.stringContaining('pg_control_system'),
      'RESET ROLE',
      expect.stringContaining('SELECT current_user AS current_user_name'),
      expect.stringContaining('FROM pg_stat_ssl'),
      'SET ROLE "owner""quoted"',
      expect.stringContaining('SELECT current_user AS current_user_name'),
    ]);
  });

  it('restores and verifies the owner before propagating a TLS observation error', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(result([runtimeRow('owner', 'migration')]))
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(
        result([{ current_user_name: 'migration', session_user_name: 'migration' }]),
      )
      .mockRejectedValueOnce(new Error('pg_stat_ssl unavailable'))
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(
        result([{ current_user_name: 'owner', session_user_name: 'migration' }]),
      );

    await expect(
      postgresRuntimeIdentity(
        { query } as unknown as Client,
        connectionString,
        {
          expectedCurrentUser: 'owner',
          expectedSessionUser: 'migration',
        },
      ),
    ).rejects.toThrow('pg_stat_ssl unavailable');
    expect(String(query.mock.calls[4]?.[0]).trim()).toBe('SET ROLE "owner"');
    expect(query).toHaveBeenCalledTimes(6);
  });

  it('refuses to reset an active role without explicit expected identities', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(result([runtimeRow('owner', 'migration')]));

    await expect(
      postgresRuntimeIdentity(
        { query } as unknown as Client,
        connectionString,
      ),
    ).rejects.toThrow(
      'requires explicit expected current and session roles',
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('validates the expected owner before changing role state', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(result([runtimeRow('unexpected', 'migration')]));

    await expect(
      postgresRuntimeIdentity(
        { query } as unknown as Client,
        connectionString,
        {
          expectedCurrentUser: 'owner',
          expectedSessionUser: 'migration',
        },
      ),
    ).rejects.toThrow('does not match expected owner');
    expect(query).toHaveBeenCalledTimes(1);
  });
});
