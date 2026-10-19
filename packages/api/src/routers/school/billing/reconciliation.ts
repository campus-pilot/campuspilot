import type { Database, DatabaseExecutor } from "@campuspilot/db";
import {
  financeAdmissionBalanceTable,
  financeAdmissionSessionActivityTable,
  financeLedgerEntryTable,
} from "@campuspilot/db/schema/finance";
import { and, asc, eq } from "drizzle-orm";
import { lockFinanceAdmissionAccount } from "./account-lock";
import { serializeProjectionTotals } from "./transport";

export type AdmissionProjectionKey = {
  schoolId: string;
  admissionId: string;
  currency: string;
};

type ProjectionTotals = {
  lastSequence: bigint;
  entryCount: bigint;
  debitTotalMinor: bigint;
  creditTotalMinor: bigint;
};

function emptyProjection(): ProjectionTotals {
  return {
    lastSequence: 0n,
    entryCount: 0n,
    debitTotalMinor: 0n,
    creditTotalMinor: 0n,
  };
}

/**
 * Folds immutable entries with bigint arithmetic. This is the single
 * projection definition shared by rebuilding and reconciliation.
 */
export function foldAdmissionLedger(
  entries: Array<{
    sessionId: string;
    sequence: bigint;
    direction: "debit" | "credit";
    amountMinor: bigint;
  }>,
): { lifetime: ProjectionTotals; sessions: Map<string, ProjectionTotals> } {
  const lifetime = emptyProjection();
  const sessions = new Map<string, ProjectionTotals>();

  for (const entry of entries) {
    lifetime.entryCount += 1n;
    lifetime.lastSequence = entry.sequence;
    lifetime[entry.direction === "debit" ? "debitTotalMinor" : "creditTotalMinor"] +=
      entry.amountMinor;

    const session = sessions.get(entry.sessionId) ?? emptyProjection();
    session.entryCount += 1n;
    session.lastSequence = entry.sequence;
    session[entry.direction === "debit" ? "debitTotalMinor" : "creditTotalMinor"] +=
      entry.amountMinor;
    sessions.set(entry.sessionId, session);
  }

  return { lifetime, sessions };
}

async function readLedger(db: DatabaseExecutor, key: AdmissionProjectionKey) {
  return db
    .select({
      sessionId: financeLedgerEntryTable.sessionId,
      sequence: financeLedgerEntryTable.sequence,
      direction: financeLedgerEntryTable.direction,
      amountMinor: financeLedgerEntryTable.amountMinor,
    })
    .from(financeLedgerEntryTable)
    .where(
      and(
        eq(financeLedgerEntryTable.schoolId, key.schoolId),
        eq(financeLedgerEntryTable.admissionId, key.admissionId),
        eq(financeLedgerEntryTable.currency, key.currency),
      ),
    )
    .orderBy(asc(financeLedgerEntryTable.sequence));
}

/** Atomically replaces both projection caches from the immutable ledger. */
export async function rebuildAdmissionProjection(
  db: Database,
  key: AdmissionProjectionKey,
) {
  return db.transaction(async (transaction) => {
    await lockFinanceAdmissionAccount(transaction, key.schoolId, key.admissionId);
    const entries = await readLedger(transaction, key);
    const expected = foldAdmissionLedger(entries);

    await transaction
      .delete(financeAdmissionSessionActivityTable)
      .where(
        and(
          eq(financeAdmissionSessionActivityTable.schoolId, key.schoolId),
          eq(
            financeAdmissionSessionActivityTable.admissionId,
            key.admissionId,
          ),
          eq(financeAdmissionSessionActivityTable.currency, key.currency),
        ),
      );
    await transaction
      .delete(financeAdmissionBalanceTable)
      .where(
        and(
          eq(financeAdmissionBalanceTable.schoolId, key.schoolId),
          eq(financeAdmissionBalanceTable.admissionId, key.admissionId),
          eq(financeAdmissionBalanceTable.currency, key.currency),
        ),
      );

    if (expected.lifetime.entryCount > 0n) {
      await transaction.insert(financeAdmissionBalanceTable).values({
        ...key,
        lastSequence: expected.lifetime.lastSequence,
        debitTotalMinor: expected.lifetime.debitTotalMinor,
        creditTotalMinor: expected.lifetime.creditTotalMinor,
      });
      await transaction.insert(financeAdmissionSessionActivityTable).values(
        [...expected.sessions].map(([sessionId, totals]) => ({
          ...key,
          sessionId,
          ...totals,
        })),
      );
    }

    return serializeProjection(expected);
  });
}

function serializeProjection(value: {
  lifetime: ProjectionTotals;
  sessions: Map<string, ProjectionTotals>;
}) {
  return {
    lifetime: serializeProjectionTotals(value.lifetime),
    sessions: [...value.sessions].map(([sessionId, totals]) => ({
      sessionId,
      ...serializeProjectionTotals(totals),
    })),
  };
}

/** Reports projection drift without mutating either cache or source facts. */
export async function reconcileAdmissionProjection(
  db: Database,
  key: AdmissionProjectionKey,
) {
  return db.transaction(
    async (transaction) => {
      // A transaction owns one PostgreSQL client; serialize its reads while the
      // repeatable-read isolation level keeps all three on the same snapshot.
      const entries = await readLedger(transaction, key);
      const balances = await transaction
        .select()
        .from(financeAdmissionBalanceTable)
        .where(
          and(
            eq(financeAdmissionBalanceTable.schoolId, key.schoolId),
            eq(financeAdmissionBalanceTable.admissionId, key.admissionId),
            eq(financeAdmissionBalanceTable.currency, key.currency),
          ),
        );
      const activities = await transaction
        .select()
        .from(financeAdmissionSessionActivityTable)
        .where(
          and(
            eq(financeAdmissionSessionActivityTable.schoolId, key.schoolId),
            eq(
              financeAdmissionSessionActivityTable.admissionId,
              key.admissionId,
            ),
            eq(financeAdmissionSessionActivityTable.currency, key.currency),
          ),
        );
      const expected = foldAdmissionLedger(entries);
      const actualLifetime = balances[0] ?? null;
      const actualSessions = new Map(
        activities.map((activity) => [activity.sessionId, activity]),
      );
      const isEmpty = expected.lifetime.entryCount === 0n;
      const lifetimeMatches = isEmpty
        ? actualLifetime === null
        : actualLifetime !== null &&
          actualLifetime.lastSequence === expected.lifetime.lastSequence &&
          actualLifetime.debitTotalMinor === expected.lifetime.debitTotalMinor &&
          actualLifetime.creditTotalMinor === expected.lifetime.creditTotalMinor;
      const sessionsMatch =
        actualSessions.size === expected.sessions.size &&
        [...expected.sessions].every(([sessionId, totals]) => {
          const actual = actualSessions.get(sessionId);
          return (
            actual?.lastSequence === totals.lastSequence &&
            actual.entryCount === totals.entryCount &&
            actual.debitTotalMinor === totals.debitTotalMinor &&
            actual.creditTotalMinor === totals.creditTotalMinor
          );
        });

      return {
        matches: lifetimeMatches && sessionsMatch,
        expected: serializeProjection(expected),
        actual: {
          lifetime: actualLifetime
            ? serializeProjectionTotals({
                ...actualLifetime,
                entryCount: expected.lifetime.entryCount,
              })
            : null,
          sessions: [...actualSessions].map(([sessionId, totals]) => ({
            sessionId,
            ...serializeProjectionTotals(totals),
          })),
        },
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
