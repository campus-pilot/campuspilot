import type { DatabaseExecutor } from "@campuspilot/db";
import {
  financeBillLineTable,
  financeBillRunTable,
  financeBillTable,
  financeLedgerEntryTable,
} from "@campuspilot/db/schema/finance";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
} from "drizzle-orm";

import { rpcError } from "../../../errors";
import {
  createNextPageCursor,
  createPaginatedResult,
  resolvePaginationInput,
} from "../../../paginations";
import { serializeFinanceInteger } from "./transport";

function runDto(
  run: typeof financeBillRunTable.$inferSelect,
  reversedBillCount: number,
) {
  return {
    ...run,
    totalAmountMinor: serializeFinanceInteger(run.totalAmountMinor),
    reversedBillCount,
    fullyReversed: run.billCount > 0 && reversedBillCount === run.billCount,
  };
}

async function reversedCounts(
  db: DatabaseExecutor,
  schoolId: string,
  runIds: string[],
) {
  if (!runIds.length) return new Map<string, number>();
  const rows = await db
    .select({ runId: financeBillTable.billRunId, value: count() })
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
        inArray(financeBillTable.billRunId, runIds),
      ),
    )
    .groupBy(financeBillTable.billRunId);
  return new Map(
    rows.flatMap(({ runId, value }) => (runId ? [[runId, value] as const] : [])),
  );
}

export async function listBillingRuns(
  db: DatabaseExecutor,
  input: {
    schoolId: string;
    filters?: {
      sessionId?: string;
      periodKey?: string;
      kind?: "regular" | "supplemental";
      recordedBy?: string;
      recordedFrom?: Date;
      recordedTo?: Date;
    };
    orderBy: {
      field: "recordedAt" | "issueDate" | "periodKey";
      direction: "asc" | "desc";
    };
    cursor?: string;
    page?: number;
    limit: number;
  },
) {
  const { currentPage, pageSize, offset } = resolvePaginationInput(input);
  const where = and(
    eq(financeBillRunTable.schoolId, input.schoolId),
    input.filters?.sessionId
      ? eq(financeBillRunTable.sessionId, input.filters.sessionId)
      : undefined,
    input.filters?.periodKey
      ? eq(financeBillRunTable.periodKey, input.filters.periodKey)
      : undefined,
    input.filters?.kind
      ? eq(financeBillRunTable.kind, input.filters.kind)
      : undefined,
    input.filters?.recordedBy
      ? eq(financeBillRunTable.recordedBy, input.filters.recordedBy)
      : undefined,
    input.filters?.recordedFrom
      ? gte(financeBillRunTable.recordedAt, input.filters.recordedFrom)
      : undefined,
    input.filters?.recordedTo
      ? lte(financeBillRunTable.recordedAt, input.filters.recordedTo)
      : undefined,
  );
  const orderColumn = {
    recordedAt: financeBillRunTable.recordedAt,
    issueDate: financeBillRunTable.issueDate,
    periodKey: financeBillRunTable.periodKey,
  }[input.orderBy.field];
  const direction = input.orderBy.direction === "asc" ? asc : desc;
  const [runs, totals] = await Promise.all([
    db
      .select()
      .from(financeBillRunTable)
      .where(where)
      .orderBy(direction(orderColumn), direction(financeBillRunTable.id))
      .limit(pageSize)
      .offset(offset),
    db.select({ value: count() }).from(financeBillRunTable).where(where),
  ]);
  const counts = await reversedCounts(
    db,
    input.schoolId,
    runs.map(({ id }) => id),
  );
  const totalItems = totals[0]?.value ?? 0;
  const totalPages = Math.ceil(totalItems / pageSize);
  return createPaginatedResult({
    items: runs.map((run) => runDto(run, counts.get(run.id) ?? 0)),
    nextCursor: createNextPageCursor(currentPage, totalPages),
    currentPage,
    totalPages,
    totalItems,
    pageSize,
  });
}

export async function getBillingRunDetail(
  db: DatabaseExecutor,
  input: {
    schoolId: string;
    sessionId: string;
    billRunId: string;
    page: number;
    limit: number;
  },
) {
  const { currentPage, pageSize, offset } = resolvePaginationInput(input);
  const [run] = await db
    .select()
    .from(financeBillRunTable)
    .where(
      and(
        eq(financeBillRunTable.schoolId, input.schoolId),
        eq(financeBillRunTable.sessionId, input.sessionId),
        eq(financeBillRunTable.id, input.billRunId),
      ),
    )
    .limit(1);
  if (!run) throw rpcError.notFound("Billing run");
  const billWhere = and(
    eq(financeBillTable.schoolId, input.schoolId),
    eq(financeBillTable.sessionId, input.sessionId),
    eq(financeBillTable.billRunId, input.billRunId),
  );
  const [bills, billTotals] = await Promise.all([
    db
      .select()
      .from(financeBillTable)
      .where(billWhere)
      .orderBy(
        asc(financeBillTable.admissionNumberSnapshot),
        asc(financeBillTable.id),
      )
      .limit(pageSize)
      .offset(offset),
    db.select({ value: count() }).from(financeBillTable).where(billWhere),
  ]);
  const billIds = bills.map(({ id }) => id);
  const [lines, reversalRows] = await Promise.all([
    billIds.length
      ? db
          .select()
          .from(financeBillLineTable)
          .where(
            and(
              eq(financeBillLineTable.schoolId, input.schoolId),
              inArray(financeBillLineTable.billId, billIds),
            ),
          )
          .orderBy(
            asc(financeBillLineTable.billId),
            asc(financeBillLineTable.lineOrder),
          )
      : [],
    bills.length
      ? db
          .select({ target: financeLedgerEntryTable.reversalOfEntryId })
          .from(financeLedgerEntryTable)
          .where(
            and(
              eq(financeLedgerEntryTable.schoolId, input.schoolId),
              inArray(
                financeLedgerEntryTable.reversalOfEntryId,
                bills.map(({ ledgerEntryId }) => ledgerEntryId),
              ),
            ),
          )
      : [],
  ]);
  const reversedEntries = new Set(reversalRows.map(({ target }) => target));
  const linesByBill = new Map<string, typeof lines>();
  for (const line of lines) {
    const current = linesByBill.get(line.billId) ?? [];
    current.push(line);
    linesByBill.set(line.billId, current);
  }
  const reversalCounts = await reversedCounts(db, input.schoolId, [run.id]);
  const reversedBillCount = reversalCounts.get(run.id) ?? 0;
  const totalItems = billTotals[0]?.value ?? 0;
  const totalPages = Math.ceil(totalItems / pageSize);

  return {
    ...runDto(run, reversedBillCount),
    configSnapshot: run.configSnapshot,
    inputSnapshot: run.inputSnapshot,
    bills: createPaginatedResult({
      items: bills.map((bill) => ({
        ...bill,
        totalAmountMinor: serializeFinanceInteger(bill.totalAmountMinor),
        reversed: reversedEntries.has(bill.ledgerEntryId),
        lines: (linesByBill.get(bill.id) ?? []).map((line) => ({
          ...line,
          amountMinor: serializeFinanceInteger(line.amountMinor),
        })),
      })),
      nextCursor: createNextPageCursor(currentPage, totalPages),
      currentPage,
      totalPages,
      totalItems,
      pageSize,
    }),
  };
}
