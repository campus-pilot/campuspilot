import type { ClassConfig } from '@campuspilot/db/schema/jsonb/class-config';
import type { Role } from '@campuspilot/db/schema/jsonb/role';
import { z } from 'zod';

import {
  addDays,
  addMonths,
  billingMonths,
  daysBetween,
  enteredShareAt,
  examDays,
  examStateAt,
  formatLocalDate,
  formatLocalDateInWords,
  localDateOf,
  localTimeInstant,
  workingDaysBetween,
  type BillingMonth,
  type ExamState,
  type LocalDate,
} from './dates';
import { demoStaffEmail } from './identity';
import { createRandom } from './prng';
import { DEMO_NOTICE_DATE_TOKEN, demoSeed, type DemoClassSeed } from './seed';

/**
 * The job input the seed runs from, stored on `demo_school_job.input`. School
 * identity (name, slug, location, logo) lives on the school row itself.
 */
export const demoSeedInputSchema = z
  .object({
    sessionStartYear: z.number().int().min(2000).max(2100),
    sessionEndYear: z.number().int().min(2001).max(2101),
    /** Month (1–12) the session and its billing cycle start; April by default (D6). */
    cycleStartMonth: z.number().int().min(1).max(12),
    /** Selected catalogue classes; created in catalogue order. */
    classSlugs: z
      .array(z.string().min(1))
      .min(1)
      .refine((slugs) => new Set(slugs).size === slugs.length, 'Classes must be unique')
      .refine(
        (slugs) => slugs.every((slug) => demoSeed.classes.classes.some((item) => item.slug === slug)),
        'Unknown demo class',
      ),
  })
  .refine(({ sessionStartYear, sessionEndYear }) => sessionEndYear === sessionStartYear + 1, {
    message: 'A demo session ends the year after it starts.',
    path: ['sessionEndYear'],
  });

export type DemoSeedInput = z.infer<typeof demoSeedInputSchema>;

export type Gender = 'female' | 'male';
export type PaymentProfile = DemoSeed['finance']['paymentProfiles'][number]['kind'];
type DemoSeed = typeof demoSeed;
type DiscountReason = DemoSeed['finance']['discounts']['reasons'][number];

export type DemoStaffMember = {
  /** Stable key used for idempotency and PRNG scopes (`manager`, `teacher-1`). */
  key: string;
  role: Role;
  roleLabel: string;
  email: string;
  name: string;
  gender: Gender;
  /** Set for class teachers only. */
  classSlug: string | null;
};

export type DemoStudent = {
  admissionNo: string;
  classSlug: string;
  name: string;
  gender: Gender;
  dob: LocalDate;
  fatherName: string;
  motherName: string;
  address: string;
  phoneNo: string;
  rollNo: number;
  hasPhoto: boolean;
  /** Monthly transport fee in minor units, or null without transport. */
  transportMinor: number | null;
  profile: PaymentProfile;
  /** 0–1; drives marks, attendance and co-scholastic grades coherently. */
  ability: number;
  /** Last billing month index before the student leaves, or null. */
  lastBilledMonthIndex: number | null;
  discount: DiscountReason | null;
};

export type DemoClass = {
  seed: DemoClassSeed;
  config: ClassConfig;
  teacherKey: string;
  students: DemoStudent[];
};

export type DemoExam = {
  slug: string;
  name: string;
  order: number;
  days: LocalDate[];
  window: { start: LocalDate; end: LocalDate };
  /** The billing month in which the exam falls (and its fee is charged when `chargesFee`). */
  feeMonthIndex: number;
  /** Whether that month bills the examination fee; an explicit seed fact per exam. */
  chargesFee: boolean;
  state: ExamState;
  /**
   * When the demo released this exam's results to the Cadet Portal (an ISO
   * instant), or null when it stays unreleased. Every completed exam except
   * the latest one is released, so a demo shows both states; a single
   * completed exam is released. The time is `asOf`, the demo's creation, so
   * a fresh demo shows its results as published the day the school was made.
   */
  cadetReleasedAt: string | null;
  /** Share of students with marks while the exam is `active`. */
  enteredShare: number;
  totalWorkingDays: number;
};

