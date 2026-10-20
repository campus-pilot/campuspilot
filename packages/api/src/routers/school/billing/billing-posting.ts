import type { Database, DatabaseExecutor, DatabaseTransaction } from "@campuspilot/db";
import { generateId } from "@campuspilot/db/id";
import { admissionTable } from "@campuspilot/db/schema/admission";
import { classTable, sectionTable } from "@campuspilot/db/schema/class";
import { currencyCodeSchema } from "@campuspilot/db/schema/jsonb/currencies";
import {
  financeAdjustmentTable,
  financeBillLineTable,
  financeBillRunTable,
  financeBillTable,
  financeLedgerEntryTable,
} from "@campuspilot/db/schema/finance";
import { financeTimeZoneSchema } from "@campuspilot/db/schema/jsonb/finance-config";
import { schoolSessionTable } from "@campuspilot/db/schema/session";
import { studentTable } from "@campuspilot/db/schema/student";
import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNull,
  or,
} from "drizzle-orm";
import { z } from "zod";

import { rpcError } from "../../../errors";
import {
  lockFinanceAdmissionAccount,
  lockFinanceAdmissionAccounts,
} from "./account-lock";
import {
  findBoundedBillingCandidates,
  hashBillingReview,
  MAX_BILLING_RUN_ADMISSIONS,
  prepareBillingRun,
  type BillingRunDraft,
} from "./billing-readiness";
import {
  appendFinanceLedgerEntries,
  appendFinanceLedgerEntry,
} from "./ledger-posting";
import { allocateFinanceNumber, reserveFinanceNumbers } from "./numbering";
import { localDateToInstant } from "./period";
import {
  checkedFinanceAddition,
  serializeFinanceInteger,
} from "./transport";

type PostBillingRunCommand = BillingRunDraft & {
  expectedConfigurationHash: string;
  idempotencyKey: string;
  kind: "regular" | "supplemental";
  supplementalReason?: string;
};

type ManualBillCommand = {
  schoolId: string;
  sessionId: string;
  admissionId: string;
  issueDate: string;
  reason: string;
  idempotencyKey: string;
  lines: Array<{ title: string; amountMinor: string }>;
};

const manualBillFinanceContextSchema = z.object({
  currency: currencyCodeSchema,
  timeZone: financeTimeZoneSchema,
});

type ReverseBillCommand = {
  schoolId: string;
  sessionId: string;
  admissionId: string;
  billId: string;
  effectiveAt: Date;
  reason: string;
  idempotencyKey: string;
};

function commandHash(value: unknown): string {
  return hashBillingReview(value);
}

async function lockBillingScope(
  transaction: DatabaseTransaction,
  draft: BillingRunDraft,
) {
  const [session] = await transaction
    .select({ id: schoolSessionTable.id })
    .from(schoolSessionTable)
    .where(
      and(
        eq(schoolSessionTable.schoolId, draft.schoolId),
        eq(schoolSessionTable.id, draft.sessionId),
      ),
    )
    .for("update")
    .limit(1);
  if (!session) throw rpcError.notFound("School session");

  const enrolled = await findBoundedBillingCandidates(transaction, draft);
  if (enrolled.length > MAX_BILLING_RUN_ADMISSIONS) {
    throw rpcError.badRequest(
      `A billing run may contain at most ${MAX_BILLING_RUN_ADMISSIONS} candidate admissions. Narrow the selection before posting.`,
    );
  }
  const admissionIds = new Set(enrolled.map(({ admissionId }) => admissionId));
  if (draft.admissionIds?.length) {
    const knownAdmissions = await transaction
      .select({ id: admissionTable.id })
      .from(admissionTable)
      .where(
        and(
          eq(admissionTable.schoolId, draft.schoolId),
          inArray(admissionTable.id, draft.admissionIds),
        ),
      )
      .orderBy(asc(admissionTable.id));
    for (const { id } of knownAdmissions) admissionIds.add(id);
  }
  await lockFinanceAdmissionAccounts(
    transaction,
    draft.schoolId,
    [...admissionIds],
  );
  if (enrolled.length) {
    await transaction
      .select({ id: studentTable.id })
      .from(studentTable)
      .where(
        inArray(
          studentTable.id,
          enrolled.map(({ enrollmentId }) => enrollmentId).sort(),
        ),
      )
      .orderBy(asc(studentTable.id))
      .for("update");
  }
}

