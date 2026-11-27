import { phoneNumberSchema } from '@campuspilot/db/phone';
import { ASSISTANT_MIN_LIMIT_USD, SCHOOL_FEATURE_KEYS, schoolTierSchema, type SchoolFeatureKey } from '@campuspilot/db/feature-flags/catalogue';
import { examNameKey } from '@campuspilot/db/schema/jsonb/session-config';
import { z } from 'zod';

import { DEFAULT_ONBOARDING_EXAM_NAMES, ONBOARDING_CLASSES, ONBOARDING_MAX_EXAMS, academicSessionStartYear } from '../school-onboarding/school-onboarding.contract';

/**
 * Setting up a real school from a School Onboarding form submission
 * (docs/school-onboarding-form.md, "Setting up the school"): the wizard's
 * steps, the draft it saves and the rules a draft must meet before the
 * `SchoolSetup` workflow may run it. Shared by the API, the worker and the
 * admin app, so all three apply one rule. Kept free of server imports.
 */

/** The wizard's steps, in order. People come last: accounts are the final decision. */
export const SCHOOL_SETUP_WIZARD_STEPS = [
  { id: 'school', label: 'School' },
  { id: 'plan', label: 'Plan and trial' },
  { id: 'features', label: 'Features' },
  { id: 'session', label: 'Session' },
  { id: 'classes', label: 'Classes' },
  { id: 'people', label: 'People' },
] as const;
export type SchoolSetupWizardStep = (typeof SCHOOL_SETUP_WIZARD_STEPS)[number]['id'];
export const SCHOOL_SETUP_WIZARD_STEP_IDS = SCHOOL_SETUP_WIZARD_STEPS.map((step) => step.id) as [SchoolSetupWizardStep, ...SchoolSetupWizardStep[]];

/** The workflow's steps, in execution order; the admin app shows each as it runs. */
export const SCHOOL_SETUP_RUN_STEPS = ['school', 'plan', 'session', 'classes', 'exam-plans', 'people'] as const;
export type SchoolSetupRunStep = (typeof SCHOOL_SETUP_RUN_STEPS)[number];

export const SCHOOL_SETUP_RUN_STEP_LABELS: Record<SchoolSetupRunStep, string> = {
  school: 'Creating the school and its logo',
  plan: 'Starting the trial and setting features',
  session: 'Creating the session and examinations',
  classes: 'Creating classes, sections and subjects',
  'exam-plans': 'Generating examination plans',
  people: 'Adding you as manager and the principal',
};

/** Longest trial the wizard offers, in 28-day billing periods (a trial ends within a year). */
export const SCHOOL_SETUP_MAX_TRIAL_PERIODS = 13;
export const SCHOOL_SETUP_MAX_CLASSES = 40;
export const SCHOOL_SETUP_MAX_SECTIONS = 26;
export const SCHOOL_SETUP_MAX_SUBJECTS = 30;
export const SCHOOL_SETUP_NAME_MAX_LENGTH = 40;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * `hello world 2` → `hello-world-2`: lowercase letters and digits joined by
 * single hyphens, the school, class and section slug rule. Empty for a name
 * with no Latin letters or digits.
 */
export function kebabSlug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Class and section slugs for names, one per name and all different: a
 * class the guided setup knows keeps its slug (`Class 1` → `class-1`), any
 * other the kebab form of its name, or `fallback-n` when nothing is left.
 */
export function setupSlugs(names: readonly string[], fallback: string, known: Readonly<Record<string, string>> = {}) {
  const taken = new Set<string>();
  return names.map((name, index) => {
    const base = known[name.trim().toLowerCase()] ?? (kebabSlug(name) || `${fallback}-${index + 1}`);
    let slug = base;
    for (let suffix = 2; taken.has(slug); suffix += 1) slug = `${base}-${suffix}`;
    taken.add(slug);
    return slug;
  });
}

/** The guided setup's class slugs by lowercase label, so `Class 1` is `class-1` in both. */
export const KNOWN_CLASS_SLUGS: Readonly<Record<string, string>> = Object.fromEntries(
  ONBOARDING_CLASSES.map((entry) => [entry.label.toLowerCase(), entry.slug]),
);

