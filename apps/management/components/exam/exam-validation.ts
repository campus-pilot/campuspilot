import { z } from 'zod';
import {
  saveExamTimetableInputSchema,
  type ExamContextDto,
} from '@campuspilot/api/routers/school/exam/exam.dto';
import {
  numericText,
  optionalIntegerText,
  positiveIntegerText,
} from './exam-model';

/** Validates exact integer maxima; fractional maxima are never rounded into valid plans. */
export function planFormSchema(context: ExamContextDto) {
  return z
    .object({
      classId: z.string().min(1, 'Choose a class'),
      subjectSlug: z.string().min(1, 'Choose a subject'),
      totalMarks: positiveIntegerText,
      totalWorkingDays: optionalIntegerText,
      modes: z.array(
        z.object({
          slug: z.string(),
          percentage: z.string(),
          enabled: z.boolean(),
        }),
      ),
      duplicate: z.boolean(),
    })
    .superRefine((value, ctx) => {
      const selected = value.modes.filter((mode) => mode.enabled);
      if (
        selected.length === 0 ||
        Math.abs(
          selected.reduce((sum, mode) => sum + Number(mode.percentage), 0) -
            100,
        ) >= 0.000001
      )
        ctx.addIssue({
          code: 'custom',
          path: ['modes'],
          message:
            'Select at least one configured component. Percentages must total 100%.',
        });
      if (new Set(selected.map((mode) => mode.slug)).size !== selected.length)
        ctx.addIssue({
          code: 'custom',
          path: ['modes'],
          message: 'Assessment components must be unique',
        });
      const allowed =
        context.classes.find((item) => item.id === value.classId)?.subjects[
          value.subjectSlug
        ]?.examModes ?? {};
      value.modes.forEach((mode, index) => {
        if (!mode.enabled) return;
        if (!numericText.safeParse(mode.percentage).success)
          ctx.addIssue({
            code: 'custom',
            path: ['modes', index, 'percentage'],
            message: 'Enter a component percentage',
          });
        if (!allowed[mode.slug])
          ctx.addIssue({
            code: 'custom',
            path: ['modes', index, 'percentage'],
            message:
              'This component is no longer configured. Explicitly remove it or restore class configuration.',
          });
        const percentage = Number(mode.percentage);
        const max = (Number(value.totalMarks) * percentage) / 100;
        if (percentage < 0 || percentage > 100 || !Number.isInteger(max))
          ctx.addIssue({
            code: 'custom',
            path: ['modes', index, 'percentage'],
            message:
              'Use 0–100%; maxima must be whole numbers. Change the total or percentages; fractional maxima are not rounded.',
          });
      });
      if (!context.attendanceTracking.enabled && value.totalWorkingDays !== '')
        ctx.addIssue({
          code: 'custom',
          path: ['totalWorkingDays'],
          message:
            'Attendance tracking is disabled. Explicitly clear working days to save.',
        });
    });
}

/** Validates the entire shared grid, including hidden class columns and their overlaps. */
export function timetableSchema(context: ExamContextDto) {
  return saveExamTimetableInputSchema.shape.config.superRefine(
    (config, ctx) => {
      config.columns.forEach((id, index) => {
        if (!context.classes.some((item) => item.id === id))
          ctx.addIssue({
            code: 'custom',
            path: ['columns', index],
            message: 'Column class is no longer available in this school',
          });
      });
      config.rows.forEach((row, index) =>
        Object.entries(row.cells).forEach(([classId, cell]) =>
          (cell === null ? [] : Array.isArray(cell) ? cell : [cell]).forEach(
            (pair) => {
              const subject = context.classes.find(
                (item) => item.id === classId,
              )?.subjects[pair.subjectSlug];
              if (!subject?.examModes[pair.modeSlug])
                ctx.addIssue({
                  code: 'custom',
                  path: ['rows', index, 'cells', classId],
                  message:
                    'Choose a configured subject and assessment component for this class',
                });
            },
          ),
        ),
      );
    },
  );
}

/** Grid input lives in one form field; row-level details are derived from the same schema without orphaned nested field errors. */
export function timetableFormSchema(context: ExamContextDto) {
  const configSchema = timetableSchema(context);
  return z.object({
    config: z
      .custom<z.infer<typeof saveExamTimetableInputSchema>['config']>()
      .superRefine((config, ctx) => {
        const parsed = configSchema.safeParse(config);
        if (!parsed.success)
          ctx.addIssue({
            code: 'custom',
            message: parsed.error.issues
              .map((issue) => issue.message)
              .join('; '),
          });
      }),
    classId: z.string(),
    addClassId: z.string(),
    message: z.string(),
  });
}
