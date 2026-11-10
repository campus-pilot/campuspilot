import { db } from '@campuspilot/db';
import { schoolFeatureFlagTable } from '@campuspilot/db/schema/school-feature-flag';
import { createRouterClient } from '@orpc/server';
import { eq, sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cwd } from 'node:process';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { expectFeatureDisabled, expectPermissionDenied } from '../../../../test/feature-flags';
import { expectRpcCode } from '../../../../test/finance/assertions';
import {
  createAdminSession,
  createHandlerContext,
  createRegularUserSession,
  createSchoolStaffSession,
  createTestClient,
  createTestSchool,
  setTestSchoolFeature,
} from '../../../../test/fixtures';
import {
  getSchoolFeature,
  getSchoolFeatureFlags,
  isSchoolFeatureEnabled,
  setSchoolFeature,
} from '../../../feature-flags/feature-flags.service';
import { protectedProcedure } from '../../../index';
import { requireSchoolFeature } from '../../../permissions/feature';
import { requireSchoolMember } from '../../../permissions/school-member';

const OFF = { enabled: false, config: null };
const ON = { enabled: true, config: null };

describe('school feature flag storage', () => {
  it('reads a school without rows as every feature disabled', async () => {
    const school = await createTestSchool();
    expect(await getSchoolFeatureFlags(db, school.id)).toEqual({ cadet: OFF, notices: OFF });
    expect(await getSchoolFeature(db, school.id, 'cadet')).toEqual(OFF);
    expect(await isSchoolFeatureEnabled(db, school.id, 'notices')).toBe(false);
    expect(await isSchoolFeatureEnabled(db, 'sch_missing', 'cadet')).toBe(false);
  });

  it('stores each feature and school independently and records who changed it', async () => {
    const [school, other] = await Promise.all([createTestSchool(), createTestSchool()]);
    const admin = await createAdminSession();
    await setSchoolFeature(db, { schoolId: school.id, feature: 'notices', enabled: true, config: null, updatedBy: admin.user.id });

    expect(await getSchoolFeatureFlags(db, school.id)).toEqual({ cadet: OFF, notices: ON });
    expect(await getSchoolFeatureFlags(db, other.id)).toEqual({ cadet: OFF, notices: OFF });
    const rows = await db.select().from(schoolFeatureFlagTable).where(eqSchool(school.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ feature: 'notices', enabled: true, config: null, updatedBy: admin.user.id });

    // Replacing keeps one row per (school, feature).
    await setSchoolFeature(db, { schoolId: school.id, feature: 'notices', enabled: false, config: null, updatedBy: null });
    const replaced = await db.select().from(schoolFeatureFlagTable).where(eqSchool(school.id));
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).toMatchObject({ enabled: false, updatedBy: null });
    expect(await isSchoolFeatureEnabled(db, school.id, 'notices')).toBe(false);
  });

  it('refuses a config that does not match the feature and writes nothing', async () => {
    const school = await createTestSchool();
    await expect(
      setSchoolFeature(db, { schoolId: school.id, feature: 'cadet', enabled: true, config: { nope: 1 } as never, updatedBy: null }),
    ).rejects.toThrow();
    expect(await db.select().from(schoolFeatureFlagTable).where(eqSchool(school.id))).toEqual([]);
  });

  it('ignores rows of a retired feature key and fails loudly on a stored config that no longer fits', async () => {
    const school = await createTestSchool({ features: ['cadet'] });
    await db.insert(schoolFeatureFlagTable).values({ schoolId: school.id, feature: 'retired-feature' as never, enabled: true });
    expect(await getSchoolFeatureFlags(db, school.id)).toEqual({ cadet: ON, notices: OFF });

    await db.insert(schoolFeatureFlagTable).values({ schoolId: school.id, feature: 'notices', enabled: true, config: { stale: true } });
    await expect(getSchoolFeature(db, school.id, 'notices')).rejects.toThrow();
  });
});

