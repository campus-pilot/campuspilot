import { describe, expect, it } from 'vitest';

import {
  assertCreatableExamPlan,
  resolveExamPlanClassIds,
  selectExamClassPlans,
  selectSubjectPlanChanges,
  type prepareExamPlan,
} from './exam-plan-generation';

type PreparedPlan = Awaited<ReturnType<typeof prepareExamPlan>>;

/**
 * Three classes: Grade 10 with one valid subject (unless `issue` is given),
 * Grade 11 without subjects and Grade 12 whose only subject has invalid modes.
 */
function prepared(overrides: {
  existingPlanCount?: number;
  configurationVersion?: string;
  issue?: string | null;
  includePlan?: boolean;
} = {}): PreparedPlan {
  const includePlan = overrides.includePlan ?? true;
  return {
    preview: {
      totalMarks: 100,
      classes: [
        {
          classId: 'class-1',
          label: 'Grade 10',
          studentCount: 20,
          participating: false,
          subjects: [
            {
              subjectSlug: 'mathematics',
              name: 'Mathematics',
              planned: false,
              issue: overrides.issue ?? null,
              modes: [
                {
                  slug: 'written',
                  name: 'Written',
                  percentage: 100,
                  maxMarks: 100,
                },
              ],
            },
          ],
        },
        {
          classId: 'class-2',
          label: 'Grade 11',
          studentCount: 5,
          participating: false,
          subjects: [],
        },
        {
          classId: 'class-3',
          label: 'Grade 12',
          studentCount: 8,
          participating: false,
          subjects: [
            {
              subjectSlug: 'science',
              name: 'Science',
              planned: false,
              issue: 'Percentages must total 100%.',
              modes: [],
            },
          ],
        },
      ],
      planCount: 2,
      existingPlanCount: overrides.existingPlanCount ?? 0,
      configurationVersion: overrides.configurationVersion ?? 'version-1',
    },
    plans: includePlan
      ? [
          {
            schoolId: 'school-1',
            sessionId: 'session-1',
            examSlug: 'term-one',
            classId: 'class-1',
            subjectSlug: 'mathematics',
            totalMarks: 100,
            modeConfig: {
              written: { percentage: 100, maxMarks: 100 },
            },
            totalWorkingDays: null,
            status: 'draft',
          },
        ]
      : [],
  };
}

