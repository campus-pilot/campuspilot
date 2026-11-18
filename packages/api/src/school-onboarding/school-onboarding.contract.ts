import { RESERVED_EXAM_SLUGS, examNameKey, examNameSchema } from '@campuspilot/db/schema/jsonb/session-config';
import { z } from 'zod';

/**
 * The guided setup a self-created school is offered (docs/school-creation.md,
 * "Guided setup"): what it proposes and the rules of what it accepts. Shared
 * by `school.completeOnboarding` and the Get started screens, so both apply
 * one rule. This is its own catalogue, not the demo school's seed: the two
 * describe different things (a realistic sample school, a starting point) and
 * change independently.
 */

/** The stages classes are grouped in; each has its own starter subjects. */
export const ONBOARDING_STAGES = [
  {
    key: 'prePrimary',
    label: 'Pre-primary',
    subjects: ['English', 'Hindi', 'Number Work', 'General Awareness', 'Drawing'],
  },
  {
    key: 'primary',
    label: 'Primary',
    subjects: ['English', 'Hindi', 'Mathematics', 'EVS', 'Computer'],
  },
  {
    key: 'middle',
    label: 'Middle',
    subjects: ['English', 'Hindi', 'Sanskrit', 'Mathematics', 'Science', 'Social Science', 'Computer'],
  },
  {
    key: 'secondary',
    label: 'Secondary',
    subjects: ['English', 'Hindi', 'Mathematics', 'Science', 'Social Science', 'Computer Applications'],
  },
  {
    key: 'seniorSecondary',
    label: 'Senior secondary',
    subjects: ['English', 'Physics', 'Chemistry', 'Mathematics', 'Biology'],
  },
] as const;

export type OnboardingStageKey = (typeof ONBOARDING_STAGES)[number]['key'];
export const ONBOARDING_STAGE_KEYS = ONBOARDING_STAGES.map((stage) => stage.key) as [
  OnboardingStageKey,
  ...OnboardingStageKey[],
];

/**
 * The classes the guide offers, in school order. `preselected` is whether a
 * class starts ticked: Nursery to Class 10 do, Class 11 and 12 are offered
 * with one tap. Slugs follow the class rule (`createClassInputSchema`).
 */
export const ONBOARDING_CLASSES = [
  { slug: 'nursery', label: 'Nursery', stage: 'prePrimary', preselected: true },
  { slug: 'lkg', label: 'LKG', stage: 'prePrimary', preselected: true },
  { slug: 'ukg', label: 'UKG', stage: 'prePrimary', preselected: true },
  ...([1, 2, 3, 4, 5] as const).map((n) => ({ slug: `class-${n}`, label: `Class ${n}`, stage: 'primary' as const, preselected: true })),
  ...([6, 7, 8] as const).map((n) => ({ slug: `class-${n}`, label: `Class ${n}`, stage: 'middle' as const, preselected: true })),
  ...([9, 10] as const).map((n) => ({ slug: `class-${n}`, label: `Class ${n}`, stage: 'secondary' as const, preselected: true })),
  ...([11, 12] as const).map((n) => ({ slug: `class-${n}`, label: `Class ${n}`, stage: 'seniorSecondary' as const, preselected: false })),
] satisfies readonly { slug: string; label: string; stage: OnboardingStageKey; preselected: boolean }[];

export type OnboardingClass = (typeof ONBOARDING_CLASSES)[number];
export const ONBOARDING_CLASS_SLUGS = ONBOARDING_CLASSES.map((entry) => entry.slug) as [string, ...string[]];

/** The examinations the guide proposes, in order. The count can change and every name can be edited. */
export const DEFAULT_ONBOARDING_EXAM_NAMES = ['First Term', 'Second Term', 'Third Term', 'Last Term'] as const;

/** Bounds of what the guide accepts. */
export const ONBOARDING_MAX_EXAMS = 8;
export const ONBOARDING_MAX_SUBJECTS_PER_STAGE = 20;
export const ONBOARDING_SUBJECT_NAME_MAX_LENGTH = 100;

/**
 * The one assessment mode every subject the guide creates gets: a written
 * paper worth all of the subject's marks, so each subject has exactly one
 * question paper per examination. Splits (Oral 20%, Practical 30%) are added
 * later in the class's subject settings.
 */
export const ONBOARDING_SUBJECT_EXAM_MODES = { written: { name: 'Written', percentage: 100 } } as const;

/**
 * The start year of the academic session running on `date`, for an April to
 * March session in India: from April it is the calendar year, from January
 * to March the year before. The month is read in India's time zone, so the
 * answer does not depend on the server's or the browser's.
 */
export function academicSessionStartYear(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'numeric' }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  return month >= 4 ? year : year - 1;
}

/** The stage keys of the chosen classes, in catalogue order. */
export function stagesOfClasses(classSlugs: readonly string[]): OnboardingStageKey[] {
  const chosen = new Set(classSlugs);
  const stages = new Set(ONBOARDING_CLASSES.filter((entry) => chosen.has(entry.slug)).map((entry) => entry.stage));
  return ONBOARDING_STAGE_KEYS.filter((key) => stages.has(key));
}

/**
 * Slugs for names, one per name and all different: the name reduced to
 * lowercase letters and digits joined by `separator`, or `fallback` and its
 * position when nothing is left (a name written only in Devanagari, for
 * example), with `_2`, `_3`… (or `-2`…) added to a slug already taken or
 * in `reserved`.
 */
