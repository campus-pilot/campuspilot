import { expect, it } from 'vitest';
import { validateSourceRows } from './source-validation.ts';

it('keeps structural source failures non-approvable', () => {
  const result = validateSourceRows({
    schools: [{ id: 'school' }], sessions: [{ id: 'session', school_id: 'school' }],
    classes: [{ id: 'class', school_id: 'school' }], sections: [{ id: 'section', class_id: 'class', school_id: 'school' }],
    admissions: [{ id: 'admission', school_id: 'school', admissionNo: '1' }],
    students: [{ id: 'student', school_id: 'school', admission_id: 'missing', session_id: 'session', class_id: 'class', section_id: 'section' }],
    staff: [], plans: [], results: [], timetables: [], billRuns: [],
    bills: [{ id: 'bill', student_id: 'student', amount: '2.00', version: 1, line_items: { fee: { amount: '1.00' } } }], ledger: [],
  });
  expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['A_REQUIRED_FIELD', 'A_ENROLLMENT_RELATIONSHIP', 'F_BILL_TOTAL']));
  expect(result.issues.every((issue) => issue.severity === 'blocking')).toBe(true);
  expect(result.rebuildExceptions).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'F_STANDALONE_MANUAL_FALLBACK', sourceKey: 'bill' }),
    expect.objectContaining({ code: 'F_PROJECTION_REBUILD', sourceKey: 'student', evidence: expect.objectContaining({ status: 'missing' }) }),
  ]));
});

it('classifies a stale projection and mismatched bill-run header as tracked rebuild decisions', () => {
  const result = validateSourceRows({
    schools: [{ id: 'school', active_session_id: 'session', finance_schema: { currency: 'INR', recurring: 'monthly', elements: {} } }],
    sessions: [{ id: 'session', school_id: 'school', sessionStartYear: 2026, sessionEndYear: 2027, sessionConfig: { examConfig: {} } }],
    classes: [], sections: [], admissions: [],
    students: [{ id: 'student', school_id: 'school' }],
    staff: [{ id: 'staff', school_id: 'school', email: 'staff@example.invalid', role: 'admin', attributes: {} }],
    plans: [], results: [], timetables: [],
    billRuns: [{ id: 'run', school_id: 'school', session_id: 'session', generated_by: 'staff', meta: { studentCount: 9, totalAmount: '999.00' } }],
    bills: [{ id: 'bill', student_id: 'student', bill_event_id: 'run', amount: '1.00', version: 1, line_items: { fee: { amount: '1.00' } } }],
    ledger: [],
    billProjections: [{ student_id: 'student', total_billed: '2.00', last_version: 2 }],
    ledgerProjections: [{ student_id: 'student', total_paid: '0.00', total_discount: '0.00', outstanding: '2.00', last_bill_version: 2, last_ledger_version: 0 }],
  });
  expect(result.rebuildExceptions).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'F_BILL_RUN_HEADER_REBUILD', sourceKey: 'run', disposition: 'rebuild-from-member-bills' }),
    expect.objectContaining({ code: 'F_PROJECTION_REBUILD', sourceKey: 'student', disposition: 'rebuild-from-events', evidence: expect.objectContaining({ status: 'stale' }) }),
  ]));
});
