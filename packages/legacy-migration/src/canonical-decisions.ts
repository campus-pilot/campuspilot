import { createHash } from 'node:crypto';

/** Decisions that every approved Prem Chandra mapping must resolve explicitly. */
export const CANONICAL_DECISIONS = [
  'G-01',
  'G-02',
  'G-03',
  'G-04',
  'G-05',
  'G-06',
  'G-07',
  'G-08',
  'G-09',
  'G-10',
  'G-11',
  'G-12',
  'G-13',
  'G-14',
  'I-05',
  'I-07',
  'I-10',
  'I-12',
  'A-04',
  'A-05',
  'A-12',
  'E-03',
  'D-03',
  'D-04',
  'D-07',
  'D-09',
  'F-07',
  'F-12',
] as const;

/**
 * Machine-enforced resolutions for every decision consumed by this importer.
 * The tracked migration documentation explains the rationale, but it cannot
 * replace these typed execution facts or select behavior the importer does not
 * implement.
 */
export const CANONICAL_DECISION_POLICY = {
  'G-01': { tenantScope: 'prem-chandra-only' },
  'G-02': { targetRows: 'must-be-empty', objectCollision: 'stop' },
  'G-03': { sourceCutoff: 'dump-and-exact-drizzle-history' },
  'G-04': { consistency: 'custom-dump-restored-and-compared' },
  'G-05': { sourceTimeZone: 'Asia/Kolkata' },
  'G-06': { preservedIdPolicy: 'exact-or-stop' },
  'G-07': { tieBreak: 'source-id-ascending' },
  'G-08': { rehearsalData: 'private-production-snapshot' },
  'G-09': { artifacts: 'private-mode-0600-outside-repository' },
  'G-10': { targetWriters: 'verified-zero-replicas' },
  'G-11': { objects: 'reference-existing-shared-bucket-keys-read-only' },
  'G-12': { actor: 'explicit-migration-actor' },
  'G-13': { provenance: 'tracked-contract-checksums-and-durable-run' },
  'G-14': { decomposedIds: 'deterministic-hash-from-source-id' },
  'I-05': { credentialHash: 'preserve-byte-for-byte' },
  'I-07': { emailVerified: 'preserve' },
  'I-10': { providerImage: 'omit' },
  'I-12': { studentPortalIdentity: 'block-unless-zero' },
  'A-04': { classOrder: 'nursery-lkg-ukg-numeric-then-slug-id' },
  'A-05': { sectionOrder: 'per-class-slug-then-id' },
  'A-12': { admissionPhotos: 'intentionally-omit-without-object-mutation' },
  'E-03': { totalWorkingDays: 81 },
  'D-03': { customTemplate: 'preserve-source-bytes-and-shared-object-key' },
  'D-04': { admitCardPageSize: 'half' },
  'D-07': { templateActor: 'migration-actor' },
  'D-09': { templateVersions: 'active-cutoff-only' },
  'F-07': {
    billNumberPattern: 'BILL/{session}/{sequence:6}',
    receiptNumberPattern: 'RCP/{session}/{sequence:6}',
    nextValues: { bill: 363, receipt: 154, refund: 1 },
  },
  'F-12': {
    projections: 'rebuild-from-events',
    billRunHeaders: 'rebuild-from-member-bills',
    standaloneManualActor: 'migration-actor',
    standaloneManualReason:
      'Legacy manual charge; source did not record a separate justification.',
  },
} as const;

export const CANONICAL_DECISION_SET_SHA256 = createHash('sha256')
  .update(JSON.stringify({ ids: CANONICAL_DECISIONS, policy: CANONICAL_DECISION_POLICY }))
  .digest('hex');

/** Bind the typed policy and the exact tracked migration documentation together. */
export function trackedMigrationContractSha256(migrationDocsSha256: string) {
  if (!/^[0-9a-f]{64}$/.test(migrationDocsSha256))
    throw new Error('Migration documentation checksum must be SHA-256');
  return createHash('sha256')
    .update(JSON.stringify({
      canonicalDecisionSetSha256: CANONICAL_DECISION_SET_SHA256,
      migrationDocsSha256,
    }))
    .digest('hex');
}
