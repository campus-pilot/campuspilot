import { describe, expect, it } from 'vitest';

import {
  assertCreatableExamPlan,
  resolveExamPlanClassIds,
  selectExamClassPlans,
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