describe('migration 0048 backfill', () => {
  /** The backfill statement exactly as the migration file ships it. */
  const backfill = readFileSync(
    resolve(cwd(), '../db/src/migrations/0048_school-feature-flags.sql'),
    'utf8',
  )
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .find((statement) => statement.includes('INSERT INTO "school_feature_flag"'))!;

  it('enables cadet (and only cadet) for schools that existed before flags, without touching decided ones', async () => {
    const [untouched, decided] = await Promise.all([createTestSchool(), createTestSchool()]);
    await setTestSchoolFeature(decided.id, 'cadet', false);

    // Run inside a transaction that is rolled back: the statement covers
    // every school of the shared test database.
    class Rollback extends Error {}
    await db
      .transaction(async (transaction) => {
        await transaction.execute(sql.raw(backfill));
        await transaction.execute(sql.raw(backfill));
        expect(await getSchoolFeatureFlags(transaction, untouched.id)).toEqual({ cadet: ON, notices: OFF });
        const rows = await transaction.select().from(schoolFeatureFlagTable).where(eqSchool(untouched.id));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ feature: 'cadet', enabled: true, config: null, updatedBy: null });
        // An existing row is never overwritten.
        expect(await getSchoolFeatureFlags(transaction, decided.id)).toEqual({ cadet: OFF, notices: OFF });
        throw new Rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });
    expect(await getSchoolFeatureFlags(db, untouched.id)).toEqual({ cadet: OFF, notices: OFF });
  });
});

describe('school.getFeatureFlags', () => {
  it('rejects anonymous callers and anyone who is not a member of the school', async () => {
    const [school, otherSchool] = await Promise.all([createTestSchool({ features: ['cadet'] }), createTestSchool()]);
    const outsider = await createSchoolStaffSession(otherSchool.id, [{ role: 'principal', meta: null }]);

    await expectRpcCode(createTestClient(null).school.getFeatureFlags({ schoolId: school.id }), 'UNAUTHORIZED');
    await expectRpcCode(createTestClient(outsider.session).school.getFeatureFlags({ schoolId: school.id }), 'FORBIDDEN');
    await expectRpcCode(createTestClient(await createRegularUserSession()).school.getFeatureFlags({ schoolId: school.id }), 'FORBIDDEN');
    // Platform administrators read flags through systemAdmin, not as members.
    await expectRpcCode(createTestClient(await createAdminSession()).school.getFeatureFlags({ schoolId: school.id }), 'FORBIDDEN');
  });

  it('validates the school id', async () => {
    const client = createTestClient(await createRegularUserSession());
    await expectRpcCode(client.school.getFeatureFlags({ schoolId: '' }), 'BAD_REQUEST');
    await expectRpcCode(client.school.getFeatureFlags({} as never), 'BAD_REQUEST');
  });

  it('returns every feature to any member, whatever their role, following later changes', async () => {
    const school = await createTestSchool({ features: ['cadet'] });
    const staffOfEveryKind = await Promise.all([
      createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }]),
      createSchoolStaffSession(school.id, [{ role: 'teacher', meta: { classIds: [] } }]),
      createSchoolStaffSession(school.id, [{ role: 'accountant', meta: null }]),
    ]);
    for (const staff of staffOfEveryKind) {
      expect(await createTestClient(staff.session).school.getFeatureFlags({ schoolId: school.id })).toEqual({
        schoolId: school.id,
        features: { cadet: ON, notices: OFF },
      });
    }

    const teacher = await createSchoolStaffSession(school.id, [{ role: 'teacher', meta: { classIds: [] } }]);
    await setTestSchoolFeature(school.id, 'notices', true);
    await setTestSchoolFeature(school.id, 'cadet', false);
    expect((await createTestClient(teacher.session).school.getFeatureFlags({ schoolId: school.id })).features).toEqual({
      cadet: OFF,
      notices: ON,
    });
  });
});

/**
 * `requireSchoolFeature` on a probe procedure shaped like the notices
 * procedures later phases add (membership check, then the feature).
 */
