import { sha256, stableJson, type SourceEvidence } from './source-evidence.ts';

export type SnapshotEvidence = {
  schemaVersion: 1;
  dumpSha256: string;
  canonicalDatabaseIdentity: string;
  adminRuntime: Record<string, unknown>;
  canonicalRuntime: Record<string, unknown>;
  validationRuntime: Record<string, unknown>;
  recoveryCutoff: Record<string, unknown>;
  sourceEvidenceSha256: string;
  catalogAndDrizzleFingerprint: string;
};

/** Rebind the supplied dump and connected canonical source to cutoff evidence. */
export function assertSnapshotEvidence(options: {
  evidence: SnapshotEvidence;
  sourceEvidence: SourceEvidence;
  dump: Buffer;
  canonicalDatabaseIdentity: string;
  canonicalRuntime: Record<string, unknown>;
}) {
  const { evidence } = options;
  if (evidence.schemaVersion !== 1 ||
    evidence.dumpSha256 !== sha256(options.dump) ||
    evidence.canonicalDatabaseIdentity !== options.canonicalDatabaseIdentity ||
    stableJson(evidence.canonicalRuntime) !== stableJson(options.canonicalRuntime) ||
    evidence.sourceEvidenceSha256 !== sha256(stableJson(options.sourceEvidence)) ||
    evidence.catalogAndDrizzleFingerprint !== sha256(stableJson({
      tables: options.sourceEvidence.tables,
      migrationHistory: options.sourceEvidence.migrationHistory,
      dispositionCounts: options.sourceEvidence.dispositionCounts,
      catalogSha256: options.sourceEvidence.catalogSha256,
      legacyStateSha256: options.sourceEvidence.legacyStateSha256,
    })) ||
    !evidence.adminRuntime || !evidence.canonicalRuntime || !evidence.validationRuntime || !evidence.recoveryCutoff ||
    typeof evidence.catalogAndDrizzleFingerprint !== 'string') {
    throw new Error('Snapshot evidence does not match the supplied dump and connected canonical source');
  }
}