/** One notice the demo writes, with every date already derived from `asOf`. */
export type DemoNotice = {
  key: string;
  /** Unique within the demo; the seed step's natural key. */
  title: string;
  status: 'draft' | 'published';
  bodyMode: 'plain' | 'template';
  body: string;
  toStaff: boolean;
  cadetScope: 'none' | 'all_classes' | 'selected_classes';
  /** Slugs of the demo's classes a `selected_classes` notice names; empty otherwise. */
  classSlugs: string[];
  /** When it was written (ISO instant, before `asOf`). */
  createdAt: string;
  /** When the demo published it (ISO instant, before `asOf`), or null for a draft. */
  publishedAt: string | null;
  /** The date printed on it: the local calendar date of `publishedAt` (`YYYY-MM-DD`), or null for a draft. */
  issuedOn: LocalDate | null;
};

export type DemoPlan = {
  schoolSlug: string;
  schoolName: string;
  startYear: number;
  endYear: number;
  cycleStartMonth: number;
  sessionStart: LocalDate;
  sessionEnd: LocalDate;
  asOfLocal: LocalDate;
  timeZone: string;
  staff: DemoStaffMember[];
  classes: DemoClass[];
  exams: DemoExam[];
  billingMonths: BillingMonth[];
  notices: DemoNotice[];
};

function personName(random: ReturnType<typeof createRandom>, gender: Gender, pool: 'child' | 'adult', surname?: string) {
  const names = pool === 'child' ? demoSeed.people.childFirstNames : demoSeed.people.adultFirstNames;
  return `${random.pick(names[gender])} ${surname ?? random.pick(demoSeed.people.surnames)}`;
}

function buildStaff(seed: string, schoolSlug: string, classes: DemoClassSeed[]): DemoStaffMember[] {
  const single = demoSeed.staff.singleHolders.map((holder) => {
    const random = createRandom(seed, 'staff', holder.emailRole);
    const gender: Gender = random.chance(0.5) ? 'female' : 'male';
    return {
      key: holder.emailRole,
      role: holder.role,
      roleLabel: holder.label,
      email: demoStaffEmail(holder.emailRole, schoolSlug),
      name: `${demoSeed.people.staffTitles[gender]} ${personName(random, gender, 'adult')}`,
      gender,
      classSlug: null,
    };
  });
  const teacher = demoSeed.staff.teacher;
  const teachers = classes.map((item, index) => {
    const random = createRandom(seed, 'staff', 'teacher', index + 1);
    const gender: Gender = random.chance(0.7) ? 'female' : 'male';
    return {
      key: `teacher-${index + 1}`,
      role: teacher.role,
      roleLabel: `${teacher.label}, ${item.label}`,
      email: demoStaffEmail(teacher.emailRole, schoolSlug, index + 1),
      name: `${demoSeed.people.staffTitles[gender]} ${personName(random, gender, 'adult')}`,
      gender,
      classSlug: item.slug,
    };
  });
  return [...single, ...teachers];
}

function classConfig(item: DemoClassSeed): ClassConfig {
  const subjects = demoSeed.classes.subjectSets[item.subjectSet]!;
  return {
    subjects: Object.fromEntries(
      Object.entries(subjects).map(([slug, subject]) => [
        slug,
        {
          name: subject.name,
          books: [{ title: `${item.label} ${subject.book}`, publication: demoSeed.classes.bookPublication }],
          examModes: demoSeed.classes.examModeSets[subject.modes]!,
        },
      ]),
    ),
  };
}

function pickProfile(random: ReturnType<typeof createRandom>): PaymentProfile {
  return random.weighted(demoSeed.finance.paymentProfiles, (profile) => profile.share).kind;
}

/**
 * Builds every student of every selected class. Students are generated per
 * class from their own PRNG scope, sorted alphabetically for roll numbers,
 * and numbered `{startYear}{seq:03}` across the school in catalogue order.
 */