describe('assertCreatableExamPlan', () => {
  it('accepts a reviewed, valid plan with no existing rows and returns the selected plans', () => {
    expect(
      assertCreatableExamPlan(prepared(), 'version-1', ['class-1']),
    ).toEqual([expect.objectContaining({ classId: 'class-1', subjectSlug: 'mathematics' })]);
  });

  it('preserves an existing plan before considering a stale review', () => {
    expect(() =>
      assertCreatableExamPlan(
        prepared({ existingPlanCount: 1 }),
        'stale-version',
        ['class-1'],
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'CONFLICT',
        message:
          'An exam plan already exists. Existing plans and results have been preserved.',
      }),
    );
  });

  it('rejects a review of an older class or subject configuration', () => {
    expect(() =>
      assertCreatableExamPlan(prepared(), 'stale-version', ['class-1']),
    ).toThrowError(
      expect.objectContaining({
        code: 'CONFLICT',
        message:
          'Class or subject configuration has changed. Review the updated plan overview before creating it.',
      }),
    );
  });

  it('refuses an empty selection', () => {
    expect(() =>
      assertCreatableExamPlan(prepared(), 'version-1', []),
    ).toThrowError(
      expect.objectContaining({
        code: 'BAD_REQUEST',
        message: 'Select at least one class to take part in the examination.',
      }),
    );
  });

  it('identifies the exact class and subject containing an invalid mode', () => {
    expect(() =>
      assertCreatableExamPlan(
        prepared({ issue: 'Percentages must total 100%.' }),
        'version-1',
        ['class-1'],
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'BAD_REQUEST',
        message: 'Grade 10 · Mathematics: Percentages must total 100%.',
      }),
    );
  });

  it('includes every class that has subjects when classIds is omitted', () => {
    const valid = prepared();
    valid.preview.classes = valid.preview.classes.filter(
      (entry) => entry.classId !== 'class-3',
    );
    expect(assertCreatableExamPlan(valid, 'version-1', undefined)).toEqual([
      expect.objectContaining({ classId: 'class-1', subjectSlug: 'mathematics' }),
    ]);
  });

  it('refuses an invalid subject of any class with subjects when classIds is omitted, as before exclusion existed', () => {
    expect(() =>
      assertCreatableExamPlan(prepared(), 'version-1', undefined),
    ).toThrowError(
      expect.objectContaining({
        code: 'BAD_REQUEST',
        message: 'Grade 12 · Science: Percentages must total 100%.',
      }),
    );
  });

  it('asks for subjects, not a class, when classIds is omitted and no class has subjects', () => {
    const empty = prepared({ includePlan: false });
    empty.preview.classes = empty.preview.classes.map((entry) => ({
      ...entry,
      subjects: [],
    }));
    expect(() =>
      assertCreatableExamPlan(empty, 'version-1', undefined),
    ).toThrowError(
      expect.objectContaining({
        code: 'BAD_REQUEST',
        message:
          'Configure at least one class subject and its assessment modes before creating an exam plan.',
      }),
    );
  });

  it('rejects a configuration that produces no plans', () => {
    expect(() =>
      assertCreatableExamPlan(
        prepared({ includePlan: false }),
        'version-1',
        ['class-1'],
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'BAD_REQUEST',
        message:
          'Configure at least one class subject and its assessment modes before creating an exam plan.',
      }),
    );
  });
});

describe('resolveExamPlanClassIds', () => {
  it('keeps the caller list when one is sent', () => {
    expect(resolveExamPlanClassIds(prepared(), ['class-1'])).toEqual(['class-1']);
  });

  it('defaults to every class that has subjects', () => {
    expect(resolveExamPlanClassIds(prepared(), undefined)).toEqual([
      'class-1',
      'class-3',
    ]);
  });
});

describe('selectExamClassPlans', () => {
  it('returns only the plans of the chosen classes and ignores problems of classes left out', () => {
    expect(selectExamClassPlans(prepared(), ['class-1'])).toHaveLength(1);
    expect(selectExamClassPlans(prepared(), [])).toEqual([]);
  });

  it('refuses a class that is not in the school', () => {
    expect(() => selectExamClassPlans(prepared(), ['class-1', 'elsewhere'])).toThrowError(
      expect.objectContaining({
        code: 'BAD_REQUEST',
        message: 'Every selected class must be a class of this school.',
      }),
    );
  });

  it('refuses a chosen class without subjects, naming it', () => {
    expect(() => selectExamClassPlans(prepared(), ['class-1', 'class-2'])).toThrowError(
      expect.objectContaining({
        code: 'BAD_REQUEST',
        message:
          'Grade 11 has no subjects configured, so it cannot take part. Deselect it or add subjects in class settings.',
      }),
    );
  });

  it('refuses a chosen class with an invalid subject, naming class and subject', () => {
    expect(() => selectExamClassPlans(prepared(), ['class-3'])).toThrowError(
      expect.objectContaining({
        code: 'BAD_REQUEST',
        message: 'Grade 12 · Science: Percentages must total 100%.',
      }),
    );
  });
});

