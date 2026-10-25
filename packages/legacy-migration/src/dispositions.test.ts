import { describe, expect, it } from 'vitest';

import {
  SOURCE_DISPOSITION_FAMILY_KEYS,
  assertNoBlockingDispositions,
  buildSourceDispositions,
  type SourceDispositionCounts,
} from './dispositions.ts';

function evidence(overrides: Partial<SourceDispositionCounts> = {}) {
  const dispositionCounts = Object.fromEntries(
    SOURCE_DISPOSITION_FAMILY_KEYS.map((key) => [key, 0]),
  ) as SourceDispositionCounts;
  Object.assign(dispositionCounts, overrides);
  return {
    tables: {
      school: { count: 1, sha256: 'a' },
      admission: { count: 2, sha256: 'b' },
      student_bill_projection: { count: 2, sha256: 'c' },
      ledger_projection: { count: 1, sha256: 'd' },
    },
    dispositionCounts,
  };
}

describe('canonical source dispositions', () => {
  it('accounts for every family with one deterministic terminal disposition', () => {
    const dispositions = buildSourceDispositions(evidence({
      'account.credential': 1,
      'account.oauth': 2,
      'admission.photo_object': 1,
      'artifact.generated_pdf_row': 3,
      'artifact.generated_pdf_object': 3,
      'artifact.notice_template_row': 1,
      'artifact.notice_object': 1,
      'artifact.template_object': 1,
      'school.logo_object': 1,
      ai_usage: 2,
      ai_quota: 1,
      excluded_school: 1,
      'school.onboarding_completion': 1,
    }));
    expect(dispositions.map((entry) => entry.family)).toEqual(
      [...dispositions.map((entry) => entry.family)].toSorted(),
    );
    for (const entry of dispositions) {
      expect(
        entry.imported + entry.intentionallyOmitted + entry.deferred + entry.blocked,
      ).toBe(entry.sourceCount);
    }
    expect(dispositions).toEqual(expect.arrayContaining([
      expect.objectContaining({ family: 'account:oauth', sourceCount: 2, intentionallyOmitted: 2 }),
      expect.objectContaining({ family: 'admission:photo-object', sourceCount: 1, intentionallyOmitted: 1 }),
      expect.objectContaining({ family: 'artifact:template-object', sourceCount: 1, imported: 1 }),
      expect.objectContaining({ family: 'school:logo-object', sourceCount: 1, imported: 1 }),
      expect.objectContaining({ family: 'artifact:generated-pdf-object', sourceCount: 3, intentionallyOmitted: 3 }),
      expect.objectContaining({ family: 'school:default-session-config', deferred: 0 }),
      expect.objectContaining({ family: 'school:onboarding-completion', sourceCount: 1, intentionallyOmitted: 1 }),
      expect.objectContaining({ family: 'tenant:excluded-school', sourceCount: 1, intentionallyOmitted: 1 }),
    ]));
  });

  it('blocks unknown artifact families before import', () => {
    const dispositions = buildSourceDispositions(evidence({
      'artifact.unknown': 1,
    }));
    expect(() => assertNoBlockingDispositions(dispositions)).toThrow(
      'artifact:unknown=1',
    );
  });

  it('accepts a zero-count student portal boundary', () => {
    expect(() => assertNoBlockingDispositions(buildSourceDispositions(evidence()))).not.toThrow();
  });

  it('blocks every nonzero student portal evidence family', () => {
    const dispositions = buildSourceDispositions(evidence({
      'student_portal.admission_email_user': 1,
      'student_portal.account': 2,
      'student_portal.session_flag': 1,
    }));
    expect(() => assertNoBlockingDispositions(dispositions)).toThrow(
      'student-portal:account=2',
    );
  });
});
