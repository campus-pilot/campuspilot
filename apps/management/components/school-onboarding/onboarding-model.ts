import {
  DEFAULT_ONBOARDING_EXAM_NAMES,
  ONBOARDING_CLASSES,
  ONBOARDING_MAX_EXAMS,
  ONBOARDING_STAGES,
  academicSessionStartYear,
  completeSchoolOnboardingInputSchema,
  onboardingSessionStartYearSchema,
  stagesOfClasses,
  subjectNameKey,
  type CompleteSchoolOnboardingInput,
  type OnboardingStageKey,
} from '@campuspilot/api/school-onboarding/school-onboarding.contract';
import { z } from 'zod';

/** The question paper designs the guide offers, from the template marketplace. */
export const ONBOARDING_PAPER_DESIGNS = [
  { slug: 'question-paper-classic', label: 'Classic', description: 'Centred letterhead, serif heading' },
  { slug: 'question-paper-compact', label: 'Compact', description: 'Logo on the left, more room for questions' },
] as const;
export type OnboardingPaperDesign = (typeof ONBOARDING_PAPER_DESIGNS)[number]['slug'];

/** Whether a template's marketplace slug (null for one the school wrote) is one of the guide's designs. */
export function isOnboardingPaperDesign(slug: string | null): slug is OnboardingPaperDesign {
  return ONBOARDING_PAPER_DESIGNS.some((design) => design.slug === slug);
}

/** The guide's screens before it saves, in order. */
export const ONBOARDING_STEPS = ['session', 'exams', 'classes', 'subjects', 'header'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/**
 * Everything the guide asks, held in one form across its screens. `newSubject`
 * is the text of each stage's Add subject box; `logo` the optional picture for
 * the paper header, uploaded through the school's logo route when the guide
 * saves.
 */
export type OnboardingValues = {
  sessionStartYear: number;
  examNames: string[];
  classSlugs: string[];
  subjects: Record<OnboardingStageKey, string[]>;
  newSubject: Record<OnboardingStageKey, string>;
  design: OnboardingPaperDesign;
  logo: File | null;
};

/** What the guide proposes: this academic year, four examinations, Nursery to Class 10 and each stage's starter subjects. */
export function onboardingDefaults(now: Date): OnboardingValues {
  const stageRecord = <T,>(value: (stage: (typeof ONBOARDING_STAGES)[number]) => T) =>
    Object.fromEntries(ONBOARDING_STAGES.map((stage) => [stage.key, value(stage)])) as Record<OnboardingStageKey, T>;
  return {
    sessionStartYear: academicSessionStartYear(now),
    examNames: [...DEFAULT_ONBOARDING_EXAM_NAMES],
    classSlugs: ONBOARDING_CLASSES.filter((entry) => entry.preselected).map((entry) => entry.slug),
    subjects: stageRecord((stage) => [...stage.subjects]),
    newSubject: stageRecord(() => ''),
    design: 'question-paper-classic',
    logo: null,
  };
}

/** The name the count stepper gives the examination it adds at `index`. */
export function examNameAt(index: number): string {
  return DEFAULT_ONBOARDING_EXAM_NAMES[index] ?? `Exam ${index + 1}`;
}

/** Whether another examination may be added. */
export const canAddExam = (count: number) => count < ONBOARDING_MAX_EXAMS;

/** Whether the session may start in this year (the procedure's rule), so the arrows stop at its bounds. */
export function isSessionYearAllowed(year: number): boolean {
  return onboardingSessionStartYearSchema.safeParse(year).success;
}

/** Whether a stage already has a subject of this name, compared as the procedure compares them. */
export function hasSubject(subjects: readonly string[], name: string): boolean {
  const key = subjectNameKey(name);
  return subjects.some((subject) => subjectNameKey(subject) === key);
}

/** The academic session as people write it: 2026–27. */
export function sessionLabel(startYear: number): string {
  return `${startYear}–${String(startYear + 1).slice(-2)}`;
}

/** The request the guide sends: only the subjects of stages with a chosen class. */
export function onboardingInput(schoolId: string, values: OnboardingValues): CompleteSchoolOnboardingInput {
  const stages = stagesOfClasses(values.classSlugs);
  return {
    schoolId,
    sessionStartYear: values.sessionStartYear,
    examNames: values.examNames,
    classSlugs: values.classSlugs,
    subjects: Object.fromEntries(stages.map((stage) => [stage, values.subjects[stage]])),
  };
}

/**
 * The form's validator: the procedure's own input rule, run over what the
 * guide would send, so a field error on screen is the error the server would
 * give. Issues keep their paths (`examNames.1`, `subjects.primary`), which
 * TanStack Form shows beside the matching field.
 */
export const onboardingFormSchema = z.custom<OnboardingValues>().superRefine((values, context) => {
  const parsed = completeSchoolOnboardingInputSchema.safeParse(onboardingInput('school', values));
  if (parsed.success) return;
  for (const issue of parsed.error.issues) context.addIssue({ code: 'custom', message: issue.message, path: issue.path });
});

/** The input paths each screen answers, so a screen is complete when none of its paths has an issue. */
const STEP_PATHS: Record<OnboardingStep, string | null> = {
  session: 'sessionStartYear',
  exams: 'examNames',
  classes: 'classSlugs',
  subjects: 'subjects',
  header: null,
};

/** Whether a screen's answers are acceptable, read from the same rule the server applies. */
export function isStepComplete(step: OnboardingStep, values: OnboardingValues): boolean {
  const path = STEP_PATHS[step];
  if (path === null) return true;
  const parsed = completeSchoolOnboardingInputSchema.safeParse(onboardingInput('school', values));
  return parsed.success || !parsed.error.issues.some((issue) => issue.path[0] === path);
}

/** The chosen classes of a stage, in school order, for its heading (Class 1 – Class 5). */
export function stageClassRange(stage: OnboardingStageKey, classSlugs: readonly string[]): string {
  const chosen = new Set(classSlugs);
  const labels = ONBOARDING_CLASSES.filter((entry) => entry.stage === stage && chosen.has(entry.slug)).map((entry) => entry.label);
  return labels.length > 1 ? `${labels[0]} – ${labels.at(-1)}` : (labels[0] ?? '');
}

/** How many subject papers each examination will have: the subjects of every chosen class. */
export function subjectPaperCount(values: Pick<OnboardingValues, 'classSlugs' | 'subjects'>): number {
  const chosen = new Set(values.classSlugs);
  return ONBOARDING_CLASSES.filter((entry) => chosen.has(entry.slug)).reduce(
    (total, entry) => total + values.subjects[entry.stage].length,
    0,
  );
}
