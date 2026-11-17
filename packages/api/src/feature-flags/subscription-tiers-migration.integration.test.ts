import { db } from '@campuspilot/db';
import type { DatabaseExecutor } from '@campuspilot/db';
import type { SchoolFeatureKey, SchoolTier } from '@campuspilot/db/feature-flags/catalogue';
import { readSchoolFeatureFlags } from '@campuspilot/db/feature-flags/store';
import { schoolAssistantAccessRoleTable } from '@campuspilot/db/schema/assistant';
import type { Role } from '@campuspilot/db/schema/jsonb/role';
import { schoolTable } from '@campuspilot/db/schema/school';
import { schoolFeatureFlagTable } from '@campuspilot/db/schema/school-feature-flag';
import { eq, isNull, sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cwd } from 'node:process';
import { describe, expect, it } from 'vitest';

import { createTestSchool } from '../../test/fixtures';

/**
 * Migration 0071 puts every existing school on a subscription tier and
 * rewrites its `school_feature_flag` rows as adjustments, and merges the two
 * assistant role lists into one. Its promise is that **no school gains or
 * loses a feature on deploy**.
 *
 * The test database is already migrated, so the schema statements cannot be
 * run again. What is run here is the migration's **data statements exactly
 * as the file ships them** (every UPDATE, INSERT and DELETE, in file order),
 * on schools whose rows are prepared in the shape they had before the
 * migration: no tier (`school.tier` null), `enabled` never null, a missing
 * row meaning "student management on, everything else off", no `whatsapp`
 * row.
 *
 * The statements cover every school of the shared test database, so they run
 * inside a transaction that is rolled back, and this file runs in the
 * platform-wide group, after every other file, alone.
 */
const DATA_STATEMENTS = readFileSync(resolve(cwd(), '../db/src/migrations/0071_subscription-tiers.sql'), 'utf8')
  .split('--> statement-breakpoint')
  .map((statement) =>
    statement
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
      .trim(),
  )
  .filter((statement) => /^(UPDATE|INSERT|DELETE)\b/.test(statement));

type TierFeature = Exclude<SchoolFeatureKey, 'assistant' | 'whatsapp'>;

/** A school as it was before the migration: its stored switches (a missing key is a missing row). */
async function preMigrationSchool(options: { rows?: Partial<Record<TierFeature, boolean>> } = {}) {
  const school = await createTestSchool({ tier: null });
  const rows = Object.entries(options.rows ?? {}).map(([feature, enabled]) => ({
    schoolId: school.id,
    feature: feature as TierFeature,
    enabled,
  }));
  if (rows.length) await db.insert(schoolFeatureFlagTable).values(rows);
  return school;
}

/** What the school had before tiers, by the rules of the release before this one. */
function featuresBefore(rows: Partial<Record<TierFeature, boolean>>) {
  const studentManagement = rows.studentManagement ?? true;
  return {
    studentManagement,
    cadet: (rows.cadet ?? false) && studentManagement,
    notices: (rows.notices ?? false) && studentManagement,
    // WhatsApp was not a per-school feature: every school with student management sent it.
    whatsapp: studentManagement,
  };
}

/** The school's tier, features and unusable configs; the school must exist. */
async function flagsOf(executor: DatabaseExecutor, schoolId: string) {
  const flags = await readSchoolFeatureFlags(executor, schoolId);
  if (!flags) throw new Error(`School ${schoolId} does not exist.`);
  return flags;
}

async function featuresAfter(executor: DatabaseExecutor, schoolId: string) {
  const { tier, features } = await flagsOf(executor, schoolId);
  return {
    tier,
    active: {
      studentManagement: features.studentManagement.active,
      cadet: features.cadet.active,
      notices: features.notices.active,
      whatsapp: features.whatsapp.active,
    },
    adjustments: Object.fromEntries(
      Object.entries(features)
        .filter(([, state]) => state.adjustment !== null)
        .map(([key, state]) => [key, state.adjustment]),
    ),
  };
}

const storedRows = async (executor: DatabaseExecutor, schoolId: string) =>
  (await executor.select().from(schoolFeatureFlagTable).where(eq(schoolFeatureFlagTable.schoolId, schoolId)))
    .map((row) => ({ feature: row.feature as string, enabled: row.enabled, config: row.config }))
    .sort((left, right) => left.feature.localeCompare(right.feature));

const storedRoles = async (executor: DatabaseExecutor, schoolId: string) =>
  (await executor.select().from(schoolAssistantAccessRoleTable).where(eq(schoolAssistantAccessRoleTable.schoolId, schoolId)))
    .map((row) => row.role)
    .sort();

class Rollback extends Error {}

