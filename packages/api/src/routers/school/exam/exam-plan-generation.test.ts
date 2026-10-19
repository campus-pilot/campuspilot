import { describe, expect, it } from 'vitest';

import {
  assertCreatableExamPlan,
  type prepareExamPlan,
} from './exam-plan-generation';

type PreparedPlan = Awaited<ReturnType<typeof prepareExamPlan>>;

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
      ],
      planCount: 1,
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
  it('accepts a reviewed, valid plan with no existing rows', () => {
    expect(() =>
      assertCreatableExamPlan(prepared(), 'version-1'),
    ).not.toThrow();
  });

  it('preserves an existing plan before considering a stale review', () => {
    expect(() =>
      assertCreatableExamPlan(
        prepared({ existingPlanCount: 1 }),
        'stale-version',
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
      assertCreatableExamPlan(prepared(), 'stale-version'),
    ).toThrowError(
      expect.objectContaining({
        code: 'CONFLICT',
        message:
          'Class or subject configuration has changed. Review the updated plan overview before creating it.',
      }),
    );
  });

  it('identifies the exact class and subject containing an invalid mode', () => {
    expect(() =>
      assertCreatableExamPlan(
        prepared({ issue: 'Percentages must total 100%.' }),
        'version-1',
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'BAD_REQUEST',
        message: 'Grade 10 · Mathematics: Percentages must total 100%.',
      }),
    );
  });

  it('rejects a configuration that produces no plans', () => {
    expect(() =>
      assertCreatableExamPlan(
        prepared({ includePlan: false }),
        'version-1',
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
