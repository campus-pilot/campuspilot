import {
  examNameKey,
  examNameSchema,
  examSlugSchema,
  findExamNameClash,
  findIntroducedExamNameClashes,
  nextExamOrder,
  sessionConfigSchema,
} from '@campuspilot/db/schema/jsonb/session-config';
import { describe, expect, it } from 'vitest';
import { ORPCError } from '@orpc/server';

import { toRpcError } from '../../../errors';
import {
  EXAM_NAME_TAKEN_MESSAGE,
  EXAM_NAME_TAKEN_REASON,
  EXAM_SLUG_TAKEN_MESSAGE,
  EXAM_SLUG_TAKEN_REASON,
  isExamNameTakenError,
  isExamSlugTakenError,
} from './exam-definition.contract';
import { examNameTakenError } from './exam.service';

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

describe('new exam order and slug rules', () => {
  it('lists a new exam after the highest order, which is n + 1 for contiguous orders', () => {
    expect(nextExamOrder({})).toBe(1);
    expect(
      nextExamOrder({ a: { order: 1 }, b: { order: 2 }, c: { order: 3 } }),
    ).toBe(4);
  });

  it('does not reuse an order when stored orders have a gap, are unsorted or tie', () => {
    expect(nextExamOrder({ a: { order: 1 }, b: { order: 3 } })).toBe(4);
    expect(nextExamOrder({ a: { order: 5 }, b: { order: 2 } })).toBe(6);
    expect(nextExamOrder({ a: { order: 2 }, b: { order: 2 } })).toBe(3);
  });

  it('accepts slugs in the session settings format only, trimmed, reporting an empty one once', () => {
    expect(examSlugSchema.parse('  unit_test_1 ')).toBe('unit_test_1');
    for (const slug of ['Unit', 'unit-test', 'unit test', 'é', 'a'.repeat(101)])
      expect(examSlugSchema.safeParse(slug).success).toBe(false);
    const empty = examSlugSchema.safeParse('  ');
    expect(empty.success).toBe(false);
    expect(empty.error?.issues.map((issue) => issue.message)).toEqual([
      'Exam slug is required',
    ]);
  });

  it('refuses the slugs a plain object already answers for, which record parsing would drop', () => {
    for (const slug of ['__proto__', 'constructor', 'prototype', ' __proto__ ']) {
      const result = examSlugSchema.safeParse(slug);
      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.message)).toEqual([
        'This slug is reserved. Choose another slug.',
      ]);
    }
    // Only the exact names are reserved.
    for (const slug of ['proto', '_proto_', 'constructor_1', 'prototypes'])
      expect(examSlugSchema.parse(slug)).toBe(slug);
  });
});

describe('isExamSlugTakenError', () => {
  it('is false for the CONFLICTs the shared error mapping makes from database failures', () => {
    for (const code of ['23505', '40001', '40P01']) {
      const mapped = toRpcError({ message: 'database', cause: { code } });
      expect(mapped.code).toBe('CONFLICT');
      expect(isExamSlugTakenError(mapped)).toBe(false);
    }
  });

  it('is true only for CONFLICT carrying the taken-slug reason', () => {
    const taken = new ORPCError('CONFLICT', {
      message: EXAM_SLUG_TAKEN_MESSAGE,
      data: { reason: EXAM_SLUG_TAKEN_REASON },
    });
    expect(isExamSlugTakenError(taken)).toBe(true);
    expect(isExamSlugTakenError(toRpcError(taken))).toBe(true);
    expect(
      isExamSlugTakenError(
        new ORPCError('FORBIDDEN', { data: { reason: EXAM_SLUG_TAKEN_REASON } }),
      ),
    ).toBe(false);
  });
});

