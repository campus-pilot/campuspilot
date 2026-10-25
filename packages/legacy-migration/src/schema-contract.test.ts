import { PREFIX_MAP, entityIdSchema } from '@campuspilot/db/id';
import { describe, expect, it } from 'vitest';

describe('legacy-compatible target schema contracts', () => {
  it('keeps the examination prefixes required for verbatim legacy IDs', () => {
    expect(PREFIX_MAP.examPlan).toBe('expl');
    expect(PREFIX_MAP.examResult).toBe('exrs');
    expect(PREFIX_MAP.examTimetable).toBe('ett');
    expect(
      entityIdSchema('examPlan').safeParse('expl_123456789012345678901').success,
    ).toBe(true);
    expect(
      entityIdSchema('examPlan').safeParse('exp_123456789012345678901').success,
    ).toBe(false);
  });
});
