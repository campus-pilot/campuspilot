import { expect, it } from 'vitest';

import { assertSnapshotEvidence, type SnapshotEvidence } from './snapshot-evidence.ts';
import { sha256, stableJson, type SourceEvidence } from './source-evidence.ts';
import { EXPECTED_LEGACY_CATALOG, legacyCatalogSha256 } from './legacy-catalog-contract.ts';

const dump = Buffer.from('synthetic dump');
const dispositionCounts = {
  'account.credential': 0,
  'account.oauth': 0,
  'admission.photo_object': 0,
  ai_quota: 0,
  ai_usage: 0,
  apikey: 0,
  'artifact.generated_pdf_object': 0,
  'artifact.generated_pdf_row': 0,
  'artifact.notice_object': 0,
  'artifact.notice_pdf_row': 0,
  'artifact.notice_template_row': 0,
  'artifact.template': 0,
  'artifact.template_object': 0,
  'artifact.unknown': 0,
  excluded_school: 0,
  notice: 0,
  'school.default_session_config': 0,
  'school.feature_state': 0,
  'school.onboarding_completion': 0,
  'school.logo_object': 0,
  school_onboarding: 0,
  session: 0,
  'student_portal.account': 0,
  'student_portal.admission_email_user': 0,
  'student_portal.session_flag': 0,
  'user.provider_image': 0,
  verification: 0,
} as const;
const sourceEvidence = {
  schemaVersion: 3,
  schoolId: 'sch_n6q4pmirqg7dpct1pr8pr',
  sourceVersion: 'v1',
  sourceDatabaseIdentity: 'localhost:5432/source',
  migrationHistory: [],
  migrationHistorySha256: sha256('[]'),
  tables: {},
  tableDigestsSha256: sha256('[]'),
  dispositionCounts,
  dispositionCountsSha256: sha256(stableJson(dispositionCounts)),
  catalog: EXPECTED_LEGACY_CATALOG,
  catalogSha256: legacyCatalogSha256(EXPECTED_LEGACY_CATALOG),
  legacyState: {
    defaultSessionConfigs: [], defaultSessionDiffs: [], features: [], aiUsage: [], aiQuota: [],
    studentPortal: { admissionEmailLinkedNonStaffUsers: 0, accounts: 0, studentSessions: 0 },
  },
  legacyStateSha256: sha256(stableJson({
    defaultSessionConfigs: [], defaultSessionDiffs: [], features: [], aiUsage: [], aiQuota: [],
    studentPortal: { admissionEmailLinkedNonStaffUsers: 0, accounts: 0, studentSessions: 0 },
  })),
} satisfies SourceEvidence;
const evidence: SnapshotEvidence = {
  schemaVersion: 1,
  dumpSha256: sha256(dump),
  canonicalDatabaseIdentity: 'localhost:5432/source',
  canonicalRuntime: { systemIdentifier: '1' },
  validationRuntime: { systemIdentifier: '1' },
  recoveryCutoff: { transaction_snapshot: '1:1:' },
  sourceEvidenceSha256: sha256(stableJson(sourceEvidence)),
  catalogAndDrizzleFingerprint: sha256(stableJson({
    tables: sourceEvidence.tables,
    migrationHistory: sourceEvidence.migrationHistory,
    dispositionCounts: sourceEvidence.dispositionCounts,
    catalogSha256: sourceEvidence.catalogSha256,
    legacyStateSha256: sourceEvidence.legacyStateSha256,
  })),
  adminRuntime: { systemIdentifier: '1', currentUser: 'snapshot_admin', tls: { active: false } },
};

it('binds snapshot evidence to the exact dump and source evidence', () => {
  expect(() => assertSnapshotEvidence({ evidence, sourceEvidence, dump, canonicalDatabaseIdentity: 'localhost:5432/source', canonicalRuntime: evidence.canonicalRuntime })).not.toThrow();
  expect(() => assertSnapshotEvidence({ evidence, sourceEvidence, dump: Buffer.from('changed'), canonicalDatabaseIdentity: 'localhost:5432/source', canonicalRuntime: evidence.canonicalRuntime })).toThrow('does not match');
  expect(() => assertSnapshotEvidence({ evidence, sourceEvidence, dump, canonicalDatabaseIdentity: 'localhost:5432/source', canonicalRuntime: { systemIdentifier: 'different' } })).toThrow('does not match');
});
