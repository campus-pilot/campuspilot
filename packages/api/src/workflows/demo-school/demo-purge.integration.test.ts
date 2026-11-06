import { db } from '@campuspilot/db';
import { user } from '@campuspilot/db/schema/auth';
import { schoolTable } from '@campuspilot/db/schema/school';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestUser } from '../../../test/fixtures';
import { retryFinanceConflict } from '../../../test/finance/assertions';
import { createFinanceIdempotencyKey } from '../../../test/finance/factories';
import { createFinanceScenario, type FinanceScenario } from '../../../test/finance/scenario';

/** Every table with a `school_id` foreign key to `school` (checked against pg_constraint). */
async function rowsReferencingSchool(schoolId: string) {
  const tables = await db.execute<{ table_name: string }>(sql`
    SELECT conrelid::regclass::text AS table_name
    FROM pg_constraint
    WHERE contype = 'f' AND confrelid = 'school'::regclass
  `);
  const counts: Record<string, number> = {};
  for (const { table_name } of tables.rows) {
    const column = table_name === '"user"' ? 'demo_school_id' : 'school_id';
    const result = await db.execute<{ count: string }>(
      sql.raw(`SELECT count(*)::text AS count FROM ${table_name} WHERE "${column}" = '${schoolId.replaceAll("'", "''")}'`),
    );
    counts[table_name] = Number(result.rows[0]!.count);
  }
  return counts;
}

async function postFinanceHistory(scenario: FinanceScenario, suffix: string) {
  const client = scenario.actors.accountant.client.school;
  const bill = await retryFinanceConflict(() => client.createManualBill({
    schoolId: scenario.school.id,
    sessionId: scenario.activeSession.id,
    admissionId: scenario.admission.id,
    issueDate: '2040-05-01',
    reason: `Purge test ${suffix}`,
    idempotencyKey: createFinanceIdempotencyKey(`bill-${suffix}`),
    lines: [{ title: 'Tuition charge', amountMinor: '10000' }],
  }));
  await retryFinanceConflict(() => client.recordPayment({
    schoolId: scenario.school.id,
    admissionId: scenario.admission.id,
    sessionId: scenario.activeSession.id,
    amountMinor: '4000',
    currency: 'INR',
    method: 'cash',
    receivedAt: '2040-05-02T10:00:00Z',
    effectiveAt: '2040-05-02T10:00:00Z',
    idempotencyKey: createFinanceIdempotencyKey(`payment-${suffix}`),
  }));
  await retryFinanceConflict(() => client.recordAdjustment({
    schoolId: scenario.school.id,
    admissionId: scenario.admission.id,
    sessionId: scenario.activeSession.id,
    currency: 'INR',
    kind: 'discount',
    calculation: { kind: 'fixed', amountMinor: '500' },
    reasonCode: 'sibling',
    reasonNote: 'Sibling discount',
    effectiveAt: '2040-05-03T10:00:00Z',
    idempotencyKey: createFinanceIdempotencyKey(`adjustment-${suffix}`),
  }));
  return bill;
}

describe('purge_demo_school and the demo-only finance exception', () => {
  let demo: FinanceScenario;
  let real: FinanceScenario;

  beforeEach(async () => {
    [demo, real] = await Promise.all([createFinanceScenario(), createFinanceScenario()]);
    await db.update(schoolTable).set({ isDemo: true }).where(eq(schoolTable.id, demo.school.id));
    // Serializable finance postings conflict when run concurrently; post in turn.
    await postFinanceHistory(demo, 'demo');
    await postFinanceHistory(real, 'real');
  });

  it('removes every row and demo-only account of a demo school but keeps real accounts', async () => {
    const demoUser = await createTestUser({ name: 'Demo teacher' });
    await db.update(user).set({ demoSchoolId: demo.school.id }).where(eq(user.id, demoUser.id));
    const principalId = demo.actors.principal.session.user.id;

    const result = await db.execute<{ counts: Record<string, number> }>(
      sql`SELECT purge_demo_school(${demo.school.id}) AS counts`,
    );
    expect(result.rows[0]!.counts).toMatchObject({ finance_payment: 1, finance_bill: 1, user: 1, school_member: expect.any(Number) });

    const remaining = await rowsReferencingSchool(demo.school.id);
    expect(Object.values(remaining).every((count) => count === 0)).toBe(true);
    expect(await db.select().from(schoolTable).where(eq(schoolTable.id, demo.school.id))).toHaveLength(0);
    expect(await db.select().from(user).where(eq(user.id, demoUser.id))).toHaveLength(0);
    // Ordinary accounts (including staff and the platform admin) survive; only memberships go.
    expect(await db.select().from(user).where(eq(user.id, principalId))).toHaveLength(1);
    // The real school is untouched.
    const realRows = await rowsReferencingSchool(real.school.id);
    expect(realRows.finance_payment).toBe(1);
  });

  it('refuses to purge a real school', async () => {
    await expect(db.execute(sql`SELECT purge_demo_school(${real.school.id})`)).rejects.toThrow();
    expect((await rowsReferencingSchool(real.school.id)).finance_bill).toBe(1);
  });

  it('keeps real-school finance facts append-only even with a forged purge marker', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`INSERT INTO demo_purge_marker (transaction_id, school_id) VALUES (txid_current(), ${real.school.id})`);
        await tx.execute(sql`DELETE FROM finance_payment WHERE school_id = ${real.school.id}`);
      }),
    ).rejects.toThrow();
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`INSERT INTO demo_purge_marker (transaction_id, school_id) VALUES (txid_current(), ${real.school.id})`);
        await tx.execute(sql`DELETE FROM finance_bill WHERE school_id = ${real.school.id}`);
      }),
    ).rejects.toThrow();
  });

  it('binds the exception to purge_demo_school, not to a marker or the old setting', async () => {
    // A hand-written marker outside purge_demo_school() is not enough: the
    // helper also requires the function on the call stack.
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`INSERT INTO demo_purge_marker (transaction_id, school_id) VALUES (txid_current(), ${demo.school.id})`);
        await tx.execute(sql`DELETE FROM finance_payment WHERE school_id = ${demo.school.id}`);
      }),
    ).rejects.toThrow();
    // The former placeholder setting no longer grants anything.
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL campuspilot.demo_purge_school_id = ${sql.raw(`'${demo.school.id}'`)}`);
        await tx.execute(sql`DELETE FROM finance_payment WHERE school_id = ${demo.school.id}`);
      }),
    ).rejects.toThrow();
    // The function leaves no marker behind.
    await db.execute(sql`SELECT purge_demo_school(${demo.school.id})`);
    const markers = await db.execute<{ count: string }>(sql`SELECT count(*)::text AS count FROM demo_purge_marker`);
    expect(markers.rows[0]!.count).toBe('0');
  });

  it('rejects demo finance deletes outside a purge and all updates even inside one', async () => {
    await expect(db.execute(sql`DELETE FROM finance_payment WHERE school_id = ${demo.school.id}`)).rejects.toThrow();
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`INSERT INTO demo_purge_marker (transaction_id, school_id) VALUES (txid_current(), ${demo.school.id})`);
        await tx.execute(sql`UPDATE finance_payment SET note = 'changed' WHERE school_id = ${demo.school.id}`);
      }),
    ).rejects.toThrow();
    // A marker for another school never unlocks this demo school's facts.
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`INSERT INTO demo_purge_marker (transaction_id, school_id) VALUES (txid_current(), ${real.school.id})`);
        await tx.execute(sql`DELETE FROM finance_payment WHERE school_id = ${demo.school.id}`);
      }),
    ).rejects.toThrow();
  });
});
