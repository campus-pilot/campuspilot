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

export type PostgreSqlRuntimeRoleExpectations = {
  expectedCurrentUser?: string;
  expectedSessionUser?: string;
};

type PostgreSqlRoles = {
  current_user_name: string;
  session_user_name: string;
};

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function assertExpectedRoles(
  roles: PostgreSqlRoles,
  expectations: PostgreSqlRuntimeRoleExpectations,
): void {
  if (
    expectations.expectedCurrentUser !== undefined &&
    roles.current_user_name !== expectations.expectedCurrentUser
  ) {
    throw new Error(
      `PostgreSQL current_user ${JSON.stringify(roles.current_user_name)} does not match expected owner ${JSON.stringify(expectations.expectedCurrentUser)}`,
    );
  }
  if (
    expectations.expectedSessionUser !== undefined &&
    roles.session_user_name !== expectations.expectedSessionUser
  ) {
    throw new Error(
      `PostgreSQL session_user ${JSON.stringify(roles.session_user_name)} does not match expected login ${JSON.stringify(expectations.expectedSessionUser)}`,
    );
  }
}

async function readRoles(client: Client): Promise<PostgreSqlRoles> {
  const result = await client.query<PostgreSqlRoles>(`
    SELECT current_user AS current_user_name,session_user AS session_user_name
  `);
  const roles = result.rows[0];
  if (!roles?.current_user_name || !roles.session_user_name)
    throw new Error('Unable to read PostgreSQL current/session roles');
  return roles;
}

async function readTls(client: Client) {
  const result = await client.query<{
    ssl: boolean;
    version: string | null;
    cipher: string | null;
  }>(`
    SELECT ssl,version,cipher
    FROM pg_stat_ssl
    WHERE pid=pg_backend_pid()
  `);
  const tls = result.rows[0];
  if (!tls)
    throw new Error('Unable to attest TLS for the current PostgreSQL connection');
  return { active: tls.ssl, version: tls.version, cipher: tls.cipher };
}

/**
 * Read TLS facts as the session login when SET ROLE hides its pg_stat_ssl row,
 * then restore the exact prevalidated owner before returning or propagating an
 * observation error. PostgreSQL role identifiers cannot be query parameters,
 * so the server-returned, expected owner is quoted as an identifier.
 */
async function readTlsWithRoleRestoration(
  client: Client,
  initialRoles: PostgreSqlRoles,
  expectations: PostgreSqlRuntimeRoleExpectations,
) {
  if (initialRoles.current_user_name === initialRoles.session_user_name)
    return readTls(client);

  if (
    expectations.expectedCurrentUser === undefined ||
    expectations.expectedSessionUser === undefined
  ) {
    throw new Error(
      'A PostgreSQL SET ROLE connection requires explicit expected current and session roles before TLS attestation',
    );
  }

  let tls:
    | { active: boolean; version: string | null; cipher: string | null }
    | undefined;
  let observationError: unknown;
  try {
    // RESET ROLE can restore a startup `options=-c role=...` value instead of
    // session_user. SET ROLE NONE always selects the authenticated session role.
    await client.query('SET ROLE NONE');
    const resetRoles = await readRoles(client);
    if (
      resetRoles.current_user_name !== initialRoles.session_user_name ||
      resetRoles.session_user_name !== initialRoles.session_user_name
    ) {
      throw new Error('SET ROLE NONE did not restore the expected PostgreSQL session login');
    }
    tls = await readTls(client);
  } catch (error) {
    observationError = error;
  }

  let restorationError: unknown;
  try {
    await client.query(
      `SET ROLE ${quoteIdentifier(initialRoles.current_user_name)}`,
    );
    const restoredRoles = await readRoles(client);
    if (
      restoredRoles.current_user_name !== initialRoles.current_user_name ||
      restoredRoles.session_user_name !== initialRoles.session_user_name
    ) {
      throw new Error('PostgreSQL current/session roles were not restored after TLS attestation');
    }
  } catch (error) {
    restorationError = error;
  }

  if (restorationError !== undefined) {
    throw new AggregateError(
      observationError === undefined
        ? [restorationError]
        : [observationError, restorationError],
      'Failed to restore the PostgreSQL owner role after TLS attestation',
    );
  }
  if (observationError !== undefined) throw observationError;
  if (!tls) throw new Error('Unable to attest PostgreSQL TLS state');
  return tls;
}

/** Capture independently bindable PostgreSQL cluster, endpoint, and TLS facts. */
export async function postgresRuntimeIdentity(
  client: Client,
  connectionString: string,
  roleExpectations: PostgreSqlRuntimeRoleExpectations = {},
): Promise<PostgreSqlRuntimeIdentity> {
  const url = new URL(connectionString);
  const result = await client.query<{
    system_identifier: string; server_version: string; timezone: string;
    database: string; current_user_name: string; session_user_name: string; server_address: string | null; server_port: number | null;
  }>(`
    SELECT (SELECT system_identifier::text FROM pg_control_system()) AS system_identifier,
      current_setting('server_version') AS server_version,
      current_setting('TimeZone') AS timezone,current_database() AS database,current_user AS current_user_name,
      session_user AS session_user_name,
      inet_server_addr()::text AS server_address,inet_server_port() AS server_port
  `);
  const row = result.rows[0];
  if (!row?.system_identifier) throw new Error('Unable to read PostgreSQL system_identifier');
  const initialRoles = {
    current_user_name: row.current_user_name,
    session_user_name: row.session_user_name,
  };
  assertExpectedRoles(initialRoles, roleExpectations);
  const tls = await readTlsWithRoleRestoration(
    client,
    initialRoles,
    roleExpectations,
  );
  return {
    systemIdentifier: row.system_identifier, serverVersion: row.server_version,
    timeZone: row.timezone, database: row.database, currentUser: row.current_user_name,
    sessionUser: row.session_user_name, configuredHost: url.hostname,
    configuredPort: url.port || '5432', serverAddress: row.server_address,
    serverPort: row.server_port,
    tls,
  };
}

export function postgresRuntimeIdentitySha256(identity: PostgreSqlRuntimeIdentity) {
  return sha256(stableJson(identity));
}