describe('requireSchoolFeature', () => {
  const probe = protectedProcedure
    .input(z.object({ schoolId: z.string().min(1) }))
    .use(requireSchoolMember())
    .use(requireSchoolFeature('notices'))
    .handler(({ context }) => context.feature);

  async function callProbe(session: Parameters<typeof createHandlerContext>[0], schoolId: string) {
    return createRouterClient({ probe }, { context: createHandlerContext(session) }).probe({ schoolId });
  }

  it('refuses a school without the feature with the feature-disabled error', async () => {
    const school = await createTestSchool({ features: ['cadet'] });
    const staff = await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }]);
    await expectFeatureDisabled(callProbe(staff.session, school.id), 'notices');

    // An explicitly disabled row behaves like a missing one.
    await setTestSchoolFeature(school.id, 'notices', false);
    await expectFeatureDisabled(callProbe(staff.session, school.id), 'notices');
  });

  it('hands the handler the typed state once the feature is enabled, per school', async () => {
    const [school, other] = await Promise.all([createTestSchool(), createTestSchool({ features: ['notices'] })]);
    const staff = await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }]);
    await expectFeatureDisabled(callProbe(staff.session, school.id), 'notices');
    await setTestSchoolFeature(school.id, 'notices', true);
    expect(await callProbe(staff.session, school.id)).toEqual({ enabled: true, config: null });
    // Another school's flag never applies.
    await setTestSchoolFeature(school.id, 'notices', false);
    await expectFeatureDisabled(callProbe(staff.session, school.id), 'notices');
    expect(await isSchoolFeatureEnabled(db, other.id, 'notices')).toBe(true);
  });

  it('lets the permission check answer first, so outsiders cannot probe a school\'s features', async () => {
    const [school, otherSchool] = await Promise.all([createTestSchool(), createTestSchool()]);
    const outsider = await createSchoolStaffSession(otherSchool.id, [{ role: 'principal', meta: null }]);
    await expectPermissionDenied(callProbe(outsider.session, school.id));
    await setTestSchoolFeature(school.id, 'notices', true);
    await expectPermissionDenied(callProbe(outsider.session, school.id));
    await expectRpcCode(callProbe(null, school.id), 'UNAUTHORIZED');
  });
});

describe('Cadet Portal settings need the cadet feature', () => {
  it('refuses reading and updating the settings while the feature is off', async () => {
    const school = await createTestSchool();
    const principal = createTestClient((await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }])).session);
    await expectFeatureDisabled(principal.school.getCadetPortalSettings({ schoolId: school.id }), 'cadet');
    await expectFeatureDisabled(principal.school.updateCadetPortalSettings({ schoolId: school.id, showClassAverages: true }), 'cadet');

    await setTestSchoolFeature(school.id, 'cadet', true);
    expect(await principal.school.getCadetPortalSettings({ schoolId: school.id })).toEqual({ schoolId: school.id, showClassAverages: false });
    expect(await principal.school.updateCadetPortalSettings({ schoolId: school.id, showClassAverages: true })).toEqual({ schoolId: school.id, showClassAverages: true });

    // Disabling keeps the stored setting but closes both procedures again.
    await setTestSchoolFeature(school.id, 'cadet', false);
    await expectFeatureDisabled(principal.school.getCadetPortalSettings({ schoolId: school.id }), 'cadet');
  });

  it('still answers a caller without the permission with a plain FORBIDDEN', async () => {
    const [school, otherSchool] = await Promise.all([createTestSchool(), createTestSchool()]);
    const outsider = createTestClient((await createSchoolStaffSession(otherSchool.id, [{ role: 'principal', meta: null }])).session);
    await expectPermissionDenied(outsider.school.getCadetPortalSettings({ schoolId: school.id }));
  });
});

function eqSchool(schoolId: string) {
  return eq(schoolFeatureFlagTable.schoolId, schoolId);
}
