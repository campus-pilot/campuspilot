import { z } from 'zod';
import type { StudentExamWorkspaceDto } from '@campuspilot/api/routers/school/exam/exam.dto';
import { numericText, optionalIntegerText } from './exam-model';

export function studentExamDefaults(data: StudentExamWorkspaceDto) {
  return {
    subjects: data.subjects.map(({ plan, result }) => ({
      examPlanId: plan.id,
      marks: Object.keys(plan.modeConfig).map((slug) => ({
        slug,
        value:
          result?.marks[slug] === undefined ? '' : String(result.marks[slug]),
      })),
    })),
    grades: [
      ...new Set([
        ...Object.keys(data.context.coScholasticAreas),
        ...Object.keys(data.assessment?.coScholastics ?? {}),
      ]),
    ].map((slug) => ({
      slug,
      value: data.assessment?.coScholastics?.[slug] ?? '',
    })),
    daysAttended:
      data.assessment?.daysAttended == null
        ? ''
        : String(data.assessment.daysAttended),
    approved: false,
  };
}
export function studentExamSchema(data: StudentExamWorkspaceDto) {
  return z
    .object({
      subjects: z.array(
        z.object({
          examPlanId: z.string(),
          marks: z.array(z.object({ slug: z.string(), value: numericText })),
        }),
      ),
      grades: z.array(
        z.object({ slug: z.string(), value: z.string().trim().max(100) }),
      ),
      daysAttended: optionalIntegerText,
      approved: z.boolean(),
    })
    .superRefine((value, ctx) => {
      if (
        value.subjects.length !== data.subjects.length ||
        new Set(value.subjects.map((subject) => subject.examPlanId)).size !==
          data.subjects.length ||
        data.subjects.some(
          ({ plan }) =>
            !value.subjects.some((subject) => subject.examPlanId === plan.id),
        )
      )
        ctx.addIssue({
          code: 'custom',
          path: ['subjects'],
          message: 'Include every subject exactly once.',
        });
      value.subjects.forEach((subject, index) => {
        const plan = data.subjects.find(
          (entry) => entry.plan.id === subject.examPlanId,
        )?.plan;
        if (
          !plan ||
          subject.marks.length !== Object.keys(plan.modeConfig).length ||
          new Set(subject.marks.map((mark) => mark.slug)).size !==
            Object.keys(plan.modeConfig).length ||
          Object.keys(plan.modeConfig).some(
            (slug) => !subject.marks.some((mark) => mark.slug === slug),
          )
        )
          ctx.addIssue({
            code: 'custom',
            path: ['subjects', index, 'marks'],
            message: 'Include every assessment mode exactly once.',
          });
        subject.marks.forEach((mark, modeIndex) => {
          const mode = plan?.modeConfig[mark.slug];
          if (
            !mode ||
            Number(mark.value) < 0 ||
            Number(mark.value) > mode.maxMarks
          )
            ctx.addIssue({
              code: 'custom',
              path: ['subjects', index, 'marks', modeIndex, 'value'],
              message: `Enter a score from 0 to ${mode?.maxMarks ?? 0}`,
            });
        });
      });
      if (
        value.daysAttended !== '' &&
        (!data.context.attendanceTracking.enabled ||
          data.totalWorkingDays === null ||
          Number(value.daysAttended) > data.totalWorkingDays)
      )
        ctx.addIssue({
          code: 'custom',
          path: ['daysAttended'],
          message:
            'Attendance requires enabled tracking and exam working days, and cannot exceed working days.',
        });
      value.grades.forEach((grade, index) => {
        if (
          grade.value.trim() &&
          !Object.hasOwn(data.context.coScholasticAreas, grade.slug)
        )
          ctx.addIssue({
            code: 'custom',
            path: ['grades', index, 'value'],
            message:
              'This area is no longer configured. Clear this historical grade or restore the session configuration.',
          });
      });
    });
}
/** Blank marks are rejected by validation; blank optional metadata is explicit null. */
export function studentExamPayload(
  value: ReturnType<typeof studentExamDefaults>,
) {
  const grades = Object.fromEntries(
    value.grades
      .filter((grade) => grade.value.trim())
      .map((grade) => [grade.slug, grade.value.trim()]),
  );
  return {
    subjects: value.subjects.map((subject) => ({
      examPlanId: subject.examPlanId,
      marks: Object.fromEntries(
        subject.marks.map((mark) => [mark.slug, Number(mark.value)]),
      ),
    })),
    daysAttended: value.daysAttended === '' ? null : Number(value.daysAttended),
    coScholastics: Object.keys(grades).length ? grades : null,
    approved: value.approved,
  };
}
