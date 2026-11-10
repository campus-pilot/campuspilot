import { toE164PhoneNumber } from '@campuspilot/db/phone';
import { describe, expect, it } from 'vitest';

import { billingMonths, daysBetween, examStateAt } from './dates';
import { demoStaffEmail, generateRegistrationNumber, slugifySchoolName, uniqueSlug } from './identity';
import { encodePng, renderAvatar } from './images';
import { assertValidNoticeTemplate } from '../../routers/school/notice/notice.render';
import { buildDemoPlan, demoSeedInputSchema, fillDemoNoticeDates, paymentEvents } from './plan';
import { createRandom } from './prng';
import { demoClassCatalogue, demoSeed } from './seed';

const input = { sessionStartYear: 2026, sessionEndYear: 2027, cycleStartMonth: 4, classSlugs: ['nursery', 'class-1', 'class-5'] };
const school = { slug: 'green-valley', name: 'Green Valley School' };

describe('demo seed data and plan', () => {
  it('loads and validates every seed file', () => {
    expect(demoSeed.classes.classes).toHaveLength(13);
    expect(demoClassCatalogue().map((item) => item.label)).toEqual([
      'Nursery', 'LKG', 'UKG', 'Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10',
    ]);
    expect(demoSeedInputSchema.safeParse({ ...input, classSlugs: ['class-11'] }).success).toBe(false);
    expect(demoSeedInputSchema.safeParse({ ...input, sessionEndYear: 2028 }).success).toBe(false);
  });

  it('derives the same values from the same seed and scope', () => {
    const first = createRandom('seed', 'student', 'class-1', 3);
    const second = createRandom('seed', 'student', 'class-1', 3);
    expect(Array.from({ length: 5 }, () => first.next())).toEqual(Array.from({ length: 5 }, () => second.next()));
    expect(createRandom('seed', 'a').next()).not.toBe(createRandom('seed', 'b').next());
    const asOf = new Date('2026-11-06T06:00:00Z');
    expect(buildDemoPlan({ input, seed: 's', asOf, school })).toEqual(buildDemoPlan({ input, seed: 's', asOf, school }));
  });

  it('generates 12-digit registration numbers that never start with 0', () => {
    for (let index = 0; index < 200; index += 1) expect(generateRegistrationNumber()).toMatch(/^[1-9]\d{11}$/);
    // Even a generator that always draws the minimum yields a non-zero first digit.
    expect(generateRegistrationNumber((min) => min)).toBe('100000000000');
  });

  it('bills from the cycle start to the month of asOf, clipped to the session', () => {
    const keys = (asOfLocal: string) => billingMonths({ startYear: 2026, cycleStartMonth: 4, asOfLocal }).map((month) => month.periodKey);
    expect(keys('2026-06-15')).toEqual(['monthly:2026-04', 'monthly:2026-05', 'monthly:2026-06']);
    expect(keys('2026-03-31')).toEqual([]);
    expect(keys('2028-01-01')).toHaveLength(12);
    expect(keys('2028-01-01').at(-1)).toBe('monthly:2027-03');
  });

  it('derives exam state from asOf', () => {
    const window = { start: '2026-08-12', end: '2026-08-16' };
    expect(examStateAt(window, '2026-08-01', 30)).toBe('ready');
    expect(examStateAt(window, '2026-08-13', 30)).toBe('active');
    expect(examStateAt(window, '2026-09-10', 30)).toBe('active');
    expect(examStateAt(window, '2026-09-20', 30)).toBe('completed');
    const plan = buildDemoPlan({ input, seed: 's', asOf: new Date('2026-11-06T06:00:00Z'), school });
    expect(plan.exams.map((exam) => exam.state)).toEqual(['completed', 'completed', 'ready', 'ready']);
  });

  it('releases every completed exam to the Cadet Portal except the latest one', () => {
    const at = (asOf: string) => buildDemoPlan({ input, seed: 's', asOf: new Date(asOf), school }).exams.map((exam) => [exam.slug, exam.cadetReleasedAt !== null]);
    expect(at('2026-11-06T06:00:00Z')).toEqual([
      ['periodic-test-1', true],
      ['first-term-examination', false],
      ['second-term-examination', false],
      ['annual-examination', false],
    ]);
    // A single completed exam is released, so a young demo still shows results.
    expect(at('2026-08-01T06:00:00Z').filter(([, released]) => released)).toEqual([['periodic-test-1', true]]);
    expect(at('2026-05-01T06:00:00Z').every(([, released]) => !released)).toBe(true);
  });

  it('releases on the day the demo is created (asOf)', () => {
    const asOf = new Date('2026-11-06T06:00:00Z');
    const [periodic] = buildDemoPlan({ input, seed: 's', asOf, school }).exams;
    expect(periodic!.cadetReleasedAt).toBe(asOf.toISOString());
  });

  it('charges the examination fee only for exams that charge one', () => {
    const plan = buildDemoPlan({ input, seed: 's', asOf: new Date('2026-11-06T06:00:00Z'), school });
    expect(plan.exams.map((exam) => [exam.slug, exam.chargesFee])).toEqual([
      ['periodic-test-1', false],
      ['first-term-examination', true],
      ['second-term-examination', true],
      ['annual-examination', true],
    ]);
  });

  it('dates no payment on or after the asOf day', () => {
    const asOf = new Date('2026-11-06T06:00:00Z');
    const plan = buildDemoPlan({ input, seed: 'payments', asOf, school });
    const events = plan.classes.flatMap((item) => item.students).flatMap((student) => paymentEvents(plan, 'payments', student));
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => daysBetween(event.date, plan.asOfLocal) > 0)).toBe(true);
    expect(events.every((event) => event.amountMinor > 0)).toBe(true);
  });

  it('builds staff emails with role slugs and teachers numbered in class order', () => {
    const plan = buildDemoPlan({ input, seed: 's', asOf: new Date('2026-11-06T06:00:00Z'), school });
    expect(plan.staff.map((member) => member.email)).toEqual([
      'manager.green-valley@campuspilot.in',
      'accountant.green-valley@campuspilot.in',
      'exam-coordinator.green-valley@campuspilot.in',
      'teacher1.green-valley@campuspilot.in',
      'teacher2.green-valley@campuspilot.in',
      'teacher3.green-valley@campuspilot.in',
    ]);
    expect(plan.staff.filter((member) => member.role === 'teacher').map((member) => member.classSlug)).toEqual(['nursery', 'class-1', 'class-5']);
    expect(demoStaffEmail('teacher', 'x', 12)).toBe('teacher12.x@campuspilot.in');
  });

  it('plans 8–14 students per class with sorted roll numbers and school-wide admission numbers', () => {
    const plan = buildDemoPlan({ input, seed: 's', asOf: new Date('2026-11-06T06:00:00Z'), school });
    const students = plan.classes.flatMap((item) => item.students);
    for (const item of plan.classes) {
      expect(item.students.length).toBeGreaterThanOrEqual(8);
      expect(item.students.length).toBeLessThanOrEqual(14);
      expect(item.students.map((student) => student.name)).toEqual([...item.students.map((student) => student.name)].sort((a, b) => a.localeCompare(b)));
    }
    expect(students.map((student) => student.admissionNo)).toEqual(students.map((_, index) => `2026${String(index + 1).padStart(3, '0')}`));
  });

  it('plans phone numbers that pass phone validation as Indian numbers outside the mobile ranges', () => {
    for (const seed of ['s', 'other-seed', 'third']) {
      const plan = buildDemoPlan({ input, seed, asOf: new Date('2026-11-06T06:00:00Z'), school });
      for (const student of plan.classes.flatMap((item) => item.students)) {
        expect(toE164PhoneNumber(student.phoneNo)).toBe(`+91${student.phoneNo}`);
        expect(student.phoneNo).toMatch(/^5/);
      }
    }
  });

  it('makes slugs unique with numeric suffixes', async () => {
    expect(slugifySchoolName('  Green Valley School!  ')).toBe('green-valley-school');
    const taken = new Set(['green-valley', 'green-valley-2']);
    expect(await uniqueSlug('green-valley', async (slug) => taken.has(slug))).toBe('green-valley-3');
  });

  it('renders valid PNG avatars', () => {
    const png = renderAvatar(createRandom('s', 'avatar'), { style: 'child', gender: 'female' });
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(encodePng(1, 1, new Uint8Array([0, 0, 0, 255])).byteLength).toBeGreaterThan(40);
  });
});

