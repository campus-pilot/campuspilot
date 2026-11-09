import { db } from '@campuspilot/db';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { dataMigrationSkippedItemTable } from '@campuspilot/db/schema/data-migration';
import { eq, inArray } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { createTestAdmission, createTestSchool, createTestUser } from '../../../test/fixtures';
import { runDataMigrationBatches } from '../../workflows/data-migration/workflow';
import { loadDataMigrationRun, requestDataMigrationRun, startDataMigrationRun } from '../run-store';
import { admissionPhoneE164Migration } from './admission-phone-e164';

/**
 * Runs the real backfill over the whole test database, so this file is in
 * the platform-wide group that runs after every other file (vitest.config.ts).
 */
const directStep = <T,>(_name: string, action: () => Promise<T>) => action();

async function runMigration(dryRun: boolean) {
  const user = await createTestUser();
  const run = await requestDataMigrationRun(db, { migrationId: admissionPhoneE164Migration.id, dryRun, requestedBy: user.id });
  await startDataMigrationRun(run!.id);
  await runDataMigrationBatches({ runId: run!.id, migration: { ...admissionPhoneE164Migration, batchSize: 3 }, step: directStep });
  return (await loadDataMigrationRun(run!.id))!;
}

describe('admission phone backfill (data migration)', () => {
  const ids: Record<string, string> = {};

  async function rows() {
    const found = await db.select().from(admissionTable).where(inArray(admissionTable.id, Object.values(ids)));
    return Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, found.find((row) => row.id === id)!]));
  }

  beforeAll(async () => {
    const school = await createTestSchool();
    const legacy = async (key: string, phoneNo: string, extra: Partial<typeof admissionTable.$inferInsert> = {}) => {
      const admission = await createTestAdmission({ schoolId: school.id });
      await db.update(admissionTable).set({ phoneNo, whatsappSameAsPhone: null, ...extra }).where(eq(admissionTable.id, admission.id));
      ids[key] = admission.id;
    };
    await legacy('plain', '9876543210');
    await legacy('spaced', '098765 43210');
    await legacy('foreign', '+1 415 555 2671');
    await legacy('twoNumbers', '9876543210 / 9123456789');
    await legacy('consented', '9123456789', { whatsappConsent: true });
    await legacy('blank', '  ');
    // Recorded after Phase 1b: never touched by the backfill.
    await legacy('recorded', '+919000000001', { whatsappSameAsPhone: false, whatsappNo: '+14155552671', whatsappVerified: true });
  });

  it('dry run reports what it would do and changes nothing', async () => {
    const before = await rows();
    const run = await runMigration(true);
    expect(run).toMatchObject({ status: 'completed', dryRun: true });
    expect(run.changedCount).toBeGreaterThanOrEqual(4);
    expect(run.skippedCount).toBeGreaterThanOrEqual(1);
    expect(await rows()).toEqual(before);
  });

  it('backfills E.164 numbers and WhatsApp facts, reports unparseable values, and is idempotent', async () => {
    const run = await runMigration(false);
    expect(run.status).toBe('completed');
    const reasons = await db.select().from(dataMigrationSkippedItemTable).where(eq(dataMigrationSkippedItemTable.runId, run.id));
    expect(reasons.find((item) => item.itemKey === ids.blank)?.reason).toBe('blank_phone');
    expect(reasons.find((item) => item.itemKey === ids.twoNumbers)?.reason).toBe('unparseable_phone');
    const after = await rows();
    expect(after.plain).toMatchObject({ phoneNo: '+919876543210', whatsappNo: '+919876543210', whatsappSameAsPhone: true, whatsappVerified: false, whatsappConsent: false });
    expect(after.spaced).toMatchObject({ phoneNo: '+919876543210', whatsappNo: '+919876543210', whatsappSameAsPhone: true });
    expect(after.foreign).toMatchObject({ phoneNo: '+14155552671', whatsappNo: '+14155552671', whatsappSameAsPhone: true });
    expect(after.twoNumbers).toMatchObject({ phoneNo: '+919876543210 / 9123456789', whatsappNo: null, whatsappSameAsPhone: false, whatsappVerified: false });
    // An explicitly recorded consent is kept.
    expect(after.consented).toMatchObject({ phoneNo: '+919123456789', whatsappConsent: true, whatsappVerified: false });
    expect(after.blank).toMatchObject({ phoneNo: '  ', whatsappNo: null, whatsappSameAsPhone: false, whatsappVerified: false });
    expect(after.recorded).toMatchObject({ phoneNo: '+919000000001', whatsappNo: '+14155552671', whatsappSameAsPhone: false, whatsappVerified: true });

    const again = await runMigration(false);
    expect(again).toMatchObject({ status: 'completed', changedCount: 0, skippedCount: 0 });
    expect(await rows()).toEqual(after);
  });
});
