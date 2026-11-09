/**
 * Fictional data for the Cadet Portal UX concept (`/concept/*`). Nothing here
 * comes from a real or imported school, and no screen in the concept calls the
 * API. The shapes deliberately mirror what the server could return later so
 * the screens show which facts each view needs:
 *
 * - `releasedToCadetAt` is its own field and is never derived from the exam
 *   lifecycle. A completed exam stays hidden until the school releases it.
 * - `classAverage` is only present when the school chooses to show it.
 * - `remark` is a teacher's comment that is not stored anywhere today.
 */

export type Student = {
  name: string;
  initials: string;
  admissionNo: string;
  className: string;
  section: string;
  rollNo: number;
  session: string;
  school: string;
  guardian: string;
};

export const student: Student = {
  name: 'Aarav Mehta',
  initials: 'AM',
  admissionNo: 'GV-1042',
  className: 'Class 7',
  section: 'B',
  rollNo: 14,
  session: '2026–27',
  school: 'Greenfield Valley School',
  guardian: 'Rohit Mehta',
};

export type Sibling = { name: string; initials: string; className: string };

/** Another child of the same guardian; sibling switching is a future feature. */
export const siblings: Sibling[] = [
  { name: 'Aarav Mehta', initials: 'AM', className: 'Class 7 · B' },
  { name: 'Diya Mehta', initials: 'DM', className: 'Class 3 · A' },
];

export type BillStatus = 'paid' | 'due' | 'overdue';

export type BillLine = { label: string; amount: number };

/** Everything credited against one bill: payments and concessions, each with its own document. */
export type BillCredit = { label: string; reference: string; amount: number };

export type Bill = {
  id: string;
  number: string;
  period: string;
  issuedOn: string;
  /** Not stored today: `finance_bill` has an issue date and period, no due date. */
  dueOn: string;
  total: number;
  status: BillStatus;
  lines: BillLine[];
  credits: BillCredit[];
};

const regularLines: BillLine[] = [
  { label: 'Tuition fee', amount: 3600 },
  { label: 'Transport (Route 4)', amount: 1050 },
  { label: 'Computer lab', amount: 200 },
];

export const bills: Bill[] = [
  { id: 'bl-1107', number: 'BL-2026-1107', period: 'November 2026', issuedOn: '1 Nov 2026', dueOn: '10 Nov 2026', total: 4850, status: 'due', lines: regularLines, credits: [] },
  {
    id: 'bl-1006', number: 'BL-2026-1006', period: 'October 2026', issuedOn: '1 Oct 2026', dueOn: '10 Oct 2026', total: 4850, status: 'overdue', lines: regularLines,
    credits: [
      { label: 'Sibling concession', reference: 'AD-2026-0031', amount: 500 },
      { label: 'Payment · UPI', reference: 'RC-2026-0981', amount: 2350 },
    ],
  },
  {
    id: 'bl-0905', number: 'BL-2026-0905', period: 'September 2026', issuedOn: '1 Sep 2026', dueOn: '10 Sep 2026', total: 5350, status: 'paid',
    lines: [...regularLines, { label: 'Half-yearly exam fee', amount: 500 }],
    credits: [{ label: 'Payment · Bank transfer', reference: 'RC-2026-0874', amount: 5350 }],
  },
  { id: 'bl-0804', number: 'BL-2026-0804', period: 'August 2026', issuedOn: '1 Aug 2026', dueOn: '10 Aug 2026', total: 4850, status: 'paid', lines: regularLines, credits: [{ label: 'Payment · Cash', reference: 'RC-2026-0712', amount: 4850 }] },
  { id: 'bl-0703', number: 'BL-2026-0703', period: 'July 2026', issuedOn: '1 Jul 2026', dueOn: '10 Jul 2026', total: 4850, status: 'paid', lines: regularLines, credits: [{ label: 'Payment · Cheque', reference: 'RC-2026-0563', amount: 4850 }] },
];

/** Mirrors the management ledger's entry types; the portal shows them in plain words. */
export type LedgerEntryType = 'bill' | 'payment' | 'discount' | 'waiver' | 'refund' | 'opening';