/** Applies the migration's data statements and runs `check` on the result, then rolls everything back. */
async function afterMigration(check: (transaction: DatabaseExecutor) => Promise<void>) {
  await db
    .transaction(async (transaction) => {
      for (const statement of DATA_STATEMENTS) await transaction.execute(sql.raw(statement));
      await check(transaction);
      throw new Rollback();
    })
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
}

describe('migration 0071: subscription tiers', () => {
  it('ships the five data statements this test runs, in the order that matters', () => {
    expect(DATA_STATEMENTS.map((statement) => statement.split('\n')[0]!.trim())).toEqual([
      'UPDATE "school" AS s',
      'INSERT INTO "school_feature_flag" ("school_id", "feature", "enabled", "config", "updated_by")',
      'DELETE FROM "school_feature_flag" f',
      'DELETE FROM "school_assistant_access_role" a',
      'INSERT INTO "school_assistant_access_role" ("school_id", "role", "updated_by")',
    ]);
  });

  it('gives every existing school a tier', async () => {
    await Promise.all([preMigrationSchool(), preMigrationSchool({ rows: { studentManagement: false } })]);
    await afterMigration(async (transaction) => {
      expect(await transaction.select({ id: schoolTable.id }).from(schoolTable).where(isNull(schoolTable.tier))).toEqual([]);
    });
  });

  const SCENARIOS: {
    name: string;
    rows: Partial<Record<TierFeature, boolean>>;
    tier: SchoolTier;
    /** The adjustments left after the migration (a feature not named follows the tier). */
    adjustments: Partial<Record<SchoolFeatureKey, boolean>>;
  }[] = [
    {
      name: 'the Cadet Portal and notices in use: Enterprise, following its tier in everything',
      rows: { cadet: true, notices: true },
      tier: 'enterprise',
      adjustments: {},
    },
    {
      name: 'the Cadet Portal from the 0048 backfill and never notices: Enterprise, with notices kept off',
      rows: { cadet: true },
      tier: 'enterprise',
      adjustments: { notices: false },
    },
    {
      name: 'no stored row (student management by default): Pro, with notices kept off and WhatsApp kept on',
      rows: {},
      tier: 'pro',
      adjustments: { notices: false, whatsapp: true },
    },
    {
      name: 'student management and notices switched on explicitly, the portal switched off: Pro, with only WhatsApp kept on',
      rows: { studentManagement: true, notices: true, cadet: false },
      tier: 'pro',
      adjustments: { whatsapp: true },
    },
    {
      name: 'student management switched off: Plus, with no adjustment at all (it sent no WhatsApp)',
      rows: { studentManagement: false },
      tier: 'plus',
      adjustments: {},
    },
    {
      name: 'student management off with the portal and notices left switched on: Plus, their switches kept for when it comes back',
      rows: { studentManagement: false, cadet: true, notices: true },
      tier: 'plus',
      adjustments: { cadet: true, notices: true },
    },
  ];

  it.each(SCENARIOS)('$name', async ({ rows, tier, adjustments }) => {
    const school = await preMigrationSchool({ rows });
    await afterMigration(async (transaction) => {
      const after = await featuresAfter(transaction, school.id);
      expect(after.tier).toBe(tier);
      expect(after.adjustments).toEqual(adjustments);
      // The promise of the migration: what the school has is what it had.
      expect(after.active).toEqual(featuresBefore(rows));
      // A row is kept only where it says something the tier does not.
      expect(await storedRows(transaction, school.id)).toEqual(
        Object.entries(adjustments)
          .map(([feature, enabled]) => ({ feature, enabled, config: null }))
          .sort((left, right) => left.feature.localeCompare(right.feature)),
      );
    });
    // Rolled back: the school is as it was prepared.
    const [stored] = await db.select({ tier: schoolTable.tier }).from(schoolTable).where(eq(schoolTable.id, school.id));
    expect(stored?.tier).toBeNull();
  });

  it('leaves the assistant\'s rows exactly as they are, on or off, with their settings', async () => {
    const [on, off] = await Promise.all([
      preMigrationSchool({ rows: { cadet: true, notices: true } }),
      preMigrationSchool(),
    ]);
    const onConfig = { monthlyLimitUsd: 25, eligibleRoles: ['principal', 'teacher'], voice: { enabled: true } };
    const offConfig = { monthlyLimitUsd: null, eligibleRoles: ['manager'] };
    await db.insert(schoolFeatureFlagTable).values([
      { schoolId: on.id, feature: 'assistant', enabled: true, config: onConfig },
      { schoolId: off.id, feature: 'assistant', enabled: false, config: offConfig },
    ]);
    const assistantRow = async (executor: DatabaseExecutor, schoolId: string) =>
      (await executor.select().from(schoolFeatureFlagTable).where(eq(schoolFeatureFlagTable.schoolId, schoolId))).find(
        (row) => row.feature === 'assistant',
      );
    const before = { on: await assistantRow(db, on.id), off: await assistantRow(db, off.id) };
    await afterMigration(async (transaction) => {
      // Byte for byte: `eligibleRoles` stays in the stored config, so the previous release still reads it while this one rolls out.
      expect(await assistantRow(transaction, on.id)).toEqual(before.on);
      expect(await assistantRow(transaction, off.id)).toEqual(before.off);
      const { features: onFeatures, invalidConfigs } = await flagsOf(transaction, on.id);
      expect(invalidConfigs).toEqual([]);
      // The new schema reads the settings and ignores the old role list.
      expect(onFeatures.assistant).toEqual({
        included: false,
        adjustment: true,
        enabled: true,
        active: true,
        config: { monthlyLimitUsd: 25, voice: { enabled: true } },
      });
      expect((await flagsOf(transaction, off.id)).features.assistant).toMatchObject({ adjustment: false, enabled: false, active: false });
    });
  });

  it('keeps a row whose switch agrees with the tier when it also holds a config, as an adjustment', async () => {
    const school = await preMigrationSchool({ rows: { notices: true } });
    await db.insert(schoolFeatureFlagTable).values({ schoolId: school.id, feature: 'cadet', enabled: true, config: { kept: true } });
    await afterMigration(async (transaction) => {
      expect((await featuresAfter(transaction, school.id)).tier).toBe('enterprise');
      expect(await storedRows(transaction, school.id)).toEqual([{ feature: 'cadet', enabled: true, config: { kept: true } }]);
    });
  });

  describe('the assistant\'s role list', () => {
    /** A school whose administrator made `eligible` roles eligible and whose staff switched `switchedOn` on. */
    async function schoolWithRoles(options: { eligible: unknown; switchedOn: Role[]; enabled?: boolean; noAssistantRow?: boolean }) {
      const school = await preMigrationSchool();
      if (!options.noAssistantRow) {
        await db.insert(schoolFeatureFlagTable).values({
          schoolId: school.id,
          feature: 'assistant',
          enabled: options.enabled ?? true,
          config: options.eligible === undefined ? null : { monthlyLimitUsd: null, eligibleRoles: options.eligible },
        });
      }
      if (options.switchedOn.length) {
        await db.insert(schoolAssistantAccessRoleTable).values(options.switchedOn.map((role) => ({ schoolId: school.id, role })));
      }
      return school;
    }

    it('becomes the roles that could use the assistant, or the eligible roles where none was switched on', async () => {
      const schools = {
        // Eligible and switched on overlap: exactly the overlap, which is who could use it.
        overlap: await schoolWithRoles({ eligible: ['principal', 'teacher'], switchedOn: ['teacher', 'accountant'] }),
        // Nothing switched on by the school: what the administrator enabled is enabled.
        noneSwitchedOn: await schoolWithRoles({ eligible: ['principal', 'manager'], switchedOn: [] }),
        // Only a role that was never eligible was switched on: it granted nothing, so the eligible roles apply.
        onlyIneligible: await schoolWithRoles({ eligible: ['principal'], switchedOn: ['accountant'] }),
        // The same rule whether the assistant is on or off: the list is kept for when it is switched on.
        disabled: await schoolWithRoles({ eligible: ['teacher'], switchedOn: [], enabled: false }),
        // The school's own choice among the eligible roles is kept exactly.
        ownChoice: await schoolWithRoles({ eligible: ['principal', 'manager', 'teacher'], switchedOn: ['manager'] }),
        // No settings: no role was eligible, so nothing may start granting access.
        noConfig: await schoolWithRoles({ eligible: undefined, switchedOn: ['teacher'] }),
        noAssistantRow: await schoolWithRoles({ eligible: undefined, switchedOn: ['teacher'], noAssistantRow: true }),
        // A stored list holding something that is not a role, or not a list: only real roles are written.
        unknownRole: await schoolWithRoles({ eligible: ['janitor', 'principal'], switchedOn: [] }),
        notAList: await schoolWithRoles({ eligible: 'principal', switchedOn: ['teacher'] }),
      };
      await afterMigration(async (transaction) => {
        // One query at a time: they share the transaction's connection.
        const roles: Record<string, Role[]> = {};
        for (const [name, school] of Object.entries(schools)) roles[name] = await storedRoles(transaction, school.id);
        expect(roles).toEqual({
          overlap: ['teacher'],
          noneSwitchedOn: ['manager', 'principal'],
          onlyIneligible: ['principal'],
          disabled: ['teacher'],
          ownChoice: ['manager'],
          noConfig: [],
          noAssistantRow: [],
          unknownRole: ['principal'],
          notAList: [],
        });
      });
      // Rolled back.
      expect(await storedRoles(db, schools.overlap.id)).toEqual(['accountant', 'teacher']);
    });
  });
});
