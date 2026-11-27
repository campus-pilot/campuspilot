import { describe, expect, it } from 'vitest';

import { initialSchoolSetupDraft, readRequestFacts, schoolSetupDraftSchema, schoolSetupReadySchema, setupSlugs, wizardStepOfIssue, KNOWN_CLASS_SLUGS } from './school-setup.contract';

const response = {
  schoolName: 'Green Valley Public School',
  phone: '+919876543210',
  email: 'office@gmail.com',
  address: '14 Station Road, Jaipur',
  classes: [
    { name: 'LKG', sections: ['A'], subjects: ['English'] },
    { name: 'Class 1', sections: ['A', 'B'], subjects: ['English', 'Mathematics'] },
    'not a class',
  ],
};

describe('school setup draft', () => {
  it('starts from the request answers', () => {
    const draft = initialSchoolSetupDraft(readRequestFacts(response, true), new Date('2026-11-24T10:00:00Z'));
    expect(draft.school).toEqual({ name: 'Green Valley Public School', slug: 'green-valley-public-school', location: '14 Station Road, Jaipur', registrationNo: '', useRequestLogo: true });
    expect(draft.classes.map((entry) => entry.name)).toEqual(['LKG', 'Class 1']);
    expect(draft.session.startYear).toBe(2026);
    expect(draft.people).toEqual({ addMeAsManager: true, principal: { name: '', phone: '+919876543210', email: 'office@gmail.com' } });
    expect(schoolSetupReadySchema.safeParse(draft).success).toBe(true);
  });

  it('reports each problem on its own step', () => {
    const draft = initialSchoolSetupDraft(readRequestFacts({}, false), new Date());
    const issues = schoolSetupReadySchema.safeParse({ ...draft, plan: { ...draft.plan, trial: { ...draft.plan.trial, enabled: false } } }).error!.issues;
    const steps = new Set(issues.map((issue) => wizardStepOfIssue(issue.path)));
    expect(steps).toEqual(new Set(['school', 'plan', 'classes', 'people']));
  });

  it('takes an assistant limit of at least one cent, like the feature config it becomes', () => {
    const draft = initialSchoolSetupDraft(readRequestFacts(response, false), new Date());
    const withLimit = (assistantMonthlyLimitUsd: number | null) => ({ ...draft, features: { ...draft.features, assistantMonthlyLimitUsd } });
    expect(schoolSetupDraftSchema.safeParse(withLimit(0.01)).success).toBe(true);
    expect(schoolSetupDraftSchema.safeParse(withLimit(null)).success).toBe(true);
    expect(schoolSetupDraftSchema.safeParse(withLimit(0.009)).success).toBe(false);
    expect(schoolSetupDraftSchema.safeParse(withLimit(0)).success).toBe(false);
  });

  it('refuses duplicate classes, sections and examinations', () => {
    const draft = initialSchoolSetupDraft(readRequestFacts(response, false), new Date());
    expect(schoolSetupReadySchema.safeParse({ ...draft, classes: [...draft.classes, { name: 'class 1', sections: ['A'], subjects: ['English'] }] }).success).toBe(false);
    expect(schoolSetupReadySchema.safeParse({ ...draft, classes: [{ name: 'UKG', sections: ['A', 'a'], subjects: ['English'] }] }).success).toBe(false);
    expect(schoolSetupReadySchema.safeParse({ ...draft, session: { ...draft.session, examNames: ['Term 1', 'term 1'] } }).success).toBe(false);
  });
});

describe('setup slugs', () => {
  it('keeps the guided setup class slugs and makes the rest unique', () => {
    expect(setupSlugs(['Nursery', 'Class 1', 'Playgroup', 'Play group', 'नर्सरी'], 'class', KNOWN_CLASS_SLUGS)).toEqual(['nursery', 'class-1', 'playgroup', 'play-group', 'class-5']);
    expect(setupSlugs(['A', 'a', 'Rose'], 'section')).toEqual(['a', 'a-2', 'rose']);
  });
});
