import { z } from 'zod';
import {
  saveExamTimetableInputSchema,
  type ExamContextDto,
} from '@campuspilot/api/routers/school/exam/exam.dto';
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
            (pair, pairIndex) => {
              const subject = context.classes.find(
                (item) => item.id === classId,
              )?.subjects[pair.subjectSlug];
              if (!subject?.examModes[pair.modeSlug])
                ctx.addIssue({
                  code: 'custom',
                  path: [
                    'rows',
                    index,
                    'cells',
                    classId,
                    ...(Array.isArray(cell) ? [pairIndex] : []),
                  ],
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
  });
}