describe('exam name rule', () => {
  it('compares names trimmed and ignoring case, with whitespace runs collapsed', () => {
    expect(examNameKey('  Unit Test 1 ')).toBe('unit test 1');
    expect(examNameKey('UNIT TEST 1')).toBe(examNameKey(' unit test 1 '));
    // Unicode spaces are trimmed too.
    expect(examNameKey('\u00a0Final\u2003')).toBe('final');
    // Inner runs of any whitespace are one space.
    expect(examNameKey('Unit  Test')).toBe(examNameKey('Unit Test'));
    expect(examNameKey('Unit\t\n Test')).toBe('unit test');
    expect(examNameKey('Unit\u00a0\u3000Test')).toBe('unit test');
    // Removing a space is still another name.
    expect(examNameKey('UnitTest')).not.toBe(examNameKey('Unit Test'));
  });

  it('ignores invisible format characters', () => {
    for (const invisible of ['\u200b', '\u200c', '\u200d', '\u2060', '\ufeff', '\u00ad', '\u202e'])
      expect(examNameKey(`Fi${invisible}nal`)).toBe('final');
    expect(examNameKey('\u200bFinal\u200b')).toBe('final');
    // A format character between spaces leaves one space.
    expect(examNameKey('Unit \u200b Test')).toBe('unit test');
    expect(examNameKey('\u200b\u200d \ufeff')).toBe('');
  });

  it('compares Unicode compatibility forms as the same name', () => {
    // Full-width letters and digits.
    expect(examNameKey('\uff26\uff49\uff4e\uff41\uff4c \uff11')).toBe('final 1');
    // The fi ligature.
    expect(examNameKey('\ufb01nal')).toBe('final');
    // A superscript digit is its digit.
    expect(examNameKey('Unit Test \u00b9')).toBe('unit test 1');
  });

  it('folds case without depending on the runtime locale, and composes Unicode first', () => {
    // A Turkish locale would give dotless ı; the fixed locale keeps i.
    expect(examNameKey('FINAL I')).toBe('final i');
    expect(examNameKey('ÉPREUVE')).toBe('épreuve');
    // Precomposed é and e + combining acute are the same name.
    expect(examNameKey('Examen e\u0301crit')).toBe(examNameKey('Examen \u00e9crit'));
    // Scripts without case are compared as written.
    expect(examNameKey(' परीक्षा ')).toBe('परीक्षा');
  });

  it('finds another exam with the name, never the exam being renamed', () => {
    const exams = {
      unit_test_1: { name: 'Unit Test 1' },
      annual: { name: 'Annual' },
    };
    expect(findExamNameClash(exams, ' unit test 1 ')).toBe('unit_test_1');
    expect(findExamNameClash(exams, 'Unit Test 2')).toBeUndefined();
    expect(findExamNameClash(exams, 'UNIT TEST 1', 'unit_test_1')).toBeUndefined();
    expect(findExamNameClash(exams, 'annual', 'unit_test_1')).toBe('annual');
    expect(findExamNameClash({}, 'Annual')).toBeUndefined();
  });

  it('answers the first clashing slug in slug order when stored duplicates exist', () => {
    expect(
      findExamNameClash({ b: { name: 'Final' }, a: { name: 'final' } }, 'FINAL'),
    ).toBe('a');
  });

  it('reports a clash a full replacement introduces with a new or renamed exam', () => {
    const stored = { first: { name: 'First Term' }, second: { name: 'Second Term' } };
    expect(
      findIntroducedExamNameClashes(stored, { ...stored, extra: { name: ' first term' } }),
    ).toEqual([['extra', 'first']]);
    expect(
      findIntroducedExamNameClashes(stored, { ...stored, second: { name: 'FIRST TERM' } }),
    ).toEqual([['first', 'second']]);
    // Renaming the slug of an exam makes it a new exam.
    expect(
      findIntroducedExamNameClashes(
        { a: { name: 'Final' }, b: { name: 'Final' } },
        { a: { name: 'Final' }, c: { name: 'Final' } },
      ),
    ).toEqual([['a', 'c']]);
  });

  it('keeps accepting duplicates that were already stored, including case-only changes', () => {
    const stored = { a: { name: 'Final' }, b: { name: 'final ' }, c: { name: 'Annual' } };
    expect(findIntroducedExamNameClashes(stored, stored)).toEqual([]);
    expect(
      findIntroducedExamNameClashes(stored, {
        a: { name: 'FINAL' },
        b: { name: 'final' },
        c: { name: 'Annual Exam' },
        d: { name: 'Unit Test' },
      }),
    ).toEqual([]);
    expect(findIntroducedExamNameClashes({}, {})).toEqual([]);
  });

  it('treats every exam of a new session as new', () => {
    expect(
      findIntroducedExamNameClashes({}, { a: { name: 'Final' }, b: { name: 'FINAL' } }),
    ).toEqual([['a', 'b']]);
  });
});

describe('exam name schema', () => {
  it('trims a name and keeps its case and inner spacing as given', () => {
    expect(examNameSchema.parse('  Unit  Test 1 ')).toBe('Unit  Test 1');
  });

  it('refuses an empty name once, as required', () => {
    for (const name of ['', '   ']) {
      const result = examNameSchema.safeParse(name);
      expect(result.error?.issues.map((issue) => issue.message)).toEqual([
        'Exam name is required',
      ]);
    }
  });

  it('refuses a name made only of invisible characters', () => {
    for (const name of ['\u200b', ' \u200b\u200d ', '\ufeff\u2060']) {
      const result = examNameSchema.safeParse(name);
      expect(result.error?.issues.map((issue) => issue.message)).toEqual([
        'Exam name must contain visible characters',
      ]);
    }
  });

  it('accepts up to 200 characters', () => {
    expect(examNameSchema.safeParse('a'.repeat(200)).success).toBe(true);
    expect(
      examNameSchema.safeParse('a'.repeat(201)).error?.issues.map((issue) => issue.message),
    ).toEqual(['Exam name must be 200 characters or fewer']);
  });
});

describe('isExamNameTakenError', () => {
  it('is true only for CONFLICT carrying the taken-name reason', () => {
    const taken = examNameTakenError();
    expect(taken).toMatchObject({
      code: 'CONFLICT',
      message: EXAM_NAME_TAKEN_MESSAGE,
      data: { reason: EXAM_NAME_TAKEN_REASON },
    });
    expect(isExamNameTakenError(taken)).toBe(true);
    expect(isExamNameTakenError(toRpcError(taken))).toBe(true);
    expect(isExamSlugTakenError(taken)).toBe(false);
    expect(
      isExamNameTakenError(
        new ORPCError('CONFLICT', {
          message: EXAM_SLUG_TAKEN_MESSAGE,
          data: { reason: EXAM_SLUG_TAKEN_REASON },
        }),
      ),
    ).toBe(false);
    for (const code of ['23505', '40001', '40P01'])
      expect(
        isExamNameTakenError(toRpcError({ message: 'database', cause: { code } })),
      ).toBe(false);
    expect(
      isExamNameTakenError(
        new ORPCError('BAD_REQUEST', { data: { reason: EXAM_NAME_TAKEN_REASON } }),
      ),
    ).toBe(false);
  });
});
