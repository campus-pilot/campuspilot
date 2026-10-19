import { sessionConfigSchema } from '@campuspilot/db/schema/jsonb/session-config';
import { describe, expect, it } from 'vitest';

import type { resultValuesSchema } from './exam.dto';
import {
  requireActivePlan,
  requireRevisionPermission,
  resolveModeConfig,
  validateResult,
  validateResultMarks,
} from './exam.service';
import type { z } from 'zod';

type Plan = Parameters<typeof requireActivePlan>[0];
type ResultValues = z.infer<typeof resultValuesSchema>;

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    schoolId: 'school-1',
    sessionId: 'session-1',
    examSlug: 'term-one',
    classId: 'class-1',
    subjectSlug: 'mathematics',
    totalMarks: 100,
    modeConfig: {
      written: { percentage: 80, maxMarks: 80 },
      practical: { percentage: 20, maxMarks: 20 },
    },
    totalWorkingDays: null,
    status: 'active',
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

function result(overrides: Partial<ResultValues> = {}): ResultValues {
  return {
    studentId: 'student-1',
    marks: { written: 60, practical: 15 },
    coScholastics: null,
    daysAttended: null,
    approved: false,
    ...overrides,
  };
}

describe('exam service validation', () => {
  describe('resolveModeConfig', () => {
    it('derives exact maximum marks from configured percentages', () => {
      expect(
        resolveModeConfig(100, {
          written: { percentage: 70 },
          practical: { percentage: 30 },
        }),
      ).toEqual({
        written: { percentage: 70, maxMarks: 70 },
        practical: { percentage: 30, maxMarks: 30 },
      });
    });

    it('accepts a matching explicit mode snapshot', () => {
      const override = {
        theory: { percentage: 60, maxMarks: 30 },
        oral: { percentage: 40, maxMarks: 20 },
      };

      expect(
        resolveModeConfig(
          50,
          { theory: { percentage: 60 }, oral: { percentage: 40 } },
          override,
        ),
      ).toEqual(override);
    });

    it.each([
      [
        'an empty mode set',
        100,
        {},
        undefined,
        'Exam modes must total 100% and produce whole-number maximum marks. Adjust the total marks or percentages.',
      ],
      [
        'percentages that do not total 100',
        100,
        { written: { percentage: 90 } },
        undefined,
        'Exam modes must total 100% and produce whole-number maximum marks. Adjust the total marks or percentages.',
      ],
      [
        'fractional maximum marks',
        99,
        {
          written: { percentage: 50 },
          practical: { percentage: 50 },
        },
        undefined,
        'Exam modes must total 100% and produce whole-number maximum marks. Adjust the total marks or percentages.',
      ],
      [
        'an unknown override mode',
        100,
        { written: { percentage: 100 } },
        {
          oral: { percentage: 100, maxMarks: 100 },
        },
        'Unknown exam mode: oral.',
      ],
      [
        'override marks that do not match their weight',
        100,
        { written: { percentage: 100 } },
        {
          written: { percentage: 100, maxMarks: 99 },
        },
        'Maximum marks for written must equal total marks × percentage / 100.',
      ],
    ] as const)(
      'rejects %s',
      (_case, totalMarks, modes, override, message) => {
        expect(() => resolveModeConfig(totalMarks, modes, override)).toThrowError(
          expect.objectContaining({ code: 'BAD_REQUEST', message }),
        );
      },
    );
  });

  describe('plan and revision guards', () => {
    it('allows result changes only for active plans', () => {
      expect(() => requireActivePlan(plan())).not.toThrow();
      for (const status of ['draft', 'approved', 'completed'] as const) {
        expect(() => requireActivePlan(plan({ status }))).toThrowError(
          expect.objectContaining({
            code: 'BAD_REQUEST',
            message: 'Results can only be changed while the exam plan is active.',
          }),
        );
      }
    });

    it('requires elevated revision permission only for approved results', () => {
      expect(() => requireRevisionPermission(false, false)).not.toThrow();
      expect(() => requireRevisionPermission(true, true)).not.toThrow();
      expect(() => requireRevisionPermission(true, false)).toThrowError(
        expect.objectContaining({ code: 'FORBIDDEN' }),
      );
    });
  });

  describe('result validation', () => {
    it('accepts exactly the configured modes up to their maximum marks', () => {
      expect(() =>
        validateResultMarks(plan(), { written: 80, practical: 20 }),
      ).not.toThrow();
    });

    it.each([
      ['missing modes', { written: 50 }],
      ['extra modes', { written: 50, practical: 10, oral: 5 }],
      ['renamed modes', { theory: 50, practical: 10 }],
    ])('rejects %s', (_case, marks) => {
      expect(() => validateResultMarks(plan(), marks)).toThrowError(
        expect.objectContaining({
          code: 'BAD_REQUEST',
          message: 'Marks must include exactly the exam plan’s assessment modes.',
        }),
      );
    });

    it('rejects marks above the configured mode maximum', () => {
      expect(() =>
        validateResultMarks(plan(), { written: 80.1, practical: 20 }),
      ).toThrowError(
        expect.objectContaining({
          code: 'BAD_REQUEST',
          message: 'Marks for written cannot exceed 80.',
        }),
      );
    });

    it('rejects co-scholastic areas not configured for the session', () => {
      const config = sessionConfigSchema.parse({
        coScholasticAreas: { art: { name: 'Art' } },
      });

      expect(() =>
        validateResult(
          plan(),
          config,
          result({ coScholastics: { sports: 'A' } }),
        ),
      ).toThrowError(
        expect.objectContaining({
          code: 'BAD_REQUEST',
          message: 'Unknown co-scholastic area: sports.',
        }),
      );
    });

    it('allows configured co-scholastic areas', () => {
      const config = sessionConfigSchema.parse({
        coScholasticAreas: { art: { name: 'Art' } },
      });

      expect(() =>
        validateResult(
          plan(),
          config,
          result({ coScholastics: { art: 'A+' } }),
        ),
      ).not.toThrow();
    });

    it('requires enabled attendance tracking before recording attendance', () => {
      expect(() =>
        validateResult(
          plan({ totalWorkingDays: 200 }),
          sessionConfigSchema.parse({}),
          result({ daysAttended: 180 }),
        ),
      ).toThrowError(
        expect.objectContaining({
          code: 'BAD_REQUEST',
          message: 'Attendance tracking is disabled for this session.',
        }),
      );
    });

    it('requires total working days before recording attendance', () => {
      expect(() =>
        validateResult(
          plan(),
          sessionConfigSchema.parse({ attendanceTracking: { enabled: true } }),
          result({ daysAttended: 180 }),
        ),
      ).toThrowError(
        expect.objectContaining({
          code: 'BAD_REQUEST',
          message: 'Set the plan’s total working days before recording attendance.',
        }),
      );
    });

    it('rejects attendance above total working days and accepts its boundary', () => {
      const config = sessionConfigSchema.parse({
        attendanceTracking: { enabled: true },
      });
      expect(() =>
        validateResult(
          plan({ totalWorkingDays: 200 }),
          config,
          result({ daysAttended: 201 }),
        ),
      ).toThrowError(
        expect.objectContaining({
          code: 'BAD_REQUEST',
          message: 'Days attended cannot exceed total working days.',
        }),
      );
      expect(() =>
        validateResult(
          plan({ totalWorkingDays: 200 }),
          config,
          result({ daysAttended: 200 }),
        ),
      ).not.toThrow();
    });

    it('does not require attendance configuration when attendance is omitted', () => {
      expect(() =>
        validateResult(plan(), sessionConfigSchema.parse({}), result()),
      ).not.toThrow();
    });
  });
});