function runTransport(run: typeof financeBillRunTable.$inferSelect, reversedBillCount = 0) {
  return {
    ...run,
    totalAmountMinor: serializeFinanceInteger(run.totalAmountMinor),
    reversedBillCount,
    fullyReversed: run.billCount > 0 && reversedBillCount === run.billCount,
  };
}

async function readExistingRun(
  transaction: DatabaseExecutor,
  schoolId: string,
  idempotencyKey: string,
) {
  const [run] = await transaction
    .select()
    .from(financeBillRunTable)
    .where(
      and(
        eq(financeBillRunTable.schoolId, schoolId),
        eq(financeBillRunTable.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return run;
}

async function readRunReversedCount(
  transaction: DatabaseExecutor,
  schoolId: string,
  runId: string,
): Promise<number> {
  const [row] = await transaction
    .select({ value: count() })
    .from(financeBillTable)
    .innerJoin(
      financeLedgerEntryTable,
      and(
        eq(
          financeLedgerEntryTable.reversalOfEntryId,
          financeBillTable.ledgerEntryId,
        ),
        eq(financeLedgerEntryTable.schoolId, financeBillTable.schoolId),
      ),
    )
    .where(
      and(
        eq(financeBillTable.schoolId, schoolId),
        eq(financeBillTable.billRunId, runId),
      ),
    );
  return row?.value ?? 0;
}

/** Posts a reviewed regular or reasoned supplemental run in one transaction. */
export async function postPreparedBillingRun(
  db: Database,
  command: PostBillingRunCommand,
  recordedBy: string,
) {
  return db.transaction(
    async (transaction) => {
      await lockBillingScope(transaction, command);
      const payloadHash = commandHash({
        draft: {
          schoolId: command.schoolId,
          sessionId: command.sessionId,
          billingDate: command.billingDate,
          admissionIds: command.admissionIds?.slice().sort() ?? null,
          classIds: command.classIds?.slice().sort() ?? null,
          runValues: command.runValues,
        },
        expectedConfigurationHash: command.expectedConfigurationHash,
        kind: command.kind,
        supplementalReason: command.supplementalReason ?? null,
      });
      const existing = await readExistingRun(
        transaction,
        command.schoolId,
        command.idempotencyKey,
      );
      if (existing) {
        if (existing.inputSnapshot.commandPayloadHash !== payloadHash) {
          throw rpcError.conflict(
            "This billing-run idempotency key was already used with a different payload.",
          );
        }
        return runTransport(
          existing,
          await readRunReversedCount(transaction, command.schoolId, existing.id),
        );
      }

      const prepared = await prepareBillingRun(transaction, command);
      if (prepared.configurationHash !== command.expectedConfigurationHash) {
        throw rpcError.conflict(
          "Finance configuration, enrollment, selection, or run values changed. Review the refreshed billing preview before posting.",
        );
      }
      if (!prepared.readyToPost || !prepared.period || !prepared.currency || !prepared.sessionSnapshot) {
        throw rpcError.badRequest(
          "Billing readiness contains blocking issues. Resolve them and review the preview again.",
        );
      }
      if (command.kind === "regular") {
        const [samePeriod] = await transaction
          .select({ id: financeBillRunTable.id })
          .from(financeBillRunTable)
          .where(
            and(
              eq(financeBillRunTable.schoolId, command.schoolId),
              eq(financeBillRunTable.sessionId, command.sessionId),
              eq(financeBillRunTable.periodKey, prepared.period.key),
              eq(financeBillRunTable.kind, "regular"),
            ),
          )
          .limit(1);
        if (samePeriod) {
          throw rpcError.conflict(
            "A regular billing run already exists for this session and period. Use a reasoned supplemental run for an additional legitimate charge.",
          );
        }
      }

      const [run] = await transaction
        .insert(financeBillRunTable)
        .values({
          schoolId: command.schoolId,
          sessionId: command.sessionId,
          kind: command.kind,
          periodKey: prepared.period.key,
          periodStartDate: prepared.period.startDate,
          periodEndDate: prepared.period.endDate,
          periodStartAt: prepared.period.startAt,
          periodEndAt: prepared.period.endAt,
          issueDate: command.billingDate,
          timeZone: prepared.period.timeZone,
          cadence: prepared.period.cadence,
          currency: prepared.currency,
          configHash: prepared.configurationHash,
          configSnapshot: prepared.configSnapshot,
          inputSnapshot: {
            ...prepared.inputSnapshot,
            commandPayloadHash: payloadHash,
          },
          totalAmountMinor: prepared.totalAmountMinor,
          billCount: prepared.eligible.length,
          supplementalReason: command.supplementalReason ?? null,
          idempotencyKey: command.idempotencyKey,
          recordedBy,
        })
        .returning();
      if (!run) throw new Error("Billing run was not created");

      const effectiveAt = localDateToInstant(
        command.billingDate,
        prepared.period.timeZone,
      );
      await insertRunBillsBatched(
        transaction,
        run.id,
        command,
        prepared,
        effectiveAt,
        recordedBy,
      );

      const finalizedAt = new Date();
      const [posted] = await transaction
        .update(financeBillRunTable)
        .set({ status: "posted", finalizedAt })
        .where(eq(financeBillRunTable.id, run.id))
        .returning();
      if (!posted) throw new Error("Billing run was not finalized");
      return runTransport(posted);
    },
    { isolationLevel: "serializable" },
  );
}

const RUN_WRITE_CHUNK_SIZE = 300;

function writeChunks<T>(values: T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += RUN_WRITE_CHUNK_SIZE) {
    result.push(values.slice(index, index + RUN_WRITE_CHUNK_SIZE));
  }
  return result;
}

/**
 * Persists a reviewed run in bounded set-based writes. The database triggers
 * still validate every immutable bill and line, while network round trips grow
 * by chunk count rather than one posting pipeline per admission.
 */
async function insertRunBillsBatched(
  transaction: DatabaseTransaction,
  runId: string,
  command: PostBillingRunCommand,
  prepared: Awaited<ReturnType<typeof prepareBillingRun>>,
  effectiveAt: Date,
  recordedBy: string,
) {
  const { currency, period, sessionSnapshot } = prepared;
  if (!currency || !period || !sessionSnapshot) {
    throw new Error("Prepared billing run is incomplete");
  }
  const entries = await appendFinanceLedgerEntries(
    transaction,
    prepared.eligible.map((admission) => ({
      schoolId: command.schoolId,
      admissionId: admission.admissionId,
      sessionId: command.sessionId,
      type: "bill" as const,
      direction: "debit" as const,
      amountMinor: admission.totalAmountMinor,
      currency,
      effectiveAt,
      recordedBy,
      idempotencyKey: `billing-run:${runId}:${admission.admissionId}`,
    })),
  );
  const billNumbers = await reserveFinanceNumbers(transaction, {
    schoolId: command.schoolId,
    sessionId: command.sessionId,
    kind: "bill",
    count: prepared.eligible.length,
  });
  const bills = prepared.eligible.map((admission, index) => ({
    id: generateId("financeBill"),
    schoolId: command.schoolId,
    admissionId: admission.admissionId,
    sessionId: command.sessionId,
    billRunId: runId,
    ledgerEntryId: entries[index]!.id,
    sourceKind: "billing_run" as const,
    billNumber: billNumbers[index]!.number,
    issueDate: command.billingDate,
    periodKey: period.key,
    currency,
    totalAmountMinor: admission.totalAmountMinor,
    lineCount: admission.lines.length,
    admissionNumberSnapshot: admission.admissionNumber,
    admissionNameSnapshot: admission.admissionName,
    sessionStartYearSnapshot: sessionSnapshot.startYear,
    sessionEndYearSnapshot: sessionSnapshot.endYear,
    enrollmentIdSnapshot: admission.enrollmentId,
    classIdSnapshot: admission.classId,
    classSlugSnapshot: admission.classSlug,
    classLabelSnapshot: admission.classLabel,
    sectionIdSnapshot: admission.sectionId,
    sectionSlugSnapshot: admission.sectionSlug,
    sectionLabelSnapshot: admission.sectionLabel,
    rollNumberSnapshot: admission.rollNumber,
    configHash: prepared.configurationHash,
    recordedBy,
  }));
  for (const group of writeChunks(bills)) {
    await transaction.insert(financeBillTable).values(group);
  }
  const lines = prepared.eligible.flatMap((admission, admissionIndex) =>
    admission.lines.map((line, lineOrder) => ({
      id: generateId("financeBillLine"),
      schoolId: command.schoolId,
      billId: bills[admissionIndex]!.id,
      lineOrder,
      feeElementSlug: line.feeElementSlug,
      feeElementName: line.feeElementName,
      amountMinor: line.amountMinor,
      currency,
      pricingSourceKind: line.pricingSourceKind,
      pricingSourceKey: line.pricingSourceKey,
      pricingRuleSnapshot: line.pricingRuleSnapshot,
    })),
  );
  for (const group of writeChunks(lines)) {
    await transaction.insert(financeBillLineTable).values(group);
  }
  const finalizedAt = new Date();
  for (const group of writeChunks(bills)) {
    await transaction
      .update(financeBillTable)
      .set({ status: "posted", finalizedAt })
      .where(inArray(financeBillTable.id, group.map(({ id }) => id)));
  }
}

async function readManualBillByIdempotency(
  db: DatabaseExecutor,
  schoolId: string,
  idempotencyKey: string,
) {
  const [row] = await db
    .select({ bill: financeBillTable, ledger: financeLedgerEntryTable })
    .from(financeLedgerEntryTable)
    .innerJoin(
      financeBillTable,
      eq(financeBillTable.ledgerEntryId, financeLedgerEntryTable.id),
    )
    .where(
      and(
        eq(financeLedgerEntryTable.schoolId, schoolId),
        eq(financeLedgerEntryTable.type, "manual_debit_adjustment"),
        eq(financeLedgerEntryTable.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  if (!row) return null;
  const lines = await db
    .select()
    .from(financeBillLineTable)
    .where(eq(financeBillLineTable.billId, row.bill.id))
    .orderBy(asc(financeBillLineTable.lineOrder));
  const [reversal] = await db
    .select({ id: financeLedgerEntryTable.id })
    .from(financeLedgerEntryTable)
    .where(
      and(
        eq(financeLedgerEntryTable.schoolId, schoolId),
        eq(
          financeLedgerEntryTable.reversalOfEntryId,
          row.bill.ledgerEntryId,
        ),
      ),
    )
    .limit(1);
  return { ...row, lines, reversed: Boolean(reversal) };
}

function manualBillTransport(
  value: NonNullable<Awaited<ReturnType<typeof readManualBillByIdempotency>>>,
) {
  return {
    ...value.bill,
    totalAmountMinor: serializeFinanceInteger(value.bill.totalAmountMinor),
    reversed: value.reversed,
    lines: value.lines.map((line) => ({
      ...line,
      amountMinor: serializeFinanceInteger(line.amountMinor),
    })),
  };
}

/** Creates one ordinary, enrollment-backed manual bill. */
export async function createPostedManualBill(
  db: Database,
  command: ManualBillCommand,
  recordedBy: string,
) {
  return db.transaction(
    async (transaction) => {
      const [session] = await transaction
        .select({
          startYear: schoolSessionTable.sessionStartYear,
          endYear: schoolSessionTable.sessionEndYear,
          financeConfig: schoolSessionTable.financeConfig,
        })
        .from(schoolSessionTable)
        .where(
          and(
            eq(schoolSessionTable.schoolId, command.schoolId),
            eq(schoolSessionTable.id, command.sessionId),
          ),
        )
        .for("update")
        .limit(1);
      if (!session) throw rpcError.notFound("School session");
      await lockFinanceAdmissionAccount(
        transaction,
        command.schoolId,
        command.admissionId,
      );

      const existing = await readManualBillByIdempotency(
        transaction,
        command.schoolId,
        command.idempotencyKey,
      );
      if (existing) {
        const sameLines =
          existing.lines.length === command.lines.length &&
          existing.lines.every(
            (line, index) =>
              line.feeElementName === command.lines[index]?.title &&
              line.amountMinor === BigInt(command.lines[index]!.amountMinor),
          );
        if (
          existing.bill.admissionId !== command.admissionId ||
          existing.bill.sessionId !== command.sessionId ||
          existing.bill.issueDate !== command.issueDate ||
          existing.bill.manualReason !== command.reason ||
          existing.ledger.note !== command.reason ||
          !sameLines
        ) {
          throw rpcError.conflict(
            "This manual-bill idempotency key was already used with a different payload.",
          );
        }
        return manualBillTransport(existing);
      }

      const config = manualBillFinanceContextSchema.safeParse(
        session.financeConfig,
      );
      if (!config.success) {
        throw rpcError.badRequest(
          "Configure the session finance currency and timezone before posting a manual bill.",
        );
      }
      const [account] = await transaction
        .select({
          admissionNumber: admissionTable.admissionNo,
          admissionName: admissionTable.name,
          registered: admissionTable.registered,
          enrollmentId: studentTable.id,
          classId: studentTable.classId,
          classSlug: classTable.slug,
          classLabel: classTable.label,
          sectionId: studentTable.sectionId,
          sectionSlug: sectionTable.slug,
          sectionLabel: sectionTable.label,
          rollNumber: studentTable.rollNo,
        })
        .from(admissionTable)
        .innerJoin(
          studentTable,
          and(
            eq(studentTable.schoolId, admissionTable.schoolId),
            eq(studentTable.admissionId, admissionTable.id),
            eq(studentTable.sessionId, command.sessionId),
          ),
        )
        .leftJoin(
          classTable,
          and(
            eq(classTable.id, studentTable.classId),
            eq(classTable.schoolId, studentTable.schoolId),
          ),
        )
        .leftJoin(
          sectionTable,
          and(
            eq(sectionTable.id, studentTable.sectionId),
            eq(sectionTable.schoolId, studentTable.schoolId),
          ),
        )
        .where(
          and(
            eq(admissionTable.schoolId, command.schoolId),
            eq(admissionTable.id, command.admissionId),
          ),
        )
        .for("update", { of: studentTable })
        .limit(1);
      if (!account) throw rpcError.notFound("Admission enrollment");
      if (!account.registered) {
        throw rpcError.conflict(
          "Ordinary manual bills cannot be posted to an unregistered admission.",
        );
      }
      if (!account.classId || !account.classSlug || !account.classLabel) {
        throw rpcError.badRequest(
          "The admission requires a class placement before an ordinary manual bill can be posted.",
        );
      }
      let totalAmountMinor = BigInt(0);
      try {
        for (const line of command.lines) {
          totalAmountMinor = checkedFinanceAddition(
            totalAmountMinor,
            BigInt(line.amountMinor),
          );
        }
      } catch {
        throw rpcError.badRequest(
          "Manual bill total exceeds the supported exact amount range.",
        );
      }
      const effectiveAt = localDateToInstant(
        command.issueDate,
        config.data.timeZone,
      );
      const ledger = await appendFinanceLedgerEntry(transaction, {
        schoolId: command.schoolId,
        admissionId: command.admissionId,
        sessionId: command.sessionId,
        type: "manual_debit_adjustment",
        direction: "debit",
        amountMinor: totalAmountMinor,
        currency: config.data.currency,
        effectiveAt,
        recordedBy,
        note: command.reason,
        idempotencyKey: command.idempotencyKey,
      });
      const billNumber = await allocateFinanceNumber(transaction, {
        schoolId: command.schoolId,
        sessionId: command.sessionId,
        kind: "bill",
      });
      const configHash = commandHash(session.financeConfig);
      const [bill] = await transaction
        .insert(financeBillTable)
        .values({
          schoolId: command.schoolId,
          admissionId: command.admissionId,
          sessionId: command.sessionId,
          ledgerEntryId: ledger.id,
          sourceKind: "manual",
          billNumber: billNumber.number,
          issueDate: command.issueDate,
          currency: config.data.currency,
          totalAmountMinor,
          lineCount: command.lines.length,
          admissionNumberSnapshot: account.admissionNumber,
          admissionNameSnapshot: account.admissionName,
          sessionStartYearSnapshot: session.startYear,
          sessionEndYearSnapshot: session.endYear,
          enrollmentIdSnapshot: account.enrollmentId,
          classIdSnapshot: account.classId,
          classSlugSnapshot: account.classSlug,
          classLabelSnapshot: account.classLabel,
          sectionIdSnapshot: account.sectionId,
          sectionSlugSnapshot: account.sectionSlug,
          sectionLabelSnapshot: account.sectionLabel,
          rollNumberSnapshot: account.rollNumber,
          configHash,
          manualReason: command.reason,
          recordedBy,
        })
        .returning();
      if (!bill) throw new Error("Manual bill was not created");
      await transaction.insert(financeBillLineTable).values(
        command.lines.map((line, lineOrder) => ({
          schoolId: command.schoolId,
          billId: bill.id,
          lineOrder,
          // Manual items are not fee elements. This internal compatibility key
          // preserves the immutable bill-line/report shape; the title is the
          // authoritative customer-facing label and report grouping dimension.
          feeElementSlug: "manual-item",
          feeElementName: line.title,
          amountMinor: BigInt(line.amountMinor),
          currency: config.data.currency,
          pricingSourceKind: "manual" as const,
          pricingSourceKey: `manual:${command.idempotencyKey}:${lineOrder}`,
          pricingRuleSnapshot: {
            title: line.title,
            amountMinor: line.amountMinor,
            currency: config.data.currency,
            timeZone: config.data.timeZone,
            reason: command.reason,
          },
          manualReason: command.reason,
        })),
      );
      await transaction
        .update(financeBillTable)
        .set({ status: "posted", finalizedAt: new Date() })
        .where(eq(financeBillTable.id, bill.id));
      const created = await readManualBillByIdempotency(
        transaction,
        command.schoolId,
        command.idempotencyKey,
      );
      if (!created) throw new Error("Manual bill could not be read after posting");
      return manualBillTransport(created);
    },
    { isolationLevel: "serializable" },
  );
}

async function assertBillCanReverse(
  transaction: DatabaseExecutor,
  input: { schoolId: string; billId: string; ledgerEntryId: string },
) {
  // A transaction owns one PostgreSQL client, so these checks intentionally
  // run sequentially instead of issuing concurrent queries on that client.
  const existingReversal = await transaction
    .select()
    .from(financeLedgerEntryTable)
    .where(
      and(
        eq(financeLedgerEntryTable.schoolId, input.schoolId),
        eq(financeLedgerEntryTable.reversalOfEntryId, input.ledgerEntryId),
      ),
    )
    .limit(1);
  const liveAdjustment = await transaction
    .select({ id: financeAdjustmentTable.id })
    .from(financeAdjustmentTable)
    .leftJoin(
      financeLedgerEntryTable,
      and(
        eq(
          financeLedgerEntryTable.reversalOfEntryId,
          financeAdjustmentTable.ledgerEntryId,
        ),
        eq(financeLedgerEntryTable.schoolId, financeAdjustmentTable.schoolId),
      ),
    )
    .where(
      and(
        eq(financeAdjustmentTable.schoolId, input.schoolId),
        eq(financeAdjustmentTable.billId, input.billId),
        inArray(financeAdjustmentTable.kind, [
          "discount",
          "waiver",
          "write_off",
          "credit_correction",
        ]),
        isNull(financeLedgerEntryTable.id),
      ),
    )
    .limit(1);
  if (liveAdjustment.length) {
    throw rpcError.conflict(
      "This bill has live credit adjustments. Reverse or coordinate those facts before reversing the bill.",
    );
  }
  return existingReversal[0] ?? null;
}

function reversalTransport(
  bill: typeof financeBillTable.$inferSelect,
  reversal: typeof financeLedgerEntryTable.$inferSelect,
) {
  return {
    billId: bill.id,
    ledgerEntryId: bill.ledgerEntryId,
    reversalEntryId: reversal.id,
    amountMinor: serializeFinanceInteger(reversal.amountMinor),
    currency: reversal.currency,
    recordedAt: reversal.recordedAt,
  };
}

async function reverseBillInTransaction(
  transaction: DatabaseTransaction,
  command: ReverseBillCommand,
  recordedBy: string,
) {
  const storedIdempotencyKey = `bill-reversal:${command.idempotencyKey}`;
  const [bill] = await transaction
    .select()
    .from(financeBillTable)
    .where(
      and(
        eq(financeBillTable.schoolId, command.schoolId),
        eq(financeBillTable.sessionId, command.sessionId),
        eq(financeBillTable.admissionId, command.admissionId),
        eq(financeBillTable.id, command.billId),
        eq(financeBillTable.status, "posted"),
      ),
    )
    .for("update")
    .limit(1);
  if (!bill) throw rpcError.notFound("Bill");
  const [sameKey] = await transaction
    .select()
    .from(financeLedgerEntryTable)
    .where(
      and(
        eq(financeLedgerEntryTable.schoolId, command.schoolId),
        eq(financeLedgerEntryTable.type, "reversal"),
        eq(financeLedgerEntryTable.idempotencyKey, storedIdempotencyKey),
      ),
    )
    .limit(1);
  if (sameKey) {
    if (
      sameKey.reversalOfEntryId !== bill.ledgerEntryId ||
      sameKey.effectiveAt.getTime() !== command.effectiveAt.getTime() ||
      sameKey.note !== command.reason
    ) {
      throw rpcError.conflict(
        "This reversal idempotency key was already used with a different payload.",
      );
    }
    return reversalTransport(bill, sameKey);
  }
  const existingReversal = await assertBillCanReverse(transaction, {
    schoolId: command.schoolId,
    billId: bill.id,
    ledgerEntryId: bill.ledgerEntryId,
  });
  if (existingReversal) {
    throw rpcError.conflict("This bill has already been reversed.");
  }
  const reversal = await appendFinanceLedgerEntry(transaction, {
    schoolId: command.schoolId,
    admissionId: command.admissionId,
    sessionId: command.sessionId,
    type: "reversal",
    direction: "credit",
    amountMinor: bill.totalAmountMinor,
    currency: bill.currency,
    effectiveAt: command.effectiveAt,
    recordedBy,
    note: command.reason,
    reversalOfEntryId: bill.ledgerEntryId,
    idempotencyKey: storedIdempotencyKey,
  });
  return reversalTransport(bill, reversal);
}

/** Appends the exact opposite ledger fact for one unsettled bill. */
export async function reversePostedBill(
  db: Database,
  command: ReverseBillCommand,
  recordedBy: string,
) {
  return db.transaction(
    async (transaction) => {
      const [session] = await transaction
        .select({ id: schoolSessionTable.id })
        .from(schoolSessionTable)
        .where(
          and(
            eq(schoolSessionTable.schoolId, command.schoolId),
            eq(schoolSessionTable.id, command.sessionId),
          ),
        )
        .for("update")
        .limit(1);
      if (!session) throw rpcError.notFound("School session");
      await lockFinanceAdmissionAccount(
        transaction,
        command.schoolId,
        command.admissionId,
      );
      return reverseBillInTransaction(transaction, command, recordedBy);
    },
    { isolationLevel: "serializable" },
  );
}

/** Reverses every member only after all members pass the same settlement guard. */
export async function reversePostedBillingRun(
  db: Database,
  command: {
    schoolId: string;
    sessionId: string;
    billRunId: string;
    effectiveAt: Date;
    reason: string;
    idempotencyKey: string;
  },
  recordedBy: string,
) {
  return db.transaction(
    async (transaction) => {
      const [session] = await transaction
        .select({ id: schoolSessionTable.id })
        .from(schoolSessionTable)
        .where(
          and(
            eq(schoolSessionTable.schoolId, command.schoolId),
            eq(schoolSessionTable.id, command.sessionId),
          ),
        )
        .for("update")
        .limit(1);
      if (!session) throw rpcError.notFound("School session");
      let [run] = await transaction
        .select({
          id: financeBillRunTable.id,
          currency: financeBillRunTable.currency,
          totalAmountMinor: financeBillRunTable.totalAmountMinor,
        })
        .from(financeBillRunTable)
        .where(
          and(
            eq(financeBillRunTable.schoolId, command.schoolId),
            eq(financeBillRunTable.sessionId, command.sessionId),
            eq(financeBillRunTable.id, command.billRunId),
            eq(financeBillRunTable.status, "posted"),
          ),
        )
        .limit(1);
      if (!run) throw rpcError.notFound("Billing run");
      let bills = await transaction
        .select()
        .from(financeBillTable)
        .where(
          and(
            eq(financeBillTable.schoolId, command.schoolId),
            eq(financeBillTable.sessionId, command.sessionId),
            eq(financeBillTable.billRunId, command.billRunId),
          ),
        )
        .orderBy(asc(financeBillTable.admissionId), asc(financeBillTable.id));
      await lockFinanceAdmissionAccounts(
        transaction,
        command.schoolId,
        bills.map(({ admissionId }) => admissionId),
      );
      [run] = await transaction
        .select({
          id: financeBillRunTable.id,
          currency: financeBillRunTable.currency,
          totalAmountMinor: financeBillRunTable.totalAmountMinor,
        })
        .from(financeBillRunTable)
        .where(
          and(
            eq(financeBillRunTable.schoolId, command.schoolId),
            eq(financeBillRunTable.sessionId, command.sessionId),
            eq(financeBillRunTable.id, command.billRunId),
            eq(financeBillRunTable.status, "posted"),
          ),
        )
        .for("update")
        .limit(1);
      if (!run) throw rpcError.notFound("Billing run");
      bills = await transaction
        .select()
        .from(financeBillTable)
        .where(
          and(
            eq(financeBillTable.schoolId, command.schoolId),
            eq(financeBillTable.sessionId, command.sessionId),
            eq(financeBillTable.billRunId, command.billRunId),
          ),
        )
        .orderBy(asc(financeBillTable.admissionId), asc(financeBillTable.id))
        .for("update");
      // Read child idempotency, target reversal, and settlement state in a
      // bounded set of queries rather than issuing several queries per bill.
      const prepared = bills.map((bill) => ({
        bill,
        idempotencyKey: `run-reversal:${command.billRunId}:${command.idempotencyKey}:${bill.id}`,
      }));
      const billIds = bills.map(({ id }) => id);
      const ledgerEntryIds = bills.map(({ ledgerEntryId }) => ledgerEntryId);
      const childKeys = prepared.map(({ idempotencyKey }) => idempotencyKey);
      const reversalRows = await transaction
        .select()
        .from(financeLedgerEntryTable)
        .where(
          and(
            eq(financeLedgerEntryTable.schoolId, command.schoolId),
            eq(financeLedgerEntryTable.type, "reversal"),
            or(
              inArray(
                financeLedgerEntryTable.reversalOfEntryId,
                ledgerEntryIds,
              ),
              inArray(financeLedgerEntryTable.idempotencyKey, childKeys),
            ),
          ),
        );
      const adjustmentRows = await transaction
        .select({ billId: financeAdjustmentTable.billId })
        .from(financeAdjustmentTable)
        .leftJoin(
          financeLedgerEntryTable,
          and(
            eq(
              financeLedgerEntryTable.reversalOfEntryId,
              financeAdjustmentTable.ledgerEntryId,
            ),
            eq(
              financeLedgerEntryTable.schoolId,
              financeAdjustmentTable.schoolId,
            ),
          ),
        )
        .where(
          and(
            eq(financeAdjustmentTable.schoolId, command.schoolId),
            inArray(financeAdjustmentTable.billId, billIds),
            inArray(financeAdjustmentTable.kind, [
              "discount",
              "waiver",
              "write_off",
              "credit_correction",
            ]),
            isNull(financeLedgerEntryTable.id),
          ),
        );
      const reversalByKey = new Map(
        reversalRows.map((row) => [row.idempotencyKey, row]),
      );
      const reversalByTarget = new Map(
        reversalRows.flatMap((row) =>
          row.reversalOfEntryId ? [[row.reversalOfEntryId, row] as const] : [],
        ),
      );
      const settledBillIds = new Set(
        adjustmentRows.flatMap(({ billId }) => (billId ? [billId] : [])),
      );
      const validated = prepared.map((item) => {
        const existing = reversalByKey.get(item.idempotencyKey) ?? null;
        if (
          existing &&
          (existing.reversalOfEntryId !== item.bill.ledgerEntryId ||
            existing.effectiveAt.getTime() !== command.effectiveAt.getTime() ||
            existing.note !== command.reason)
        ) {
          throw rpcError.conflict(
            "This run-reversal idempotency key was already used with a different payload.",
          );
        }
        const targetReversal = reversalByTarget.get(item.bill.ledgerEntryId);
        if (targetReversal && targetReversal.id !== existing?.id) {
          throw rpcError.conflict(
            "The billing run cannot be reversed atomically because one of its bills was already reversed separately.",
          );
        }
        if (settledBillIds.has(item.bill.id)) {
          throw rpcError.conflict(
            "The billing run cannot be reversed atomically because one of its bills has live settlement facts.",
          );
        }
        return { ...item, existing };
      });

      const existingChildCount = validated.filter(({ existing }) => existing).length;
      if (existingChildCount !== 0 && existingChildCount !== validated.length) {
        throw rpcError.conflict(
          "A partial run-reversal retry was detected; no additional reversal facts were adopted or written.",
        );
      }

      const reversals = existingChildCount
        ? validated.map(({ existing }) => existing!)
        : await appendFinanceLedgerEntries(
            transaction,
            validated.map((item) => ({
              schoolId: command.schoolId,
              admissionId: item.bill.admissionId,
              sessionId: command.sessionId,
              type: "reversal" as const,
              direction: "credit" as const,
              amountMinor: item.bill.totalAmountMinor,
              currency: item.bill.currency,
              effectiveAt: command.effectiveAt,
              recordedBy,
              note: command.reason,
              reversalOfEntryId: item.bill.ledgerEntryId,
              idempotencyKey: item.idempotencyKey,
            })),
          );
      return {
        billRunId: command.billRunId,
        reversedBillCount: reversals.length,
        totalAmountMinor: serializeFinanceInteger(run.totalAmountMinor),
        currency: run.currency,
        recordedAt:
          reversals.reduce<Date | null>(
            (latest, reversal) =>
              !latest || reversal.recordedAt > latest
                ? reversal.recordedAt
                : latest,
            null,
          ) ?? new Date(),
      };
    },
    { isolationLevel: "serializable" },
  );
}
