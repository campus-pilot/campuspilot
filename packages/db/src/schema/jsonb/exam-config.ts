import { z } from "zod";

export const examPlanStatusSchema = z.enum([
  "draft",
  "approved",
  "active",
  "completed",
]);
export const modeMarkSchema = z.object({
  percentage: z.number().min(0).max(100),
  maxMarks: z.number().int().nonnegative(),
});
export const modeConfigSchema = z
  .record(z.string().min(1), modeMarkSchema)
  .refine(
    (modes) =>
      Object.keys(modes).length > 0 &&
      Math.abs(
        Object.values(modes).reduce((sum, mode) => sum + mode.percentage, 0) -
          100,
      ) < 0.000001,
    "At least one mode is required and percentages must sum to 100%",
  );
export const resultMarksSchema = z.record(
  z.string().min(1),
  z.number().nonnegative(),
);
export const coScholasticGradesSchema = z.record(
  z.string().min(1),
  z.string().trim().min(1).max(100),
);
export const timetableCellSchema = z.object({
  subjectSlug: z.string().min(1),
  modeSlug: z.string().min(1),
});
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm");
const dateSchema = z.iso.date();
export const timetableRowSchema = z
  .object({
    id: z.string().min(1),
    date: dateSchema,
    startTime: timeSchema,
    endTime: timeSchema,
    cells: z.record(
      z.string().min(1),
      z
        .union([timetableCellSchema, z.array(timetableCellSchema).min(1)])
        .nullable(),
    ),
  })
  .refine((row) => row.startTime < row.endTime, {
    message: "End time must be after start time",
    path: ["endTime"],
  });
export const timetableConfigSchema = z
  .object({
    columns: z.array(z.string().min(1)).max(200),
    rows: z.array(timetableRowSchema).max(500),
  })
  .superRefine((config, ctx) => {
    if (new Set(config.columns).size !== config.columns.length)
      ctx.addIssue({
        code: "custom",
        path: ["columns"],
        message: "Classes must be unique",
      });
    if (new Set(config.rows.map((row) => row.id)).size !== config.rows.length)
      ctx.addIssue({
        code: "custom",
        path: ["rows"],
        message: "Row IDs must be unique",
      });
    for (const [index, row] of config.rows.entries()) {
      if (Object.keys(row.cells).some((id) => !config.columns.includes(id)))
        ctx.addIssue({
          code: "custom",
          path: ["rows", index, "cells"],
          message: "Cells must belong to a grid column",
        });
      for (const classId of config.columns) {
        const cell = row.cells[classId];
        if (
          Array.isArray(cell) &&
          new Set(cell.map((entry) => `${entry.subjectSlug}:${entry.modeSlug}`))
            .size !== cell.length
        )
          ctx.addIssue({
            code: "custom",
            path: ["rows", index, "cells", classId],
            message: "Duplicate subject and mode",
          });
        if (!cell) continue;
        if (
          config.rows
            .slice(0, index)
            .some(
              (other) =>
                other.date === row.date &&
                other.startTime < row.endTime &&
                row.startTime < other.endTime &&
                other.cells[classId],
            )
        )
          ctx.addIssue({
            code: "custom",
            path: ["rows", index],
            message: "A class has overlapping exam slots",
          });
      }
    }
  });
export type ModeConfig = z.infer<typeof modeConfigSchema>;
export type ResultMarks = z.infer<typeof resultMarksSchema>;
export type CoScholasticGrades = z.infer<typeof coScholasticGradesSchema>;
export type TimetableConfig = z.infer<typeof timetableConfigSchema>;
