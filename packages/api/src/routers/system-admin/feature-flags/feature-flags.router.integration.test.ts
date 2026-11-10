import { db } from '@campuspilot/db';
import { schoolFeatureFlagTable } from '@campuspilot/db/schema/school-feature-flag';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { expectRpcCode } from '../../../../test/finance/assertions';
import {
  createAdminSession,
  createRegularUserSession,
  createSchoolStaffSession,
  createTestClient,
  createTestSchool,
  type UserSession,
} from '../../../../test/fixtures';

const OFF = { enabled: false, config: null };
const ON = { enabled: true, config: null };

describe('systemAdmin school feature flags', () => {
  let admin: UserSession;
  let regular: UserSession;

  beforeAll(async () => {
    [admin, regular] = await Promise.all([createAdminSession(), createRegularUserSession()]);
  });

  describe('authentication and authorization', () => {
    it('rejects anonymous callers', async () => {
      const school = await createTestSchool();
      const client = createTestClient(null);
      await expectRpcCode(client.systemAdmin.getSchoolFeatureFlags({ id: school.id }), 'UNAUTHORIZED');
      await expectRpcCode(
        client.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'cadet', enabled: true, config: null }),
        'UNAUTHORIZED',
      );
    });

    it("rejects ordinary users and the school's own principal, and changes nothing", async () => {
      const school = await createTestSchool();
      const principal = await createSchoolStaffSession(school.id, [{ role: 'principal', meta: null }]);
      for (const session of [regular, principal.session]) {
        const client = createTestClient(session);
        await expectRpcCode(client.systemAdmin.getSchoolFeatureFlags({ id: school.id }), 'FORBIDDEN');
        await expectRpcCode(
          client.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'notices', enabled: true, config: null }),
          'FORBIDDEN',
        );
      }
      expect(await db.select().from(schoolFeatureFlagTable).where(eq(schoolFeatureFlagTable.schoolId, school.id))).toEqual([]);
    });
  });

  describe('input validation', () => {
    it('rejects a missing id, an unknown feature and a config of the wrong shape', async () => {
      const school = await createTestSchool();
      const client = createTestClient(admin);
      await expectRpcCode(client.systemAdmin.getSchoolFeatureFlags({ id: '' }), 'BAD_REQUEST');
      await expectRpcCode(
        client.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'unknown', enabled: true, config: null } as never),
        'BAD_REQUEST',
      );
      await expectRpcCode(
        client.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'cadet', enabled: true, config: { any: 1 } } as never),
        'BAD_REQUEST',
      );
      await expectRpcCode(
        client.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'cadet', enabled: 'yes', config: null } as never),
        'BAD_REQUEST',
      );
      await expectRpcCode(
        client.systemAdmin.updateSchoolFeatureFlag({ feature: 'cadet', enabled: true, config: null } as never),
        'BAD_REQUEST',
      );
      expect(await db.select().from(schoolFeatureFlagTable).where(eq(schoolFeatureFlagTable.schoolId, school.id))).toEqual([]);
    });
  });

  describe('domain behaviour and persistence', () => {
    it('answers NOT_FOUND for a school that does not exist', async () => {
      const client = createTestClient(admin);
      await expectRpcCode(client.systemAdmin.getSchoolFeatureFlags({ id: 'sch_missing' }), 'NOT_FOUND');
      await expectRpcCode(
        client.systemAdmin.updateSchoolFeatureFlag({ id: 'sch_missing', feature: 'cadet', enabled: true, config: null }),
        'NOT_FOUND',
      );
    });

    it('reads a new school as every feature disabled', async () => {
      const school = await createTestSchool();
      expect(await createTestClient(admin).systemAdmin.getSchoolFeatureFlags({ id: school.id })).toEqual({
        schoolId: school.id,
        features: { cadet: OFF, notices: OFF },
      });
    });

    it('a school created through addSchool starts with no feature enabled', async () => {
      const client = createTestClient(admin);
      const created = await client.systemAdmin.addSchool({
        slug: `flags-${crypto.randomUUID().toLowerCase()}`,
        name: 'Flag School',
        location: 'Town',
      });
      expect((await client.systemAdmin.getSchoolFeatureFlags({ id: created.id })).features).toEqual({ cadet: OFF, notices: OFF });
    });

    it('enables and disables one feature at a time and records the administrator', async () => {
      const [school, other] = await Promise.all([createTestSchool(), createTestSchool()]);
      const client = createTestClient(admin);

      expect(
        await client.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'notices', enabled: true, config: null }),
      ).toEqual({ schoolId: school.id, features: { cadet: OFF, notices: ON } });
      expect(
        await client.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'cadet', enabled: true, config: null }),
      ).toEqual({ schoolId: school.id, features: { cadet: ON, notices: ON } });

      const rows = await db.select().from(schoolFeatureFlagTable).where(eq(schoolFeatureFlagTable.schoolId, school.id));
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.enabled && row.updatedBy === admin.user.id)).toBe(true);

      expect(
        await client.systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'notices', enabled: false, config: null }),
      ).toEqual({ schoolId: school.id, features: { cadet: ON, notices: OFF } });
      // Disabling keeps the row (explicitly disabled), one per feature.
      expect(await db.select().from(schoolFeatureFlagTable).where(eq(schoolFeatureFlagTable.schoolId, school.id))).toHaveLength(2);
      // Another school is never touched.
      expect((await client.systemAdmin.getSchoolFeatureFlags({ id: other.id })).features).toEqual({ cadet: OFF, notices: OFF });
    });

    it("is what the school's staff then read", async () => {
      const school = await createTestSchool();
      const teacher = await createSchoolStaffSession(school.id, [{ role: 'teacher', meta: { classIds: [] } }]);
      await createTestClient(admin).systemAdmin.updateSchoolFeatureFlag({ id: school.id, feature: 'notices', enabled: true, config: null });
      expect((await createTestClient(teacher.session).school.getFeatureFlags({ schoolId: school.id })).features).toEqual({
        cadet: OFF,
        notices: ON,
      });
    });
  });
});
