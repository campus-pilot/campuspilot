import { sql } from 'drizzle-orm';

import type { Database } from './index';

/**
 * Idempotent authority split applied after every schema migration run.
 *
 * Migrations execute as `campuspilot-plus-owner` through the dedicated
 * migration login. The API login receives only connection, schema usage,
 * application-table DML and sequence access. Reapplying the block after future
 * schema migrations also grants the runtime role access to newly added tables.
 */
export const CAMPUSPILOT_PLUS_RUNTIME_GRANTS_SQL = String.raw`
DO $runtime_grants$
DECLARE
  target_database text := pg_catalog.current_database();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'campuspilot-plus'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'campuspilot-plus-owner'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'campuspilot-plus-migration'
  ) THEN
    RETURN;
  END IF;

  IF target_database <> 'campuspilot-plus' AND
     target_database <> 'campuspilot_integration' THEN
    RAISE EXCEPTION 'refusing runtime grants on unexpected database %',
      target_database;
  END IF;

  IF session_user <> 'campuspilot-plus-migration' OR
     current_user <> 'campuspilot-plus-owner' THEN
    RAISE EXCEPTION 'runtime grants require the migration login with owner role active';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    INNER JOIN pg_catalog.pg_roles AS member_role
      ON member_role.oid = membership.member
    INNER JOIN pg_catalog.pg_roles AS granted_role
      ON granted_role.oid = membership.roleid
    WHERE member_role.rolname = 'campuspilot-plus'
      AND granted_role.rolname = 'campuspilot-plus-owner'
  ) THEN
    RAISE EXCEPTION 'runtime role must never be a member of the owner role';
  END IF;

  EXECUTE pg_catalog.format(
    'REVOKE ALL PRIVILEGES ON DATABASE %I FROM PUBLIC',
    target_database
  );
  EXECUTE pg_catalog.format(
    'REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I',
    target_database,
    'campuspilot-plus'
  );
  EXECUTE pg_catalog.format(
    'GRANT CONNECT ON DATABASE %I TO %I',
    target_database,
    'campuspilot-plus'
  );

  REVOKE CREATE ON SCHEMA public FROM PUBLIC;
  REVOKE ALL ON SCHEMA public FROM "campuspilot-plus";
  GRANT USAGE ON SCHEMA public TO "campuspilot-plus";

  GRANT SELECT, INSERT, UPDATE, DELETE
    ON ALL TABLES IN SCHEMA public TO "campuspilot-plus";
  GRANT USAGE, SELECT, UPDATE
    ON ALL SEQUENCES IN SCHEMA public TO "campuspilot-plus";

  ALTER DEFAULT PRIVILEGES FOR ROLE "campuspilot-plus-owner" IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "campuspilot-plus";
  ALTER DEFAULT PRIVILEGES FOR ROLE "campuspilot-plus-owner" IN SCHEMA public
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO "campuspilot-plus";

  /** Older disposable databases may still contain one-time control objects.
   * Keep them inaccessible to the runtime role without requiring them in the
   * current platform schema. */
  IF pg_catalog.to_regclass('public.legacy_migration_run') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.legacy_migration_run FROM "campuspilot-plus";
  END IF;
  IF pg_catalog.to_regprocedure('public.legacy_migration_run_guard()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.legacy_migration_run_guard()
      FROM "campuspilot-plus";
  END IF;
  IF pg_catalog.to_regprocedure('public.legacy_migration_business_writer_guard()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.legacy_migration_business_writer_guard()
      FROM "campuspilot-plus";
  END IF;
END
$runtime_grants$;
`;

/** Applies the runtime grant contract only after Drizzle finishes. */
export async function applyRuntimeDatabasePrivileges(
  database: Database,
): Promise<void> {
  await database.execute(sql.raw(CAMPUSPILOT_PLUS_RUNTIME_GRANTS_SQL));
}