describe('selectExamClassPlans with chosen subjects', () => {
  /** Grade 10 offers Mathematics (valid) and Art (invalid modes, no plan). */
  function withArt(): PreparedPlan {
    const value = prepared();
    value.preview.classes[0]!.subjects.push({
      subjectSlug: 'art',
      name: 'Art',
      planned: false,
      issue: 'Percentages must total 100%.',
      modes: [],
    });
    return value;
  }

  it('plans only the chosen subjects, so an invalid subject left out blocks nothing', () => {
    expect(selectExamClassPlans(withArt(), ['class-1'], { 'class-1': ['mathematics'] })).toEqual([
      expect.objectContaining({ classId: 'class-1', subjectSlug: 'mathematics' }),
    ]);
  });

  it('plans every offered subject of a chosen class left out of the choice', () => {
    expect(() => selectExamClassPlans(withArt(), ['class-1'])).toThrowError(
      expect.objectContaining({ code: 'BAD_REQUEST', message: 'Grade 10 · Art: Percentages must total 100%.' }),
    );
  });

  it('refuses a chosen subject with invalid modes', () => {
    expect(() => selectExamClassPlans(withArt(), ['class-1'], { 'class-1': ['art'] })).toThrowError(
      expect.objectContaining({ code: 'BAD_REQUEST', message: 'Grade 10 · Art: Percentages must total 100%.' }),
    );
  });

  it('refuses a subject that is not offered to the class', () => {
    expect(() => selectExamClassPlans(prepared(), ['class-1'], { 'class-1': ['science'] })).toThrowError(
      expect.objectContaining({
        code: 'BAD_REQUEST',
        message: 'Grade 10: every selected subject must be a subject offered in this examination.',
      }),
    );
  });

  it('refuses an empty choice for a class', () => {
    expect(() => selectExamClassPlans(prepared(), ['class-1'], { 'class-1': [] })).toThrowError(
      expect.objectContaining({ code: 'BAD_REQUEST', message: 'Grade 10: select at least one subject.' }),
    );
  });

  it('refuses a choice for a class that does not join', () => {
    expect(() => selectExamClassPlans(prepared(), ['class-1'], { 'class-3': ['science'] })).toThrowError(
      expect.objectContaining({
        code: 'BAD_REQUEST',
        message: 'Subjects were chosen for a class that does not join the examination in this change.',
      }),
    );
  });

  it('passes the choice through assertCreatableExamPlan', () => {
    expect(assertCreatableExamPlan(withArt(), 'version-1', ['class-1'], { 'class-1': ['mathematics'] })).toHaveLength(1);
  });
});

describe('selectSubjectPlanChanges', () => {
  /** Grade 10 takes part with Mathematics planned and English offered without a plan. */
  function participating(): PreparedPlan {
    const value = prepared();
    const grade10 = value.preview.classes[0]!;
    grade10.participating = true;
    grade10.subjects[0]!.planned = true;
    grade10.subjects.push({ subjectSlug: 'english', name: 'English', planned: false, issue: null, modes: [] });
    value.plans.push({ ...value.plans[0]!, subjectSlug: 'english' });
    return value;
  }

  it('adds plans for chosen unplanned subjects and removes planned subjects left out', () => {
    expect(selectSubjectPlanChanges(participating(), { 'class-1': ['english'] })).toEqual({
      add: [expect.objectContaining({ classId: 'class-1', subjectSlug: 'english' })],
      remove: [{ classId: 'class-1', subjectSlug: 'mathematics', label: 'Grade 10', name: 'Mathematics' }],
    });
  });

  it('keeps every plan of a class left out and changes nothing for an unchanged choice', () => {
    expect(selectSubjectPlanChanges(participating(), {})).toEqual({ add: [], remove: [] });
    expect(selectSubjectPlanChanges(participating(), { 'class-1': ['mathematics'] })).toEqual({ add: [], remove: [] });
  });

  it('refuses a subject that is not offered, and an invalid subject to add', () => {
    expect(() => selectSubjectPlanChanges(participating(), { 'class-1': ['science'] })).toThrowError(expect.objectContaining({ code: 'BAD_REQUEST' }));
    const invalid = participating();
    invalid.preview.classes[0]!.subjects[1]!.issue = 'Percentages must total 100%.';
    expect(() => selectSubjectPlanChanges(invalid, { 'class-1': ['mathematics', 'english'] })).toThrowError(
      expect.objectContaining({ message: 'Grade 10 · English: Percentages must total 100%.' }),
    );
  });
});