function buildClasses(seed: string, input: DemoSeedInput, months: BillingMonth[]): DemoClass[] {
  const selected = demoSeed.classes.classes.filter((item) => input.classSlugs.includes(item.slug));
  let sequence = 0;
  const people = demoSeed.people;
  return selected.map((item, classIndex) => {
    const random = createRandom(seed, 'class', item.slug);
    const count = random.int(8, 14);
    const used = new Set<string>();
    const drafts = Array.from({ length: count }, (_, index) => {
      const studentRandom = createRandom(seed, 'student', item.slug, index);
      const gender: Gender = studentRandom.chance(0.5) ? 'female' : 'male';
      const surname = studentRandom.pick(people.surnames);
      let name = personName(studentRandom, gender, 'child', surname);
      while (used.has(name)) name = personName(studentRandom, gender, 'child', surname);
      used.add(name);
      const birthYear = input.sessionStartYear - item.ageAtSessionStart;
      const dob = addDays(formatLocalDate(birthYear - 1, input.cycleStartMonth, 1), studentRandom.int(0, 364));
      const lastBillable = months.length - 1;
      const leaves = months.length >= 3 && studentRandom.chance(demoSeed.finance.unregisterShare);
      const transport = studentRandom.chance(demoSeed.finance.transport.share);
      const discounted = studentRandom.chance(demoSeed.finance.discounts.share);
      return {
        classSlug: item.slug,
        name,
        gender,
        dob,
        fatherName: personName(studentRandom, 'male', 'adult', surname),
        motherName: personName(studentRandom, 'female', 'adult', surname),
        address: `${studentRandom.int(1, 220)}, ${studentRandom.pick(people.streets)}, ${studentRandom.pick(people.localities)}, ${people.sampleCity} ${people.postalCodePrefix}${String(studentRandom.int(0, 999)).padStart(3, '0')}`,
        phoneNo: `${people.phonePrefix}${String(studentRandom.int(0, 99_999)).padStart(10 - people.phonePrefix.length, '0')}`,
        hasPhoto: studentRandom.chance(0.7),
        transportMinor: transport ? studentRandom.pick(demoSeed.finance.transport.amountsMinor) : null,
        profile: pickProfile(studentRandom),
        ability: 0.45 + studentRandom.next() * 0.5,
        lastBilledMonthIndex: leaves ? studentRandom.int(1, Math.max(1, lastBillable - 1)) : null,
        discount: discounted ? studentRandom.pick(demoSeed.finance.discounts.reasons) : null,
      };
    });
    const students = drafts
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((draft, index) => {
        sequence += 1;
        return {
          ...draft,
          rollNo: index + 1,
          admissionNo: `${input.sessionStartYear}${String(sequence).padStart(3, '0')}`,
        };
      });
    return { seed: item, config: classConfig(item), teacherKey: `teacher-${classIndex + 1}`, students };
  });
}

function buildExams(input: DemoSeedInput, sessionStart: LocalDate, asOf: Date): DemoExam[] {
  const asOfLocal = localDateOf(asOf, demoSeed.finance.timeZone);
  const exams = scheduleExams(input, sessionStart, asOfLocal);
  const completed = exams.filter((exam) => exam.state === 'completed');
  const held = completed.length > 1 ? completed.at(-1) : undefined;
  const releasedAt = asOf.toISOString();
  return exams.map((exam) => ({
    ...exam,
    cadetReleasedAt: exam.state === 'completed' && exam !== held ? releasedAt : null,
  }));
}

function scheduleExams(input: DemoSeedInput, sessionStart: LocalDate, asOfLocal: LocalDate): Array<Omit<DemoExam, 'cadetReleasedAt'>> {
  const session = demoSeed.session;
  let previousEnd: LocalDate | null = null;
  return [...session.exams]
    .sort((left, right) => left.order - right.order)
    .map((exam) => {
      const { year, month } = addMonths(input.sessionStartYear, input.cycleStartMonth, exam.monthOffset);
      const days = examDays(formatLocalDate(year, month, exam.startDay), exam.slots);
      const window = { start: days[0]!, end: days[days.length - 1]! };
      const countFrom: LocalDate = previousEnd ? addDays(previousEnd, 1) : sessionStart;
      previousEnd = window.end;
      const state = examStateAt(window, asOfLocal, session.activeWithinDaysAfterWindow);
      return {
        slug: exam.slug,
        name: exam.name,
        order: exam.order,
        days,
        window,
        feeMonthIndex: exam.monthOffset,
        chargesFee: exam.chargesFee,
        state,
        enteredShare: state === 'active' ? enteredShareAt(window, asOfLocal, session.activeWithinDaysAfterWindow) : state === 'completed' ? 1 : 0,
        totalWorkingDays: Math.max(1, workingDaysBetween(countFrom, addDays(window.start, -1))),
      };
    });
}