/**
 * One row of the admission ledger, newest first. Exactly one of `debit` /
 * `credit` is set, and `balance` is the running balance after this entry, as
 * in the management ledger. `billId` links bill rows to their detail screen.
 */
export type LedgerEntry = {
  id: string;
  month: string;
  date: string;
  type: LedgerEntryType;
  title: string;
  detail: string;
  reference: string;
  debit: number | null;
  credit: number | null;
  balance: number;
  billId?: string;
  billStatus?: BillStatus;
};

export const ledger: LedgerEntry[] = [
  { id: 'l10', month: 'November 2026', date: '1 Nov', type: 'bill', title: 'November fees', detail: 'Due 10 Nov', reference: 'BL-2026-1107', debit: 4850, credit: null, balance: 6850, billId: 'bl-1107', billStatus: 'due' },
  { id: 'l9', month: 'October 2026', date: '18 Oct', type: 'payment', title: 'Payment received', detail: 'UPI', reference: 'RC-2026-0981', debit: null, credit: 2350, balance: 2000 },
  { id: 'l8', month: 'October 2026', date: '5 Oct', type: 'discount', title: 'Sibling concession', detail: 'Approved by office', reference: 'AD-2026-0031', debit: null, credit: 500, balance: 4350 },
  { id: 'l7', month: 'October 2026', date: '1 Oct', type: 'bill', title: 'October fees', detail: 'Due 10 Oct', reference: 'BL-2026-1006', debit: 4850, credit: null, balance: 4850, billId: 'bl-1006', billStatus: 'overdue' },
  { id: 'l6', month: 'September 2026', date: '8 Sep', type: 'payment', title: 'Payment received', detail: 'Bank transfer', reference: 'RC-2026-0874', debit: null, credit: 5350, balance: 0 },
  { id: 'l5', month: 'September 2026', date: '1 Sep', type: 'bill', title: 'September fees', detail: 'Incl. half-yearly exam fee', reference: 'BL-2026-0905', debit: 5350, credit: null, balance: 5350, billId: 'bl-0905', billStatus: 'paid' },
  { id: 'l4', month: 'August 2026', date: '9 Aug', type: 'payment', title: 'Payment received', detail: 'Cash', reference: 'RC-2026-0712', debit: null, credit: 4850, balance: 0 },
  { id: 'l3', month: 'August 2026', date: '1 Aug', type: 'bill', title: 'August fees', detail: 'Due 10 Aug', reference: 'BL-2026-0804', debit: 4850, credit: null, balance: 4850, billId: 'bl-0804', billStatus: 'paid' },
  { id: 'l2', month: 'July 2026', date: '6 Jul', type: 'payment', title: 'Payment received', detail: 'Cheque', reference: 'RC-2026-0563', debit: null, credit: 4850, balance: 0 },
  { id: 'l1', month: 'July 2026', date: '1 Jul', type: 'bill', title: 'July fees', detail: 'Due 10 Jul', reference: 'BL-2026-0703', debit: 4850, credit: null, balance: 4850, billId: 'bl-0703', billStatus: 'paid' },
  { id: 'l0', month: 'April 2026', date: '1 Apr', type: 'opening', title: 'Carried from 2025–26', detail: 'Opening balance', reference: '—', debit: null, credit: null, balance: 0 },
];

/** Session totals; billed − paid − concessions = outstanding. */
export const feeSummary = {
  outstanding: 6850,
  nextDueOn: '10 Nov 2026',
  billed: 24_750,
  paid: 17_400,
  concessions: 500,
};

export type SubjectResult = {
  subject: string;
  short: string;
  obtained: number;
  max: number;
  grade: string;
  previous: number | null;
  classAverage: number | null;
  modes: { label: string; obtained: number; max: number }[];
};

export type ExamStatus = 'released' | 'awaiting_release' | 'in_progress' | 'upcoming';

export type Exam = {
  slug: string;
  name: string;
  session: string;
  window: string;
  status: ExamStatus;
  /** When the school made the results visible in the Cadet Portal. */
  releasedToCadetAt: string | null;
  percentage: number | null;
  grade: string | null;
  attendance: { present: number; total: number } | null;
  remark: { teacher: string; role: string; text: string } | null;
  coScholastic: { area: string; grade: string }[];
  subjects: SubjectResult[];
};

