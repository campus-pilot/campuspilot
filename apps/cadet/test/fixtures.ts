import type {
  CadetExamListItemDto,
  CadetExamResultDto,
  CadetFeeSummaryDto,
  CadetGrowthDto,
  CadetLedgerEntryDto,
  CadetNoticeDocumentDto,
  CadetNoticeDto,
  CadetProfileDto,
} from '@campuspilot/api/routers/cadet/cadet.dto';

/** Fictional Cadet Portal data for component tests. */
export const profile: CadetProfileDto = {
  name: 'Meera Singh',
  admissionNo: 'GV-1042',
  schoolName: 'Greenfield Valley School',
  current: { recordId: 'stu_b.cls7', classLabel: 'Class 7', sectionLabel: 'B', sessionLabel: '2026–27', rollNo: 14 },
  enrollments: [
    { studentId: 'stu_b', sessionId: 's2', sessionLabel: '2026–27', sessionIsActive: true, classLabel: 'Class 7', sectionLabel: 'B', rollNo: 14 },
    { studentId: 'stu_a', sessionId: 's1', sessionLabel: '2025–26', sessionIsActive: false, classLabel: 'Class 6', sectionLabel: 'A', rollNo: 9 },
  ],
};

export const newStudent: CadetProfileDto = { ...profile, current: null, enrollments: [] };

export const summary: CadetFeeSummaryDto = {
  currencies: [
    { currency: 'INR', balanceMinor: '685000', dueMinor: '685000', creditMinor: '0', billedMinor: '2475000', paidMinor: '1740000', concessionsMinor: '50000', refundedMinor: '0' },
  ],
};

export const ledgerEntries: CadetLedgerEntryDto[] = [
  {
    id: 'l3', sessionId: 's2', type: 'payment', direction: 'credit', amountMinor: '235000', currency: 'INR',
    effectiveAt: new Date('2026-10-18T05:00:00Z'), timeZone: 'Asia/Kolkata', runningBalanceMinor: '200000', reversed: false,
    reference: 'RC-2026-0981', billId: null, paymentMethod: 'bank_transfer',
  },
  {
    id: 'l2', sessionId: 's2', type: 'discount', direction: 'credit', amountMinor: '50000', currency: 'INR',
    effectiveAt: new Date('2026-10-05T05:00:00Z'), timeZone: 'Asia/Kolkata', runningBalanceMinor: '435000', reversed: false,
    reference: null, billId: null, paymentMethod: null,
  },
  {
    id: 'l1', sessionId: 's2', type: 'bill', direction: 'debit', amountMinor: '485000', currency: 'INR',
    effectiveAt: new Date('2026-09-30T20:00:00Z'), timeZone: 'Asia/Kolkata', runningBalanceMinor: '485000', reversed: false,
    reference: 'BL-2026-1006', billId: 'fbill_1', paymentMethod: null,
  },
];

const exam = (overrides: Partial<CadetExamListItemDto>): CadetExamListItemDto => ({
  examId: 'stu_b.cls7.ut1', recordId: 'stu_b.cls7', examSlug: 'ut1', name: 'Unit Test 1', order: 1,
  state: 'released', releasedAt: new Date('2026-08-02T00:00:00Z'), percentage: 79.1, grade: 'B+', ...overrides,
});

export const exams: CadetExamListItemDto[] = [
  exam({}),
  exam({ examId: 'stu_b.cls7.hy', examSlug: 'hy', name: 'Half-Yearly', order: 2, releasedAt: new Date('2026-10-04T00:00:00Z'), percentage: 82.4, grade: 'A' }),
  exam({ examId: 'stu_b.cls7.ut2', examSlug: 'ut2', name: 'Unit Test 2', order: 3, state: 'awaiting_release', releasedAt: null, percentage: null, grade: null }),
  exam({ examId: 'stu_b.cls7.annual', examSlug: 'annual', name: 'Annual', order: 4, state: 'upcoming', releasedAt: null, percentage: null, grade: null }),
];