const text = (max: number) => z.string().max(max);
const names = (maxItems: number) => z.array(text(SCHOOL_SETUP_NAME_MAX_LENGTH)).max(maxItems);

/**
 * The draft as saved: every field present, bounded, but not yet required to
 * be complete, so a half-finished wizard can be saved and reopened.
 *
 * - `plan.standingTier`: the subscription the school starts with (null for
 *   none); `plan.trial`: a trial of `tier` for `periods` 28-day periods from
 *   the moment the workflow runs (`enabled` false for none).
 * - `features`: the administrator's adjustment per feature on top of the
 *   plan (`true` on, `false` off, absent to follow the plan). The assistant
 *   also needs `assistantMonthlyLimitUsd` when switched on (null: no limit).
 * - `people.addMeAsManager`: whether the admin who runs the setup becomes a
 *   manager of the school. `people.principal`: the form's contact, the
 *   school's principal and owner, found by phone (else email) or created.
 */
export const schoolSetupDraftSchema = z.object({
  school: z.object({
    name: text(160),
    slug: text(100),
    location: text(1_000),
    registrationNo: text(100),
    useRequestLogo: z.boolean(),
  }),
  plan: z.object({
    standingTier: schoolTierSchema.nullable(),
    trial: z.object({
      enabled: z.boolean(),
      tier: schoolTierSchema,
      periods: z.number().int().min(1).max(SCHOOL_SETUP_MAX_TRIAL_PERIODS),
    }),
  }),
  features: z.object({
    adjustments: z.partialRecord(z.enum(SCHOOL_FEATURE_KEYS), z.boolean()),
    // The same bounds as the assistant feature's config, which this becomes.
    assistantMonthlyLimitUsd: z.number().min(ASSISTANT_MIN_LIMIT_USD).max(1_000_000).nullable(),
  }),
  session: z.object({
    startYear: z.number().int().min(2000).max(2100),
    examNames: z.array(text(100)).max(ONBOARDING_MAX_EXAMS),
  }),
  classes: z
    .array(z.object({ name: text(SCHOOL_SETUP_NAME_MAX_LENGTH), sections: names(SCHOOL_SETUP_MAX_SECTIONS), subjects: names(SCHOOL_SETUP_MAX_SUBJECTS) }))
    .max(SCHOOL_SETUP_MAX_CLASSES),
  people: z.object({
    addMeAsManager: z.boolean(),
    principal: z.object({ name: text(120), phone: text(20), email: text(254) }),
  }),
});
export type SchoolSetupDraft = z.infer<typeof schoolSetupDraftSchema>;

function duplicateIndex(values: readonly string[], key: (value: string) => string = (value) => value.trim().toLowerCase()) {
  const seen = new Set<string>();
  return values.findIndex((value) => {
    const k = key(value);
    if (seen.has(k)) return true;
    seen.add(k);
    return false;
  });
}

/**
 * The rules a draft must meet before it runs, each reported at its own
 * path so the wizard can show it beside the field and send the admin to its
 * step. Checked by `startSchoolSetup` and again by the workflow.
 */
