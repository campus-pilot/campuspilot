import type { DatabaseExecutor } from "@campuspilot/db";
import { currencyMinorUnitDigits, currencyCodeSchema } from "@campuspilot/db/schema/jsonb/currencies";
import {
  financeBillLineTable,
  financeBillTable,
  financeAdjustmentTable,
  financeLedgerEntryTable,
  financePaymentTable,
  financeRefundTable,
} from "@campuspilot/db/schema/finance";
import { schoolTable } from "@campuspilot/db/schema/school";
import { schoolSessionTable } from "@campuspilot/db/schema/session";
import { financeSchemaConfigSchema } from "@campuspilot/db/schema/jsonb/finance-config";
import { and, asc, eq, inArray, lt, lte } from "drizzle-orm";
import { createHash } from "node:crypto";
import { rpcError } from "../../../errors";
import type { DocumentSource } from "./document.dto";
import { documentImage } from "./document.storage";
import { isValidLocalDate, localDateToInstant } from "../billing/period";

type FinanceSource = Extract<DocumentSource, { documentType: "bill" | "receipt" | "statement" }>;
const SOURCE_QUERY_CHUNK = 500;

function chunks<T>(values: T[], size = SOURCE_QUERY_CHUNK) {
  const groups: T[][] = [];
  for (let index = 0; index < values.length; index += size) groups.push(values.slice(index, index + size));
  return groups;
}

export function formatDocumentMoney(value: bigint, currency: string) {
  const digits = currencyMinorUnitDigits(currencyCodeSchema.parse(currency));
  const sign = value < BigInt(0) ? "-" : "";
  const absolute = value < BigInt(0) ? -value : value;
  if (digits === 0) return `${sign}${absolute}`;
  const scale = BigInt(10) ** BigInt(digits);
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(digits, "0");
  return `${sign}${whole}.${fraction}`;
}

const amount = formatDocumentMoney;

const signed = (entry: { direction: "debit" | "credit"; amountMinor: bigint }) =>
  entry.direction === "debit" ? entry.amountMinor : -entry.amountMinor;

async function balanceAt(
  db: DatabaseExecutor,
  schoolId: string,
  admissionId: string,
  currency: string,
  sequence: bigint,
) {
  const rows = await db.select({ direction: financeLedgerEntryTable.direction, amountMinor: financeLedgerEntryTable.amountMinor })
    .from(financeLedgerEntryTable)
    .where(and(
      eq(financeLedgerEntryTable.schoolId, schoolId),
      eq(financeLedgerEntryTable.admissionId, admissionId),
      eq(financeLedgerEntryTable.currency, currency),
      lte(financeLedgerEntryTable.sequence, sequence),
    ));
  return rows.reduce((total, row) => total + signed(row), BigInt(0));
}

async function schoolContext(db: DatabaseExecutor, schoolId: string) {
  const [school] = await db.select().from(schoolTable).where(eq(schoolTable.id, schoolId)).limit(1);
  if (!school) throw rpcError.notFound("School");
  return {
    name: school.name,
    location: school.location,
    registrationNo: school.registrationNo,
    logoUrl: await documentImage(school.logoS3Key),
  };
}

/** Builds finance documents only from immutable posted facts and their captured
 * identity/configuration snapshots. It deliberately never joins current
 * admissions, enrollments, classes, sections, session finance configuration,
 * or projection caches. */