const halfYearlySubjects: SubjectResult[] = [
  { subject: 'English', short: 'Eng', obtained: 84, max: 100, grade: 'A', previous: 78, classAverage: 71, modes: [{ label: 'Written', obtained: 68, max: 80 }, { label: 'Oral', obtained: 16, max: 20 }] },
  { subject: 'Hindi', short: 'Hin', obtained: 76, max: 100, grade: 'B+', previous: 80, classAverage: 74, modes: [{ label: 'Written', obtained: 60, max: 80 }, { label: 'Oral', obtained: 16, max: 20 }] },
  { subject: 'Mathematics', short: 'Math', obtained: 92, max: 100, grade: 'A+', previous: 81, classAverage: 66, modes: [{ label: 'Written', obtained: 92, max: 100 }] },
  { subject: 'Science', short: 'Sci', obtained: 88, max: 100, grade: 'A', previous: 85, classAverage: 70, modes: [{ label: 'Theory', obtained: 70, max: 80 }, { label: 'Practical', obtained: 18, max: 20 }] },
  { subject: 'Social Science', short: 'SSt', obtained: 64, max: 100, grade: 'B', previous: 72, classAverage: 68, modes: [{ label: 'Written', obtained: 64, max: 100 }] },
  { subject: 'Computer', short: 'Comp', obtained: 47, max: 50, grade: 'A+', previous: 88, classAverage: 78, modes: [{ label: 'Theory', obtained: 28, max: 30 }, { label: 'Practical', obtained: 19, max: 20 }] },
];

export const exams: Exam[] = [
  {
    slug: 'unit-test-2',
    name: 'Unit Test 2',
    session: '2026–27',
    window: '3 – 7 Nov 2026',
    status: 'awaiting_release',
    releasedToCadetAt: null,
    percentage: null,
    grade: null,
    attendance: null,
    remark: null,
    coScholastic: [],
    subjects: [],
  },
  {
    slug: 'half-yearly',
    name: 'Half-Yearly',
    session: '2026–27',
    window: '14 – 25 Sep 2026',
    status: 'released',
    releasedToCadetAt: '4 Oct 2026',
    percentage: 82.4,
    grade: 'A',
    attendance: { present: 96, total: 102 },
    remark: {
      teacher: 'Ms. Kavya Iyer',
      role: 'Class teacher, 7 B',
      text: 'Aarav has made excellent progress in Mathematics and asks thoughtful questions in class. Social Science answers need more detail — regular revision of chapter summaries will help.',
    },
    coScholastic: [
      { area: 'Art education', grade: 'A' },
      { area: 'Health & physical', grade: 'A+' },
      { area: 'Discipline', grade: 'A' },
    ],
    subjects: halfYearlySubjects,
  },
  {
    slug: 'unit-test-1',
    name: 'Unit Test 1',
    session: '2026–27',
    window: '21 – 25 Jul 2026',
    status: 'released',
    releasedToCadetAt: '2 Aug 2026',
    percentage: 79.1,
    grade: 'B+',
    attendance: { present: 41, total: 44 },
    remark: {
      teacher: 'Ms. Kavya Iyer',
      role: 'Class teacher, 7 B',
      text: 'A confident start to Class 7. Hindi reading has improved. Please encourage 20 minutes of maths practice daily.',
    },
    coScholastic: [],
    subjects: [],
  },
  {
    slug: 'annual',
    name: 'Annual',
    session: '2026–27',
    window: 'Mar 2027',
    status: 'upcoming',
    releasedToCadetAt: null,
    percentage: null,
    grade: null,
    attendance: null,
    remark: null,
    coScholastic: [],
    subjects: [],
  },
];

/**
 * A subject as one class defines it. Every class owns its own subject list, so
 * the same idea can be "Maths" in Class 6 and "Mathematics" in Class 7 with a
 * different id and slug. Growth never matches subjects across classes; only the
 * overall percentage is compared between classes.
 */
export type ClassSubject = { id: string; name: string; short: string };

