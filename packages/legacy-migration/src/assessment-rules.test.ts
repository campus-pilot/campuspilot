import { describe, expect, it } from 'vitest';

import { analyzeAssessments, type AssessmentRow, type SubjectPlan } from './assessment-rules.ts';

const plans: SubjectPlan[] = [
  { id: 'p1', examKey: 'session:term', subjectKey: 'english', totalWorkingDays: 81 },
  { id: 'p2', examKey: 'session:term', subjectKey: 'maths', totalWorkingDays: 81 },
];
const base: AssessmentRow[] = [
  { id: 'r1', planId: 'p1', studentId: 's1', approved: true, daysAttended: null, coScholastic: null },
  { id: 'r2', planId: 'p2', studentId: 's1', approved: true, daysAttended: 52, coScholastic: { discipline: 'A2' } },
];

describe('assessment migration rules', () => {
  it('ignores leading null exam-wide values when populated values agree', () => {
    expect(analyzeAssessments(plans, base).issues).toEqual([]);
  });

  it.each([
    ['missing approval', [{ ...base[0]!, approved: null }, base[1]!], 'E_APPROVAL_MISSING'],
    ['approval conflict', [base[0]!, { ...base[1]!, approved: false }], 'E_APPROVAL_CONFLICT'],
    ['attendance conflict', [{ ...base[0]!, daysAttended: 51 }, base[1]!], 'E_ATTENDANCE_CONFLICT'],
    ['co-scholastic conflict', [{ ...base[0]!, coScholastic: { discipline: 'A1' } }, base[1]!], 'E_CO_SCHOLASTIC_CONFLICT'],
    ['negative attendance', [base[0]!, { ...base[1]!, daysAttended: -1 }], 'E_ATTENDANCE_RANGE'],
    ['fractional attendance', [base[0]!, { ...base[1]!, daysAttended: 1.5 }], 'E_ATTENDANCE_RANGE'],
    ['attendance above working days', [base[0]!, { ...base[1]!, daysAttended: 82 }], 'E_ATTENDANCE_RANGE'],
    ['incomplete subject set', [base[0]!], 'E_INCOMPLETE_SUBJECT_SET'],
  ] as const)('rejects %s', (_label, rows, code) => {
    expect(analyzeAssessments(plans, [...rows]).issues.map((issue) => issue.code)).toContain(code);
  });

  it('reports conflicting working-day values as non-approvable', () => {
    const result = analyzeAssessments([{ ...plans[0]! }, { ...plans[1]!, totalWorkingDays: 80 }], base);
    expect(result.workingDays[0]?.agreedTotalWorkingDays).toBeNull();
    expect(result.issues.map((issue) => issue.code)).toContain('E_TOTAL_WORKING_DAYS_CONFLICT');
  });

  it('requires a populated working-day decision before attendance can migrate', () => {
    const result = analyzeAssessments(plans.map((plan) => ({ ...plan, totalWorkingDays: null })), base);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['E_TOTAL_WORKING_DAYS_CONFLICT', 'E_ATTENDANCE_RANGE']),
    );
  });
});
