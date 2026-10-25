import { createHash } from 'node:crypto';

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export const SOURCE_DISPOSITION_FAMILY_KEYS = [
  'account.credential',
  'account.oauth',
  'admission.photo_object',
  'ai_quota',
  'ai_usage',
  'apikey',
  'artifact.generated_pdf_object',
  'artifact.generated_pdf_row',
  'artifact.notice_object',
  'artifact.notice_pdf_row',
  'artifact.notice_template_row',
  'artifact.template',
  'artifact.template_object',
  'artifact.unknown',
  'excluded_school',
  'notice',
  'school.default_session_config',
  'school.feature_state',
  'school.onboarding_completion',
  'school.logo_object',
  'school_onboarding',
  'session',
  'student_portal.account',
  'student_portal.admission_email_user',
  'student_portal.session_flag',
  'user.provider_image',
  'verification',
] as const;

export type SourceDispositionFamily =
  (typeof SOURCE_DISPOSITION_FAMILY_KEYS)[number];
export type SourceDispositionCounts = Record<SourceDispositionFamily, number>;

export type DispositionSummary = {
  family: string;
  sourceCount: number;
  imported: number;
  intentionallyOmitted: number;
  deferred: number;
  blocked: number;
  reason: string;
};

const importedTables = [
  'school',
  'school_session',
  'class',
  'section',
  'admission',
  'student',
  'staff',
  'user',
  'exam_plan',
  'exam_result',
  'exam_timetable',
  'bill_generation_event',
  'student_bill_event',
  'ledger_event',
] as const;

function summary(
  family: string,
  sourceCount: number,
  disposition: 'imported' | 'intentionallyOmitted' | 'deferred' | 'blocked',
  reason: string,
): DispositionSummary {
  return {
    family,
    sourceCount,
    imported: disposition === 'imported' ? sourceCount : 0,
    intentionallyOmitted:
      disposition === 'intentionallyOmitted' ? sourceCount : 0,
    deferred: disposition === 'deferred' ? sourceCount : 0,
    blocked: disposition === 'blocked' ? sourceCount : 0,
    reason,
  };
}

/**
 * Build the canonical disposition ledger from frozen source evidence only.
 * Import and crash recovery call this same function, so post-commit artifacts
 * cannot depend on process-local arrays or silently lose omitted families.
 */