/** One released exam inside a class, with marks keyed by that class's own subject ids. */
export type ClassExamResult = {
  id: string;
  name: string;
  short: string;
  overall: number;
  /** Only present when the school chooses to show class averages. */
  classAverage: number | null;
  scores: Record<string, number>;
  subjectAverages: Record<string, number> | null;
};

export type ClassRemark = { exam: string; date: string; teacher: string; text: string };

/** Every class the student's profile exists in, newest first. Unreleased exams are never listed. */
export type ClassRecord = {
  id: string;
  className: string;
  section: string;
  session: string;
  current: boolean;
  subjects: ClassSubject[];
  exams: ClassExamResult[];
  remarks: ClassRemark[];
};

export const classHistory: ClassRecord[] = [
  {
    id: 'c7-2026',
    className: 'Class 7',
    section: 'B',
    session: '2026–27',
    current: true,
    subjects: [
      { id: 'c7-eng', name: 'English', short: 'Eng' },
      { id: 'c7-hin', name: 'Hindi', short: 'Hin' },
      { id: 'c7-mat', name: 'Mathematics', short: 'Math' },
      { id: 'c7-sci', name: 'Science', short: 'Sci' },
      { id: 'c7-sst', name: 'Social Science', short: 'SSt' },
      { id: 'c7-cmp', name: 'Computer', short: 'Comp' },
    ],
    exams: [
      {
        id: 'c7-ut1', name: 'Unit Test 1', short: 'UT 1', overall: 79.1, classAverage: 69.4,
        scores: { 'c7-eng': 78, 'c7-hin': 80, 'c7-mat': 81, 'c7-sci': 85, 'c7-sst': 72, 'c7-cmp': 88 },
        subjectAverages: { 'c7-eng': 70, 'c7-hin': 73, 'c7-mat': 64, 'c7-sci': 69, 'c7-sst': 67, 'c7-cmp': 77 },
      },
      {
        id: 'c7-hy', name: 'Half-Yearly', short: 'HY', overall: 82.4, classAverage: 69.9,
        scores: { 'c7-eng': 84, 'c7-hin': 76, 'c7-mat': 92, 'c7-sci': 88, 'c7-sst': 64, 'c7-cmp': 94 },
        subjectAverages: { 'c7-eng': 71, 'c7-hin': 74, 'c7-mat': 66, 'c7-sci': 70, 'c7-sst': 68, 'c7-cmp': 78 },
      },
    ],
    remarks: [
      { exam: 'Half-Yearly', date: 'Oct 2026', teacher: 'Ms. Kavya Iyer', text: 'Excellent progress in Mathematics. Social Science answers need more detail.' },
      { exam: 'Unit Test 1', date: 'Aug 2026', teacher: 'Ms. Kavya Iyer', text: 'A confident start to Class 7. Please encourage daily maths practice.' },
    ],
  },
  {
    id: 'c6-2025',
    className: 'Class 6',
    section: 'A',
    session: '2025–26',
    current: false,
    subjects: [
      { id: 'c6-eng', name: 'English', short: 'Eng' },
      { id: 'c6-hin', name: 'Hindi', short: 'Hin' },
      { id: 'c6-mat', name: 'Maths', short: 'Math' },
      { id: 'c6-sci', name: 'Science', short: 'Sci' },
      { id: 'c6-sst', name: 'Social Studies', short: 'SSt' },
      { id: 'c6-skt', name: 'Sanskrit', short: 'Skt' },
    ],
    exams: [
      {
        id: 'c6-ut1', name: 'Unit Test 1', short: 'UT 1', overall: 70.2, classAverage: 66.1,
        scores: { 'c6-eng': 70, 'c6-hin': 74, 'c6-mat': 64, 'c6-sci': 75, 'c6-sst': 69, 'c6-skt': 69 },
        subjectAverages: { 'c6-eng': 67, 'c6-hin': 70, 'c6-mat': 61, 'c6-sci': 68, 'c6-sst': 66, 'c6-skt': 65 },
      },
      {
        id: 'c6-hy', name: 'Half-Yearly', short: 'HY', overall: 71.5, classAverage: 67.2,
        scores: { 'c6-eng': 72, 'c6-hin': 73, 'c6-mat': 68, 'c6-sci': 77, 'c6-sst': 70, 'c6-skt': 69 },
        subjectAverages: { 'c6-eng': 68, 'c6-hin': 71, 'c6-mat': 62, 'c6-sci': 69, 'c6-sst': 67, 'c6-skt': 66 },
      },
      {
        id: 'c6-an', name: 'Annual', short: 'Annual', overall: 75.8, classAverage: 68.0,
        scores: { 'c6-eng': 75, 'c6-hin': 76, 'c6-mat': 74, 'c6-sci': 80, 'c6-sst': 74, 'c6-skt': 76 },
        subjectAverages: { 'c6-eng': 69, 'c6-hin': 72, 'c6-mat': 63, 'c6-sci': 70, 'c6-sst': 67, 'c6-skt': 67 },
      },
    ],
    remarks: [
      { exam: 'Annual', date: 'Mar 2026', teacher: 'Mr. Arjun Rao', text: 'Promoted to Class 7. Shows leadership during sports week.' },
      { exam: 'Half-Yearly', date: 'Oct 2025', teacher: 'Mr. Arjun Rao', text: 'Steady in all subjects. Maths needs more written practice.' },
    ],
  },
  {
    id: 'c5-2024',
    className: 'Class 5',
    section: 'A',
    session: '2024–25',
    current: false,
    subjects: [
      { id: 'c5-eng', name: 'English', short: 'Eng' },
      { id: 'c5-hin', name: 'Hindi', short: 'Hin' },
      { id: 'c5-mat', name: 'Maths', short: 'Math' },
      { id: 'c5-evs', name: 'EVS', short: 'EVS' },
      { id: 'c5-gk', name: 'General Knowledge', short: 'GK' },
    ],
    exams: [
      {
        id: 'c5-hy', name: 'Half-Yearly', short: 'HY', overall: 68.4, classAverage: null,
        scores: { 'c5-eng': 70, 'c5-hin': 71, 'c5-mat': 61, 'c5-evs': 72, 'c5-gk': 68 },
        subjectAverages: null,
      },
      {
        id: 'c5-an', name: 'Annual', short: 'Annual', overall: 72.0, classAverage: null,
        scores: { 'c5-eng': 73, 'c5-hin': 72, 'c5-mat': 67, 'c5-evs': 76, 'c5-gk': 72 },
        subjectAverages: null,
      },
    ],
    remarks: [{ exam: 'Annual', date: 'Mar 2025', teacher: 'Ms. Ritu Sharma', text: 'Curious and well-behaved. Keep reading every day.' }],
  },
];

