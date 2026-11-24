import type { DocumentLedgerCutoff } from "@campuspilot/db/schema/document-generation-job";

/** Ledger helpers shared by the finance document builders (bills, receipts, statements, Bills due). */

const SOURCE_QUERY_CHUNK = 500;

export function chunks<T>(values: T[], size = SOURCE_QUERY_CHUNK) {
  const groups: T[][] = [];
  for (let index = 0; index < values.length; index += size) groups.push(values.slice(index, index + size));
  return groups;
}

/** Keeps large document selections within PostgreSQL parameter limits without
 * opening an unbounded number of concurrent database queries. */
export async function loadInChunks<TValue, TRow>(
  values: TValue[],
  load: (group: TValue[]) => Promise<TRow[]>,
) {
  const rows: TRow[] = [];
  for (const group of chunks(values)) rows.push(...await load(group));
  return rows;
}

/** A ledger fact's signed amount: debits raise what is owed, credits lower it. */
export const signed = (entry: { direction: "debit" | "credit"; amountMinor: bigint }) =>
  entry.direction === "debit" ? entry.amountMinor : -entry.amountMinor;

export const ledgerAccountKey = (admissionId: string, currency: string) =>
  `${admissionId}\u0000${currency}`;

/** The pinned cutoff, by account; null when the builder reads the ledger as it is now. */
export type CutoffMap = Map<string, bigint> | null;

export function cutoffMap(cutoff: readonly DocumentLedgerCutoff[] | undefined): CutoffMap {
  if (!cutoff) return null;
  return new Map(cutoff.map((account) => [ledgerAccountKey(account.admissionId, account.currency), BigInt(account.highWaterSequence)]));
}
