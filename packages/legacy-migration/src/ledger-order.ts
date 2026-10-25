export type LegacyLedgerCandidate = {
  admissionId: string;
  at: string;
  /** Source-table precedence: bill, payment, then discount. */
  order: number;
  sourceId: string;
};

/**
 * Match the migration contract: admission, event time, source-table
 * precedence, and finally the primary key inside that source table.
 */
export function compareLegacyLedgerCandidates(
  left: LegacyLedgerCandidate,
  right: LegacyLedgerCandidate,
) {
  return (
    left.admissionId.localeCompare(right.admissionId) ||
    left.at.localeCompare(right.at) ||
    left.order - right.order ||
    left.sourceId.localeCompare(right.sourceId)
  );
}