export async function buildFinanceDocumentContexts(
  db: DatabaseExecutor,
  schoolId: string,
  source: FinanceSource,
) {
  const school = await schoolContext(db, schoolId);
  if (source.documentType === "bill") {
    const bills = await db.select().from(financeBillTable).where(and(
      eq(financeBillTable.schoolId, schoolId),
      eq(financeBillTable.sessionId, source.sessionId),
      eq(financeBillTable.status, "posted"),
      source.billRunId
        ? eq(financeBillTable.billRunId, source.billRunId)
        : inArray(financeBillTable.id, source.billIds!),
    ));
    if (!bills.length || (source.billIds && bills.length !== new Set(source.billIds).size)) throw rpcError.notFound("Posted bill");
    if (source.billRunId && bills.some((bill) => bill.billRunId !== source.billRunId)) throw rpcError.notFound("Posted billing run");
    const billIds = bills.map((bill) => bill.id);
    const ledgerIds = bills.map((bill) => bill.ledgerEntryId);
    const [lineGroups, ledgerGroups] = await Promise.all([
      Promise.all(chunks(billIds).map((ids) => db.select().from(financeBillLineTable).where(and(eq(financeBillLineTable.schoolId, schoolId), inArray(financeBillLineTable.billId, ids))).orderBy(asc(financeBillLineTable.billId), asc(financeBillLineTable.lineOrder)))),
      Promise.all(chunks(ledgerIds).map((ids) => db.select().from(financeLedgerEntryTable).where(and(eq(financeLedgerEntryTable.schoolId, schoolId), inArray(financeLedgerEntryTable.id, ids))))),
    ]);
    const lines = lineGroups.flat();
    const ledgers = ledgerGroups.flat();
    const ledgerById = new Map(ledgers.map((entry) => [entry.id, entry]));
    const contexts = await Promise.all(bills.sort((a, b) => a.billNumber.localeCompare(b.billNumber)).map(async (bill) => {
      const ledger = ledgerById.get(bill.ledgerEntryId);
      if (!ledger) throw rpcError.notFound("Bill ledger fact");
      const beforeMinor = await balanceAt(db, schoolId, bill.admissionId, bill.currency, ledger.sequence - BigInt(1));
      const afterMinor = beforeMinor + bill.totalAmountMinor;
      return {
        school,
        session: { startYear: bill.sessionStartYearSnapshot, endYear: bill.sessionEndYearSnapshot },
        admission: { name: bill.admissionNameSnapshot, number: bill.admissionNumberSnapshot, fatherName: null, motherName: null, classLabel: bill.classLabelSnapshot, sectionLabel: bill.sectionLabelSnapshot, rollNumber: bill.rollNumberSnapshot?.toString() ?? null },
        currency: { code: bill.currency, exponent: currencyMinorUnitDigits(currencyCodeSchema.parse(bill.currency)) },
        bill: { id: bill.id, number: bill.billNumber, issueDate: bill.issueDate, periodKey: bill.periodKey, total: amount(bill.totalAmountMinor, bill.currency), totalMinor: bill.totalAmountMinor.toString() },
        lines: lines.filter((line) => line.billId === bill.id).map((line) => ({ slug: line.feeElementSlug, name: line.feeElementName, amount: amount(line.amountMinor, line.currency), amountMinor: line.amountMinor.toString(), pricingSource: line.pricingSourceKind })),
        balanceBefore: amount(beforeMinor, bill.currency),
        balanceAfter: amount(afterMinor, bill.currency),
        generatedAt: new Date().toISOString(),
      };
    }));
    return { contexts, name: bills.length === 1 ? `Bill ${bills[0]!.billNumber}` : `${bills.length} bills`, financeSource: { kind: "bill" as const, admissionIds: [...new Set(bills.map((bill) => bill.admissionId))], billIds, billRunId: source.billRunId ?? null }, reviewHash: null };
  }

  if (source.documentType === "receipt") {
    const paymentIds = source.transactions.filter((item) => item.kind === "payment").map((item) => item.id);
    const refundIds = source.transactions.filter((item) => item.kind === "refund").map((item) => item.id);
    const [directPayments, refunds] = await Promise.all([
      paymentIds.length ? db.select().from(financePaymentTable).where(and(eq(financePaymentTable.schoolId, schoolId), eq(financePaymentTable.sessionId, source.sessionId), inArray(financePaymentTable.id, paymentIds))) : [],
      refundIds.length ? db.select().from(financeRefundTable).where(and(eq(financeRefundTable.schoolId, schoolId), eq(financeRefundTable.sessionId, source.sessionId), inArray(financeRefundTable.id, refundIds))) : [],
    ]);
    if (directPayments.length !== paymentIds.length || refunds.length !== refundIds.length) throw rpcError.notFound("Receipt transaction");
    const parentPaymentIds = [...new Set([...paymentIds, ...refunds.map((refund) => refund.paymentId)])];
    const payments = await db.select().from(financePaymentTable).where(and(eq(financePaymentTable.schoolId, schoolId), inArray(financePaymentTable.id, parentPaymentIds)));
    if (payments.length !== parentPaymentIds.length) throw rpcError.notFound("Receipt payment snapshot");
    const transactionLedgerIds = [...directPayments.map((payment) => payment.ledgerEntryId), ...refunds.map((refund) => refund.ledgerEntryId)];
    const ledgers = await db.select().from(financeLedgerEntryTable).where(and(eq(financeLedgerEntryTable.schoolId, schoolId), inArray(financeLedgerEntryTable.id, transactionLedgerIds)));
    const ledgerById = new Map(ledgers.map((entry) => [entry.id, entry]));
    const paymentById = new Map(payments.map((payment) => [payment.id, payment]));
    const refundById = new Map(refunds.map((refund) => [refund.id, refund]));
    const contexts = await Promise.all(source.transactions.map(async (requested) => {
      const refund = requested.kind === "refund" ? refundById.get(requested.id) : null;
      const payment = paymentById.get(refund?.paymentId ?? requested.id);
      if (!payment) throw rpcError.notFound("Receipt payment");
      const ledger = ledgerById.get(refund?.ledgerEntryId ?? payment.ledgerEntryId);
      if (!ledger) throw rpcError.notFound("Receipt ledger fact");
      const snapshot = payment.documentSnapshot;
      if (!snapshot) throw rpcError.conflict("This legacy payment has no immutable receipt identity snapshot.");
      const previousMinor = await balanceAt(db, schoolId, payment.admissionId, payment.currency, ledger.sequence - BigInt(1));
      const transactionAmount = refund?.amountMinor ?? payment.amountMinor;
      const remainingMinor = previousMinor + signed(ledger);
      return {
        school,
        session: { startYear: snapshot.sessionStartYear, endYear: snapshot.sessionEndYear },
        admission: { name: snapshot.admissionName, number: snapshot.admissionNumber, fatherName: snapshot.fatherName, motherName: snapshot.motherName, classLabel: snapshot.classLabel, sectionLabel: snapshot.sectionLabel, rollNumber: snapshot.rollNumber?.toString() ?? null },
        currency: { code: payment.currency, exponent: currencyMinorUnitDigits(currencyCodeSchema.parse(payment.currency)) },
        transaction: { kind: requested.kind, isRefund: requested.kind === "refund", id: requested.id, documentNumber: refund?.refundNumber ?? payment.receiptNumber },
        payment: { id: payment.id, receiptNumber: refund?.refundNumber ?? payment.receiptNumber, receivedAt: (refund?.recordedAt ?? payment.receivedAt).toISOString(), amount: amount(transactionAmount, payment.currency), amountMinor: transactionAmount.toString(), method: refund?.method ?? payment.method, externalReference: refund?.externalReference ?? payment.externalReference, payerName: payment.payerName, note: refund?.reason ?? payment.note },
        previousBalance: amount(previousMinor, payment.currency),
        remainingBalance: amount(remainingMinor, payment.currency),
        generatedAt: new Date().toISOString(),
      };
    }));
    return { contexts, name: contexts.length === 1 ? `Receipt ${contexts[0]!.payment.receiptNumber}` : `${contexts.length} receipts`, financeSource: { kind: "receipt" as const, admissionIds: [...new Set(payments.map((payment) => payment.admissionId))], transactions: source.transactions }, reviewHash: null };
  }

  const [session] = await db.select({
    startYear: schoolSessionTable.sessionStartYear,
    endYear: schoolSessionTable.sessionEndYear,
    financeConfig: schoolSessionTable.financeConfig,
  }).from(schoolSessionTable).where(and(eq(schoolSessionTable.schoolId, schoolId), eq(schoolSessionTable.id, source.sessionId))).limit(1);
  if (!session) throw rpcError.notFound("School session");
  const financeConfig = financeSchemaConfigSchema.safeParse(session.financeConfig);
  if (!financeConfig.success) throw rpcError.conflict("Complete this session's finance currency and time zone before generating statements.");
  const { currency, timeZone, cycleStartMonth } = financeConfig.data;
  if (!isValidLocalDate(source.throughDate)) throw rpcError.badRequest("Statement date must be a real calendar date.");
  const month = String(cycleStartMonth).padStart(2, "0");
  const sessionStart = `${session.startYear}-${month}-01`;
  const sessionEnd = `${session.endYear}-${month}-01`;
  if (source.throughDate < sessionStart || source.throughDate >= sessionEnd) throw rpcError.badRequest("Statement date must fall within the selected finance session.");
  const todayParts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  const today = `${todayParts.year}-${todayParts.month}-${todayParts.day}`;
  if (source.throughDate > today) throw rpcError.badRequest("Statement date cannot be in the future.");
  const date = new Date(`${source.throughDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  const endAt = localDateToInstant(date.toISOString().slice(0, 10), timeZone);
  const periodStartDate = `${source.throughDate.slice(0, 7)}-01`;
  const periodStartAt = localDateToInstant(periodStartDate, timeZone);
  const contexts = [];
  const accounts: Array<{ admissionId: string; highWaterSequence: string }> = [];
  for (const admissionId of [...new Set(source.admissionIds)]) {
    const entries = await db.select().from(financeLedgerEntryTable).where(and(
      eq(financeLedgerEntryTable.schoolId, schoolId),
      eq(financeLedgerEntryTable.sessionId, source.sessionId),
      eq(financeLedgerEntryTable.admissionId, admissionId),
      eq(financeLedgerEntryTable.currency, currency),
      lt(financeLedgerEntryTable.effectiveAt, endAt),
    )).orderBy(asc(financeLedgerEntryTable.sequence));
    if (!entries.length) throw rpcError.notFound("Admission statement facts");
    const cutoff = entries.at(-1)!.sequence;
    accounts.push({ admissionId, highWaterSequence: cutoff.toString() });
    const snapshot = entries.at(-1)!.documentSnapshot;
    if (!snapshot?.admissionName || !snapshot.admissionNumber) throw rpcError.conflict("This account has no immutable statement identity snapshot.");
    let running = BigInt(0);
    const ledgerIds = entries.map((entry) => entry.id);
    const [billRefs, paymentRefs, refundRefs, adjustmentRefs] = await Promise.all([
      db.select({ ledgerEntryId: financeBillTable.ledgerEntryId, value: financeBillTable.billNumber }).from(financeBillTable).where(and(eq(financeBillTable.schoolId, schoolId), inArray(financeBillTable.ledgerEntryId, ledgerIds))),
      db.select({ ledgerEntryId: financePaymentTable.ledgerEntryId, value: financePaymentTable.receiptNumber }).from(financePaymentTable).where(and(eq(financePaymentTable.schoolId, schoolId), inArray(financePaymentTable.ledgerEntryId, ledgerIds))),
      db.select({ ledgerEntryId: financeRefundTable.ledgerEntryId, value: financeRefundTable.refundNumber }).from(financeRefundTable).where(and(eq(financeRefundTable.schoolId, schoolId), inArray(financeRefundTable.ledgerEntryId, ledgerIds))),
      db.select({ ledgerEntryId: financeAdjustmentTable.ledgerEntryId, value: financeAdjustmentTable.reasonCode }).from(financeAdjustmentTable).where(and(eq(financeAdjustmentTable.schoolId, schoolId), inArray(financeAdjustmentTable.ledgerEntryId, ledgerIds))),
    ]);
    const references = new Map([...billRefs, ...paymentRefs, ...refundRefs, ...adjustmentRefs].map((row) => [row.ledgerEntryId, row.value]));
    let openingMinor = BigInt(0);
    const rows = entries.flatMap((entry) => {
      running += signed(entry);
      if (entry.effectiveAt < periodStartAt) {
        openingMinor = running;
        return [];
      }
      return [{ sequence: entry.sequence.toString(), effectiveAt: entry.effectiveAt.toISOString(), reference: references.get(entry.id) ?? `Ledger ${entry.sequence}`, description: entry.note ?? entry.type.replaceAll("_", " "), debit: entry.direction === "debit" ? amount(entry.amountMinor, entry.currency) : "", credit: entry.direction === "credit" ? amount(entry.amountMinor, entry.currency) : "", balance: amount(running, entry.currency) }];
    });
    contexts.push({ school, session: { startYear: snapshot.sessionStartYear, endYear: snapshot.sessionEndYear }, admission: { name: snapshot.admissionName, number: snapshot.admissionNumber, fatherName: snapshot.fatherName, motherName: snapshot.motherName, classLabel: snapshot.classLabel, sectionLabel: snapshot.sectionLabel, rollNumber: snapshot.rollNumber?.toString() ?? null }, currency: { code: currency, exponent: currencyMinorUnitDigits(currencyCodeSchema.parse(currency)) }, statement: { periodStartDate, throughDate: source.throughDate, asOfSequence: cutoff.toString(), openingBalance: amount(openingMinor, currency), openingBalanceMinor: openingMinor.toString(), closingBalance: amount(running, currency), closingBalanceMinor: running.toString() }, entries: rows, generatedAt: new Date().toISOString() });
  }
  const reviewHash = createHash("sha256").update(JSON.stringify({ schoolId, sessionId: source.sessionId, currency, throughDate: source.throughDate, timeZone, accounts })).digest("hex");
  return { contexts, name: contexts.length === 1 ? `Account statement ${contexts[0]!.admission.number}` : `${contexts.length} account statements`, financeSource: { kind: "statement" as const, currency, throughDate: source.throughDate, timeZone, accounts }, reviewHash };
}
