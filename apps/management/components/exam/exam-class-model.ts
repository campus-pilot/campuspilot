import type { ExamPlanPreviewDto } from '@campuspilot/api/routers/school/exam/exam.dto';

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