export const examResult: CadetExamResultDto = {
  examId: 'stu_b.cls7.hy', recordId: 'stu_b.cls7', name: 'Half-Yearly', sessionLabel: '2026–27', classLabel: 'Class 7', sectionLabel: 'B',
  releasedAt: new Date('2026-10-04T00:00:00Z'),
  overall: { obtained: 164.8, max: 200, percentage: 82.4, grade: 'A' },
  previousExam: { examId: 'stu_b.cls7.ut1', name: 'Unit Test 1', percentage: 79.1 },
  classAveragePercentage: null,
  attendance: { daysAttended: 96, totalWorkingDays: 102 },
  subjects: [
    { subjectId: 'stu_b.cls7.maths', name: 'Mathematics', obtained: 92, max: 100, percentage: 92, grade: 'A+', modes: [{ name: 'Written', obtained: 92, max: 100 }], previousPercentage: 81, classAveragePercentage: null },
    { subjectId: 'stu_b.cls7.sst', name: 'Social Science', obtained: 64, max: 100, percentage: 64, grade: 'B', modes: [{ name: 'Written', obtained: 64, max: 100 }], previousPercentage: 72, classAveragePercentage: null },
  ],
  coScholastics: [{ area: 'Art education', grade: 'A' }],
  remark: { text: 'Excellent progress in Mathematics.', authorName: 'Ms. Kavya Iyer', updatedAt: new Date('2026-10-03T00:00:00Z') },
};

export const growth: CadetGrowthDto = {
  classAveragesShared: true,
  classes: [
    { recordId: 'stu_b.cls7', classLabel: 'Class 7', sectionLabel: 'B', sessionLabel: '2026–27', sessionIsActive: true, latest: { examName: 'Half-Yearly', percentage: 82.4, classAveragePercentage: 69.9 } },
    { recordId: 'stu_a.cls6', classLabel: 'Class 6', sectionLabel: 'A', sessionLabel: '2025–26', sessionIsActive: false, latest: { examName: 'Annual', percentage: 75.8, classAveragePercentage: null } },
  ],
  selected: {
    recordId: 'stu_b.cls7',
    subjects: [
      { subjectId: 'stu_b.cls7.maths', name: 'Mathematics' },
      { subjectId: 'stu_b.cls7.sst', name: 'Social Science' },
    ],
    exams: [
      { examId: 'stu_b.cls7.ut1', name: 'Unit Test 1', percentage: 79.1, classAveragePercentage: 69.4, subjects: { 'stu_b.cls7.maths': 81, 'stu_b.cls7.sst': 72 }, subjectAverages: { 'stu_b.cls7.maths': 64, 'stu_b.cls7.sst': 67 } },
      { examId: 'stu_b.cls7.hy', name: 'Half-Yearly', percentage: 82.4, classAveragePercentage: 69.9, subjects: { 'stu_b.cls7.maths': 92, 'stu_b.cls7.sst': 64 }, subjectAverages: { 'stu_b.cls7.maths': 66, 'stu_b.cls7.sst': 68 } },
    ],
  },
};

/** Notices addressed to the student, newest first. */
export const notices: Pick<CadetNoticeDto, 'noticeId' | 'title' | 'publishedAt'>[] = [
  { noticeId: 'ntc_uniform', title: 'Winter uniform from Monday', publishedAt: new Date('2026-11-03T05:30:00Z') },
  { noticeId: 'ntc_sports', title: 'Annual Sports Day', publishedAt: new Date('2026-10-20T05:30:00Z') },
];

/** A notice written as plain text. */
export const plainNotice: CadetNoticeDto = {
  ...notices[0]!,
  bodyMode: 'plain',
  text: 'Winter uniform is compulsory from Monday, 9 November.\nBlazers may be collected from the school store.\n\nClass teachers will check uniforms during assembly.',
};

/** A notice designed as a document: its wording as text, and its printed page from a separate read. */
export const designedNotice: CadetNoticeDto = {
  ...notices[1]!,
  bodyMode: 'template',
  text: 'Annual Sports Day\n\nGates open at 8 AM.',
};

/** The printed page of {@link designedNotice} (`getNoticeDocument`). */
export const designedNoticePage: CadetNoticeDocumentDto = {
  noticeId: designedNotice.noticeId,
  html: '<!doctype html><html><body><h1>Annual Sports Day</h1></body></html>',
};

/** The server's answer when the school does not have a feature (`docs/feature-flags.md`). */
export function featureDisabledError(feature: 'cadet' | 'notices') {
  return Object.assign(new Error(`${feature} is not enabled for this school.`), {
    code: 'FORBIDDEN',
    status: 403,
    data: { reason: 'SCHOOL_FEATURE_DISABLED', feature },
  });
}
