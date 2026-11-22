import {
  subjectsOfferedInExam,
  type ClassConfig,
  type SubjectExamRef,
} from '@campuspilot/db/schema/jsonb/class-config';
import type { ModeConfig } from '@campuspilot/db/schema/jsonb/exam-config';

/**
 * The subjects of a class as an exam's screens use them (`getExamContext`,
 * the student workspace context): only subjects taking part in the exam
 * (offered in it and with their plan), in the class configuration's order.
 *
 * Each subject's modes are its **plan's** modes (`modeConfig`: slugs,
 * percentage and maximum marks), not the class subject's current
 * `examModes`, because the plan is what is examined and what the timetable
 * accepts; a mode changed in class settings after the plan was made would
 * otherwise be offered and refused. A mode's display name is read from the
 * class subject where it still has that mode, otherwise the slug is shown.
 */
export function examContextSubjects(
  subjects: ClassConfig['subjects'],
  plans: ReadonlyArray<{ subjectSlug: string; modeConfig: ModeConfig }>,
  exam: SubjectExamRef,
) {
  return Object.fromEntries(
    Object.entries(subjectsOfferedInExam(subjects, exam)).flatMap(([slug, subject]) => {
      const plan = plans.find((entry) => entry.subjectSlug === slug);
      if (!plan) return [];
      const examModes = Object.fromEntries(
        Object.entries(plan.modeConfig).map(([modeSlug, mode]) => [
          modeSlug,
          {
            name: Object.hasOwn(subject.examModes, modeSlug) ? subject.examModes[modeSlug]!.name : modeSlug,
            percentage: mode.percentage,
            maxMarks: mode.maxMarks,
          },
        ]),
      );
      return [[slug, { name: subject.name, examModes }]];
    }),
  );
}