function slugsFor(names: readonly string[], separator: '_' | '-', fallback: string, reserved: readonly string[] = []): string[] {
  const taken = new Set<string>(reserved);
  return names.map((name, index) => {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, separator)
        .replace(new RegExp(`^\\${separator}+|\\${separator}+$`, 'g'), '')
        .slice(0, 80) || `${fallback}${separator}${index + 1}`;
    let slug = base;
    for (let suffix = 2; taken.has(slug); suffix += 1) slug = `${base}${separator}${suffix}`;
    taken.add(slug);
    return slug;
  });
}

/**
 * Exam slugs for the guide's exam names, following the exam slug rule
 * (`examSlugSchema`): underscores, and never a reserved slug (an examination
 * named "Constructor" gets `constructor_2`), since `createSession` stores
 * configuration keys without that rule.
 */
export function onboardingExamSlugs(names: readonly string[]): string[] {
  return slugsFor(names, '_', 'exam', RESERVED_EXAM_SLUGS);
}

/** Subject slugs for a stage's subject names, in the kebab case the class subject editor uses. */
export function onboardingSubjectSlugs(names: readonly string[]): string[] {
  return slugsFor(names, '-', 'subject');
}

/** How two subject names are compared for duplicates: case, spacing and Unicode forms ignored, like exam names. */
export const subjectNameKey = examNameKey;

export const onboardingSubjectNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter the subject name.')
  .max(ONBOARDING_SUBJECT_NAME_MAX_LENGTH, `Keep subject names to ${ONBOARDING_SUBJECT_NAME_MAX_LENGTH} characters.`);

export const onboardingSessionStartYearSchema = z.number().int().min(2000).max(2099);

/** The duplicate in `names` by `key`, or undefined: the index of the second occurrence. */
function duplicateIndex(names: readonly string[], key: (name: string) => string): number | undefined {
  const seen = new Set<string>();
  for (const [index, name] of names.entries()) {
    const value = key(name);
    if (seen.has(value)) return index;
    seen.add(value);
  }
  return undefined;
}

/**
 * Everything the guide saves, as the screens send it. The server derives the
 * session's end year (the start year plus one), every slug, the single
 * Written mode and section A; the person never types them.
 *
 * - Examinations: one to {@link ONBOARDING_MAX_EXAMS}, names by the exam name
 *   rule and different from each other (`examNameKey`).
 * - Classes: at least one, from {@link ONBOARDING_CLASSES}, each once.
 * - Subjects: every stage of a chosen class has one to
 *   {@link ONBOARDING_MAX_SUBJECTS_PER_STAGE} subjects with different names;
 *   stages without a chosen class are ignored.
 */
export const completeSchoolOnboardingInputSchema = z
  .object({
    schoolId: z.string().min(1),
    sessionStartYear: onboardingSessionStartYearSchema,
    examNames: z.array(examNameSchema).min(1, 'Add at least one examination.').max(ONBOARDING_MAX_EXAMS),
    classSlugs: z.array(z.enum(ONBOARDING_CLASS_SLUGS)).min(1, 'Choose at least one class.'),
    subjects: z.partialRecord(z.enum(ONBOARDING_STAGE_KEYS), z.array(onboardingSubjectNameSchema).max(ONBOARDING_MAX_SUBJECTS_PER_STAGE)),
  })
  .superRefine((input, context) => {
    const examClash = duplicateIndex(input.examNames, examNameKey);
    if (examClash !== undefined)
      context.addIssue({ code: 'custom', path: ['examNames', examClash], message: 'Two examinations have this name.' });
    if (new Set(input.classSlugs).size !== input.classSlugs.length)
      context.addIssue({ code: 'custom', path: ['classSlugs'], message: 'Each class can be chosen once.' });
    for (const stage of stagesOfClasses(input.classSlugs)) {
      const names = input.subjects[stage] ?? [];
      if (names.length === 0) {
        context.addIssue({ code: 'custom', path: ['subjects', stage], message: 'Add at least one subject.' });
        continue;
      }
      const subjectClash = duplicateIndex(names, subjectNameKey);
      if (subjectClash !== undefined)
        context.addIssue({ code: 'custom', path: ['subjects', stage, subjectClash], message: 'Two subjects have this name.' });
    }
  });

export type CompleteSchoolOnboardingInput = z.infer<typeof completeSchoolOnboardingInputSchema>;

/**
 * Where a school stands with its guide:
 * - `not_offered`: no row; the school was not created by its owner through
 *   the guide (an administrator's, a demo, or older than the guide).
 * - `pending`: offered and neither finished nor set aside.
 * - `skipped`: someone chose Set up later; it may still be finished.
 * - `completed`: finished.
 */
export const SCHOOL_ONBOARDING_STATES = ['not_offered', 'pending', 'skipped', 'completed'] as const;
export type SchoolOnboardingState = (typeof SCHOOL_ONBOARDING_STATES)[number];

/** `data.reason` of the CONFLICT for a guide that can no longer run, because the school already has a session or a class. */
export const ONBOARDING_SCHOOL_NOT_EMPTY_REASON = 'ONBOARDING_SCHOOL_NOT_EMPTY';