export const notices = [
  { id: 'n1', title: 'Parent–teacher meeting', body: 'Saturday 15 Nov, 9:00 am – 12:30 pm. Half-Yearly answer sheets will be shown.', date: 'Today', tag: 'Meeting' },
  { id: 'n2', title: 'Winter uniform from 1 December', body: 'Blazers and full sleeves are mandatory from Monday 1 Dec.', date: '5 Nov', tag: 'Circular' },
  { id: 'n3', title: 'Science exhibition — entries open', body: 'Submit project titles to your class teacher by 20 Nov.', date: '2 Nov', tag: 'Event' },
];

export const calendarEvents = [
  { id: 'e1', day: '14', month: 'Nov', title: "Children's Day celebration", kind: 'Event' as const, detail: 'Half day · Assembly at 8:30 am' },
  { id: 'e2', day: '15', month: 'Nov', title: 'Parent–teacher meeting', kind: 'Meeting' as const, detail: '9:00 am – 12:30 pm' },
  { id: 'e3', day: '24', month: 'Dec', title: 'Winter vacation begins', kind: 'Holiday' as const, detail: 'School reopens Mon 5 Jan 2027' },
  { id: 'e4', day: '10', month: 'Mar', title: 'Annual examinations', kind: 'Exam' as const, detail: '10 – 24 Mar 2027' },
];

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

/** Rupees without paise; the concept never shows fractional amounts. */
export function formatInr(amount: number) {
  return inr.format(amount);
}