/** Replaces `{date:±N}` with the written date N days from the demo's `asOf` day. */
export function fillDemoNoticeDates(text: string, asOfLocal: LocalDate): string {
  return text.replace(DEMO_NOTICE_DATE_TOKEN, (_token, days: string) => formatLocalDateInWords(addDays(asOfLocal, Number(days))));
}

/**
 * The demo's notices, dated from `asOf`: written `createdDaysAgo` and
 * published `publishedDaysAgo` days before the `asOf` day at the seed's
 * local hours, so both are always in the past and a notice is never
 * published before it was written. `selected` are the demo's classes in
 * catalogue (junior to senior) order.
 */
function buildNotices(selected: DemoClassSeed[], asOfLocal: LocalDate, timeZone: string): DemoNotice[] {
  const { localHours, notices } = demoSeed.notices;
  const at = (daysAgo: number, hour: number) => localTimeInstant(addDays(asOfLocal, -daysAgo), hour, 0, timeZone);
  return notices.map((notice) => {
    const picked = notice.classPick
      ? notice.classPick.from === 'seniormost'
        ? selected.slice(-notice.classPick.count)
        : selected.slice(0, notice.classPick.count)
      : [];
    return {
      key: notice.key,
      title: fillDemoNoticeDates(notice.title, asOfLocal),
      status: notice.status,
      bodyMode: notice.bodyMode,
      body: fillDemoNoticeDates(notice.body.join(notice.bodyMode === 'plain' ? '\n\n' : '\n'), asOfLocal),
      toStaff: notice.toStaff,
      cadetScope: notice.cadetScope,
      classSlugs: picked.map((item) => item.slug),
      createdAt: at(notice.createdDaysAgo, localHours.created),
      publishedAt: notice.publishedDaysAgo === null ? null : at(notice.publishedDaysAgo, localHours.published),
      issuedOn: notice.publishedDaysAgo === null ? null : addDays(asOfLocal, -notice.publishedDaysAgo),
    };
  });
}

/**
 * The complete, deterministic demo plan for `(input, seed, asOf)`. It is pure,
 * so every workflow step can rebuild it instead of journaling it; only IDs and
 * counts travel through the Restate journal.
 */
export function buildDemoPlan(options: {
  input: DemoSeedInput;
  seed: string;
  asOf: Date;
  school: { slug: string; name: string };
}): DemoPlan {
  const { input, seed, school } = options;
  const timeZone = demoSeed.finance.timeZone;
  const asOfLocal = localDateOf(options.asOf, timeZone);
  const sessionStart = formatLocalDate(input.sessionStartYear, input.cycleStartMonth, 1);
  const end = addMonths(input.sessionStartYear, input.cycleStartMonth, 12);
  const sessionEnd = addDays(formatLocalDate(end.year, end.month, 1), -1);
  const months = billingMonths({ startYear: input.sessionStartYear, cycleStartMonth: input.cycleStartMonth, asOfLocal });
  const selected = demoSeed.classes.classes.filter((item) => input.classSlugs.includes(item.slug));
  return {
    schoolSlug: school.slug,
    schoolName: school.name,
    startYear: input.sessionStartYear,
    endYear: input.sessionEndYear,
    cycleStartMonth: input.cycleStartMonth,
    sessionStart,
    sessionEnd,
    asOfLocal,
    timeZone,
    staff: buildStaff(seed, school.slug, selected),
    classes: buildClasses(seed, input, months),
    exams: buildExams(input, sessionStart, options.asOf),
    billingMonths: months,
    notices: buildNotices(selected, asOfLocal, timeZone),
  };
}

export type PaymentEvent = {
  admissionNo: string;
  /** The billing-month step that records it: the last month billed on or before its date. */
  monthIndex: number;
  /** 0-based sequence within the admission; part of the idempotency key. */
  sequence: number;
  date: LocalDate;
  amountMinor: number;
  method: DemoSeed['finance']['paymentMethods'][number]['method'];
  /** A counter discount recorded with this payment (`recordPaymentWithDiscount`). */
  withDiscount: boolean;
};