describe('demo passwords', () => {
  it('are 4×4 base32 groups with at least 64 bits of entropy', async () => {
    const { DEMO_PASSWORD_ALPHABET, DEMO_PASSWORD_ENTROPY_BITS, generateDemoPassword } = await import('./identity');
    expect(DEMO_PASSWORD_ALPHABET).toHaveLength(32);
    expect(new Set(DEMO_PASSWORD_ALPHABET).size).toBe(32);
    expect(DEMO_PASSWORD_ENTROPY_BITS).toBeGreaterThanOrEqual(64);
    const pattern = new RegExp(`^[${DEMO_PASSWORD_ALPHABET}]{4}(?:-[${DEMO_PASSWORD_ALPHABET}]{4}){3}$`);
    const samples = Array.from({ length: 500 }, () => generateDemoPassword());
    for (const password of samples) expect(password).toMatch(pattern);
    expect(new Set(samples).size).toBe(samples.length);
    // Every symbol of the alphabet is reachable.
    expect(new Set(samples.join('').replaceAll('-', '')).size).toBe(32);
  });

  it('plans a realistic handful of notices, every date derived from asOf', () => {
    const asOf = new Date('2026-11-06T06:00:00Z');
    const { notices } = buildDemoPlan({ input, seed: 's', asOf, school });
    const audience = (key: string) => {
      const notice = notices.find((item) => item.key === key)!;
      return [notice.status, notice.bodyMode, notice.toStaff, notice.cadetScope, notice.classSlugs] as const;
    };
    // One of each kind a school user should see: staff only, all classes, staff + selected classes, a designed notice, drafts.
    expect(audience('staff-meeting')).toEqual(['published', 'plain', true, 'none', []]);
    expect(audience('school-timings')).toEqual(['published', 'plain', false, 'all_classes', []]);
    // "Seniormost two" of the classes this demo has, whatever they are.
    expect(audience('science-exhibition')).toEqual(['published', 'plain', true, 'selected_classes', ['class-1', 'class-5']]);
    expect(audience('sports-day')).toEqual(['published', 'template', true, 'all_classes', []]);
    expect(notices.filter((notice) => notice.status === 'draft').map((notice) => notice.key)).toEqual(['holiday-homework', 'parent-teacher-meeting']);
    expect(new Set(notices.map((notice) => notice.title)).size).toBe(notices.length);

    for (const notice of notices) {
      // Written and published in the past, in that order; drafts are unpublished.
      expect(new Date(notice.createdAt).getTime(), notice.key).toBeLessThan(asOf.getTime());
      expect(notice.publishedAt === null, notice.key).toBe(notice.status === 'draft');
      if (notice.publishedAt) {
        expect(new Date(notice.publishedAt).getTime(), notice.key).toBeLessThan(asOf.getTime());
        expect(new Date(notice.publishedAt).getTime(), notice.key).toBeGreaterThan(new Date(notice.createdAt).getTime());
      }
      // Every date token was replaced, and what remains is what the API accepts.
      expect(`${notice.title}\n${notice.body}`, notice.key).not.toMatch(/\{date:/);
      expect(notice.body.length, notice.key).toBeLessThanOrEqual(200_000);
      if (notice.bodyMode === 'template') expect(() => assertValidNoticeTemplate(notice.body), notice.key).not.toThrow();
    }
    // 16 days before 6 November 2026 at 11:00 in the demo's time zone (Asia/Kolkata).
    expect(notices.find((notice) => notice.key === 'staff-meeting')!.publishedAt).toBe('2026-10-21T05:30:00.000Z');
    expect(notices.find((notice) => notice.key === 'staff-meeting')!.body).toContain('on 23 October 2026 at 2:30 PM');
    expect(fillDemoNoticeDates('From {date:-6} until {date:+10}.', '2026-11-06')).toBe('From 31 October 2026 until 16 November 2026.');

    // A one-class demo still gets a valid selected-classes notice.
    const single = buildDemoPlan({ input: { ...input, classSlugs: ['class-5'] }, seed: 's', asOf, school });
    expect(single.notices.find((notice) => notice.key === 'science-exhibition')!.classSlugs).toEqual(['class-5']);
  });
});
