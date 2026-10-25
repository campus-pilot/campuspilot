import type pg from 'pg';
import { stableJson, sha256 } from './source-evidence.ts';

type Client = InstanceType<typeof pg.Client>;

export type PostgreSqlRuntimeIdentity = {
  systemIdentifier: string;
  serverVersion: string;
  timeZone: string;
  database: string;
  currentUser: string;
  sessionUser: string;
  configuredHost: string;
  configuredPort: string;
  serverAddress: string | null;
  serverPort: number | null;
  tls: { active: boolean; version: string | null; cipher: string | null };
};

/** Capture independently bindable PostgreSQL cluster, endpoint, and TLS facts. */
export async function postgresRuntimeIdentity(client: Client, connectionString: string): Promise<PostgreSqlRuntimeIdentity> {
  const url = new URL(connectionString);
  const result = await client.query<{
    system_identifier: string; server_version: string; timezone: string;
    database: string; current_user_name: string; session_user_name: string; server_address: string | null; server_port: number | null;
    ssl: boolean; version: string | null; cipher: string | null;
  }>(`
    SELECT (SELECT system_identifier::text FROM pg_control_system()) AS system_identifier,
      current_setting('server_version') AS server_version,
      current_setting('TimeZone') AS timezone,current_database() AS database,current_user AS current_user_name,
      session_user AS session_user_name,
      inet_server_addr()::text AS server_address,inet_server_port() AS server_port,
      coalesce(s.ssl,false) AS ssl,s.version,s.cipher
    FROM (SELECT pg_backend_pid() pid) p
    LEFT JOIN pg_stat_ssl s ON s.pid=p.pid
  `);
  const row = result.rows[0];
  if (!row?.system_identifier) throw new Error('Unable to read PostgreSQL system_identifier');
  return {
    systemIdentifier: row.system_identifier, serverVersion: row.server_version,
    timeZone: row.timezone, database: row.database, currentUser: row.current_user_name,
    sessionUser: row.session_user_name, configuredHost: url.hostname,
    configuredPort: url.port || '5432', serverAddress: row.server_address,
    serverPort: row.server_port,
    tls: { active: row.ssl, version: row.version, cipher: row.cipher },
  };
}

export function postgresRuntimeIdentitySha256(identity: PostgreSqlRuntimeIdentity) {
  return sha256(stableJson(identity));
}