export const schoolSetupReadySchema = schoolSetupDraftSchema.superRefine((draft, context) => {
  const issue = (path: (string | number)[], message: string) => context.addIssue({ code: 'custom', path, message });
  if (draft.school.name.trim().length < 2) issue(['school', 'name'], 'Enter the school name.');
  if (!SLUG_PATTERN.test(draft.school.slug)) issue(['school', 'slug'], 'Use lowercase letters, numbers and single hyphens.');
  if (!draft.school.location.trim()) issue(['school', 'location'], 'Enter where the school is.');
  if (!draft.plan.standingTier && !draft.plan.trial.enabled) issue(['plan', 'trial'], 'Give the school a trial or a tier, or it starts read-only.');
  const examNames = draft.session.examNames.map((name) => name.trim());
  if (examNames.length === 0) issue(['session', 'examNames'], 'Add at least one examination.');
  if (examNames.some((name) => !name)) issue(['session', 'examNames'], 'Name every examination.');
  if (duplicateIndex(examNames, examNameKey) !== -1) issue(['session', 'examNames'], 'Each examination must have its own name.');
  if (draft.classes.length === 0) issue(['classes'], 'Add at least one class.');
  if (duplicateIndex(draft.classes.map((entry) => entry.name)) !== -1) issue(['classes'], 'Each class must be listed once.');
  draft.classes.forEach((entry, index) => {
    if (!entry.name.trim()) issue(['classes', index, 'name'], 'Name the class.');
    if (entry.sections.length === 0) issue(['classes', index, 'sections'], `Give ${entry.name || 'this class'} at least one section.`);
    if (entry.subjects.length === 0) issue(['classes', index, 'subjects'], `Give ${entry.name || 'this class'} at least one subject.`);
    if (duplicateIndex(entry.sections) !== -1 || duplicateIndex(entry.subjects) !== -1) issue(['classes', index], 'List each section and subject once.');
  });
  const { principal } = draft.people;
  if (!principal.phone && !principal.email) issue(['people', 'principal', 'phone'], "Give the principal's phone number or email.");
  if (principal.phone && !phoneNumberSchema.safeParse(principal.phone).success) issue(['people', 'principal', 'phone'], 'Enter a valid phone number.');
  if (principal.email && !z.email().safeParse(principal.email).success) issue(['people', 'principal', 'email'], 'Enter a valid email address.');
});

/** The wizard step a ready-check issue belongs to: its path's first part. */
export function wizardStepOfIssue(path: readonly PropertyKey[]): SchoolSetupWizardStep {
  const first = String(path[0] ?? '');
  return (SCHOOL_SETUP_WIZARD_STEP_IDS as readonly string[]).includes(first) ? (first as SchoolSetupWizardStep) : 'school';
}

/** What the request's answers propose, read defensively key by key (the JSON outlives any form revision). */
export type SchoolSetupRequestFacts = {
  schoolName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  classes: { name: string; sections: string[]; subjects: string[] }[];
  hasLogo: boolean;
};

export function readRequestFacts(response: Record<string, unknown>, hasLogo: boolean): SchoolSetupRequestFacts {
  const textOf = (key: string) => (typeof response[key] === 'string' && (response[key] as string).trim() ? (response[key] as string) : null);
  const namesOf = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
  const classes = Array.isArray(response.classes)
    ? response.classes.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const entry = item as Record<string, unknown>;
        return typeof entry.name === 'string' ? [{ name: entry.name, sections: namesOf(entry.sections), subjects: namesOf(entry.subjects) }] : [];
      })
    : [];
  return { schoolName: textOf('schoolName'), address: textOf('address'), phone: textOf('phone'), email: textOf('email'), classes, hasLogo };
}

/**
 * The first draft of a setup, from the request's answers. Defaults: a
 * one-period Pro trial (the form's schools run students and fees), no
 * standing tier, no feature adjustments, the guided setup's session year and
 * examinations, and the admin added as manager.
 */
export function initialSchoolSetupDraft(facts: SchoolSetupRequestFacts, now: Date): SchoolSetupDraft {
  const name = facts.schoolName ?? '';
  return {
    school: { name, slug: kebabSlug(name), location: facts.address ?? '', registrationNo: '', useRequestLogo: facts.hasLogo },
    plan: { standingTier: null, trial: { enabled: true, tier: 'pro', periods: 1 } },
    features: { adjustments: {}, assistantMonthlyLimitUsd: null },
    session: { startYear: academicSessionStartYear(now), examNames: [...DEFAULT_ONBOARDING_EXAM_NAMES] },
    classes: facts.classes.slice(0, SCHOOL_SETUP_MAX_CLASSES).map((entry) => ({
      name: entry.name.slice(0, SCHOOL_SETUP_NAME_MAX_LENGTH),
      sections: entry.sections.slice(0, SCHOOL_SETUP_MAX_SECTIONS),
      subjects: entry.subjects.slice(0, SCHOOL_SETUP_MAX_SUBJECTS),
    })),
    people: { addMeAsManager: true, principal: { name: '', phone: facts.phone ?? '', email: facts.email ?? '' } },
  };
}

/** Features in catalogue order, for the wizard's Features step. */
export const SCHOOL_SETUP_FEATURES: readonly SchoolFeatureKey[] = SCHOOL_FEATURE_KEYS;