/** The months a student is billed in: up to `asOf`, and not after leaving. */
export function billedMonthIndexes(plan: DemoPlan, student: DemoStudent): number[] {
  const last = student.lastBilledMonthIndex ?? plan.billingMonths.length - 1;
  return plan.billingMonths.filter((month) => month.index <= last).map((month) => month.index);
}

/** The expected bill total for one student and month, from the seed's pricing. */
export function expectedBillMinor(plan: DemoPlan, student: DemoStudent, monthIndex: number): number {
  const classSeed = plan.classes.find((item) => item.seed.slug === student.classSlug)!.seed;
  const examFee = plan.exams.some((exam) => exam.chargesFee && exam.feeMonthIndex === monthIndex) ? demoSeed.finance.examinationFeeMinor : 0;
  return classSeed.tuitionMinor + classSeed.smartClassMinor + (student.transportMinor ?? 0) + examFee;
}

function roundToRupee(minor: number) {
  return Math.max(100, Math.round(minor / 100) * 100);
}

/**
 * Every payment a student makes according to their seeded profile (§6.7).
 * Nothing is dated on or after `asOf`'s local day, so the current month looks
 * under-collected as it would in reality.
 */
export function paymentEvents(plan: DemoPlan, seed: string, student: DemoStudent): PaymentEvent[] {
  const random = createRandom(seed, 'payments', student.admissionNo);
  const months = billedMonthIndexes(plan, student);
  const billingDate = (index: number) => plan.billingMonths[index]?.billingDate ?? (() => {
    const { year, month } = addMonths(plan.startYear, plan.cycleStartMonth, index);
    return formatLocalDate(year, month, 1);
  })();
  const drafts: Array<Omit<PaymentEvent, 'monthIndex' | 'sequence' | 'method' | 'withDiscount'>> = [];
  const add = (date: LocalDate, amountMinor: number) => drafts.push({ admissionNo: student.admissionNo, date, amountMinor });

  switch (student.profile) {
    case 'punctual':
      for (const index of months) add(addDays(billingDate(index), random.int(2, 12)), expectedBillMinor(plan, student, index));
      break;
    case 'late':
      for (let position = 0; position < months.length; position += 1) {
        const index = months[position]!;
        const next = months[position + 1];
        if (next !== undefined && random.chance(0.3)) {
          add(addDays(billingDate(next), random.int(15, 25)), expectedBillMinor(plan, student, index) + expectedBillMinor(plan, student, next));
          position += 1;
        } else {
          add(addDays(billingDate(index), random.int(15, 40)), expectedBillMinor(plan, student, index));
        }
      }
      break;
    case 'partial':
      for (const index of months) {
        add(addDays(billingDate(index), random.int(5, 20)), roundToRupee(expectedBillMinor(plan, student, index) * (0.4 + random.next() * 0.4)));
      }
      break;
    case 'defaulter':
      if (months.length > 0 && random.chance(0.5)) add(addDays(billingDate(months[0]!), random.int(10, 30)), expectedBillMinor(plan, student, months[0]!));
      break;
    case 'advance': {
      const last = student.lastBilledMonthIndex ?? 11;
      for (let quarter = 0; quarter < months.length; quarter += 3) {
        const covered = [quarter, quarter + 1, quarter + 2].filter((index) => index <= last);
        add(addDays(billingDate(quarter), random.int(1, 5)), covered.reduce((sum, index) => sum + expectedBillMinor(plan, student, index), 0));
      }
      break;
    }
  }

  return drafts
    .filter((draft) => daysBetween(draft.date, plan.asOfLocal) > 0)
    .sort((left, right) => daysBetween(right.date, left.date))
    .map((draft, sequence) => {
      const monthIndex = [...plan.billingMonths].reverse().find((month) => daysBetween(month.billingDate, draft.date) >= 0)?.index ?? 0;
      return {
        ...draft,
        monthIndex,
        sequence,
        method: random.weighted(demoSeed.finance.paymentMethods, (item) => item.weight).method,
        withDiscount: student.profile === 'punctual' && random.chance(demoSeed.finance.discounts.paymentDiscountShare / demoSeed.finance.paymentProfiles.find((item) => item.kind === 'punctual')!.share),
      };
    });
}