export function buildSourceDispositions(sourceEvidence: {
  tables: Record<string, { count: number; sha256: string }>;
  dispositionCounts: SourceDispositionCounts;
}): DispositionSummary[] {
  const counts = sourceEvidence.dispositionCounts;
  const values: DispositionSummary[] = importedTables.map((table) =>
    summary(
      `table:${table}`,
      sourceEvidence.tables[table]?.count ?? 0,
      'imported',
      'Represented by the approved target migration plan',
    ),
  );

  values.push(
    summary(
      'table:student_bill_projection',
      sourceEvidence.tables.student_bill_projection?.count ?? 0,
      'intentionallyOmitted',
      'Projection is rebuilt and reconciled from immutable billing events',
    ),
    summary(
      'table:ledger_projection',
      sourceEvidence.tables.ledger_projection?.count ?? 0,
      'intentionallyOmitted',
      'Projection is rebuilt and reconciled from immutable ledger events',
    ),
    summary(
      'account:credential',
      counts['account.credential'],
      'imported',
      'Approved compatible password credential is preserved byte-for-byte',
    ),
    summary(
      'account:oauth',
      counts['account.oauth'],
      'intentionallyOmitted',
      'OAuth providers and tokens must be linked again in the target',
    ),
    summary(
      'auth:session',
      counts.session,
      'intentionallyOmitted',
      'Authentication sessions and tokens are never migrated',
    ),
    summary(
      'auth:verification',
      counts.verification,
      'intentionallyOmitted',
      'Verification challenges are never migrated',
    ),
    summary(
      'auth:apikey',
      counts.apikey,
      'intentionallyOmitted',
      'API keys and rate-limit state are never migrated',
    ),
    summary(
      'student-portal:admission-email-user',
      counts['student_portal.admission_email_user'],
      'blocked',
      'Admission-email-linked non-staff users require a tracked typed student-portal policy',
    ),
    summary(
      'student-portal:account',
      counts['student_portal.account'],
      'blocked',
      'Student/guardian portal accounts require a tracked typed student-portal policy',
    ),
    summary(
      'student-portal:session-flag',
      counts['student_portal.session_flag'],
      'blocked',
      'session.isStudent requires a tracked typed student-portal policy',
    ),
    summary(
      'admission:photo-object',
      counts['admission.photo_object'],
      'intentionallyOmitted',
      'Admission photos are excluded by tracked decision S-03',
    ),
    summary(
      'user:provider-image',
      counts['user.provider_image'],
      'intentionallyOmitted',
      'Provider image URLs are authentication metadata and are not copied',
    ),
    summary(
      'artifact:template',
      counts['artifact.template'],
      'imported',
      'Approved active document templates are imported as immutable revisions',
    ),
    summary(
      'artifact:template-object',
      counts['artifact.template_object'],
      'imported',
      'Approved active templates retain their exact verified shared-bucket keys',
    ),
    summary(
      'school:logo-object',
      counts['school.logo_object'],
      'imported',
      'The school logo retains its exact verified shared-bucket key',
    ),
    summary(
      'artifact:generated-pdf-row',
      counts['artifact.generated_pdf_row'],
      'intentionallyOmitted',
      'Generated PDF rows are regenerated from migrated facts and templates',
    ),
    summary(
      'artifact:generated-pdf-object',
      counts['artifact.generated_pdf_object'],
      'intentionallyOmitted',
      'Generated PDF objects are not copied',
    ),
    summary(
      'artifact:notice-template-row',
      counts['artifact.notice_template_row'],
      'intentionallyOmitted',
      'Notice templates have no target document type',
    ),
    summary(
      'artifact:notice-pdf-row',
      counts['artifact.notice_pdf_row'],
      'intentionallyOmitted',
      'Generated notice PDF rows are not copied and are not counted as generic generated PDFs',
    ),
    summary(
      'artifact:notice-object',
      counts['artifact.notice_object'],
      'intentionallyOmitted',
      'Notice template/PDF objects are not copied',
    ),
    summary(
      'artifact:unknown',
      counts['artifact.unknown'],
      'blocked',
      'Unknown legacy artifact types require an explicit tracked contract',
    ),
    summary(
      'table:notice',
      counts.notice,
      'intentionallyOmitted',
      'Notices have no target persistence model',
    ),
    summary(
      'table:school_onboarding',
      counts.school_onboarding,
      'intentionallyOmitted',
      'Detailed onboarding state is not target authority',
    ),
    summary(
      'school:feature-state',
      counts['school.feature_state'],
      'intentionallyOmitted',
      'Legacy feature flags are not inferred into target capabilities',
    ),
    summary(
      'school:onboarding-completion',
      counts['school.onboarding_completion'],
      'intentionallyOmitted',
      'Legacy onboarding completion is not inferred into target readiness',
    ),
    summary(
      'school:default-session-config',
      counts['school.default_session_config'],
      'deferred',
      'Default session configuration awaits an explicit target feature',
    ),
    summary(
      'table:ai_usage',
      counts.ai_usage,
      'intentionallyOmitted',
      'Legacy AI operational counters have no target authority',
    ),
    summary(
      'table:ai_quota',
      counts.ai_quota,
      'intentionallyOmitted',
      'Legacy AI quota configuration has no target feature',
    ),
    summary(
      'tenant:excluded-school',
      counts.excluded_school,
      'intentionallyOmitted',
      'The tracked scope contains only Prem Chandra Public School',
    ),
  );

  const ordered = values.toSorted((left, right) =>
    left.family.localeCompare(right.family),
  );
  for (const entry of ordered) {
    const total =
      entry.imported +
      entry.intentionallyOmitted +
      entry.deferred +
      entry.blocked;
    if (total !== entry.sourceCount)
      throw new Error(`Disposition totals do not reconcile for ${entry.family}`);
  }
  return ordered;
}

export function dispositionLedgerSha256(
  dispositions: DispositionSummary[],
): string {
  return sha256(stableJson(dispositions));
}

export function assertNoBlockingDispositions(
  dispositions: DispositionSummary[],
): void {
  const blocked = dispositions.filter((entry) => entry.blocked > 0);
  if (blocked.length)
    throw new Error(
      `Source disposition ledger contains blocking families: ${blocked
        .map((entry) => `${entry.family}=${entry.blocked}`)
        .join(', ')}`,
    );
}

/** Convert terminal blocking families into the canonical exception shape. */
export function blockingDispositionIssues(dispositions: DispositionSummary[]) {
  return dispositions
    .filter((entry) => entry.blocked > 0)
    .map((entry) => ({
      code: 'G_BLOCKING_SOURCE_DISPOSITION',
      domain: 'legacy-only',
      sourceKey: entry.family,
      severity: 'blocking' as const,
      message: `${entry.reason}; count=${entry.blocked}`,
    }));
}
