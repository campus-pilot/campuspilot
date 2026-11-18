import { z } from 'zod';
import {
  examClassSelectionSchema,
  type ExamPlanPreviewDto,
} from '@campuspilot/api/routers/school/exam/exam.dto';

/**
 * The first problem that blocks saving this selection: an invalid subject of
 * a chosen class (a class left out does not block anything), as the server
 * reports it. Null when nothing blocks.
 */
export function selectionIssue(
  preview: ExamPlanPreviewDto,
  classIds: readonly string[],
): string | null {
  for (const schoolClass of preview.classes) {
    if (!classIds.includes(schoolClass.classId)) continue;
    const subject = schoolClass.subjects.find((entry) => entry.issue !== null);
    if (subject) return `${schoolClass.label} · ${subject.name}: ${subject.issue}`;
  }
  return null;
}

/** How many subject plans the chosen classes have. */
export function selectedPlanCount(
  preview: ExamPlanPreviewDto,
  classIds: readonly string[],
): number {
  return preview.classes
    .filter((schoolClass) => classIds.includes(schoolClass.classId))
    .reduce((sum, schoolClass) => sum + schoolClass.subjects.length, 0);
}

/** The classes taking part now, in the preview's order. */
export function participatingClassIds(preview: ExamPlanPreviewDto): string[] {
  return preview.classes
    .filter((schoolClass) => schoolClass.participating)
    .map((schoolClass) => schoolClass.classId);
}

/** The first message of a field's validation errors (Zod issues or strings). */
export function fieldError(errors: readonly unknown[]): string | undefined {
  for (const error of errors) {
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object' && 'message' in error)
      return String(error.message);
  }
  return undefined;
}

/** The values of a form choosing the classes taking part in an examination. */
export type ClassSelectionValues = { classIds: string[] };

const classSelectionSchema = z.object({ classIds: examClassSelectionSchema });

/**
 * TanStack Form options for choosing the classes of an examination, shared by
 * Create exam plan and Edit classes.
 *
 * A save the server refuses is handed to `onRefused` and is never written into
 * the form's error map. TanStack Form treats a form-level `onSubmit` error as
 * invalid until a field changes, so `canSubmit` stayed false and the button
 * (gated on it) could not retry the same selection, for example after the
 * results blocking a removal were deleted elsewhere. The caller shows the
 * refusal outside the form and clears it in `onAttempt`, which runs as each
 * attempt that passed validation starts.
 */
export function classSelectionFormOptions({
  classIds,
  save,
  onAttempt,
  onRefused,
}: {
  /** The selection the form starts with. */
  classIds: string[];
  /** Saves the selection; a rejection is a refusal. */
  save: (classIds: string[]) => Promise<void>;
  onAttempt: () => void;
  onRefused: (error: unknown) => void | Promise<void>;
}) {
  return {
    defaultValues: { classIds } as ClassSelectionValues,
    validators: { onChange: classSelectionSchema, onSubmit: classSelectionSchema },
    onSubmit: async ({ value }: { value: ClassSelectionValues }) => {
      onAttempt();
      try {
        await save(value.classIds);
      } catch (error) {
        await onRefused(error);
      }
    },
  };
}
