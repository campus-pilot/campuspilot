import { z } from "zod";

export const bookSchema = z
  .object({
    title: z
      .string()
      .min(1, "Book title is required")
      .describe("Title of the textbook"),
    publication: z.string().optional().describe("Publisher name"),
    author: z.string().optional().describe("Author name"),
  })
  .describe("A textbook prescribed for a subject");

export const examModeSchema = z
  .object({
    name: z
      .string()
      .min(1, "Mode name is required")
      .describe("Display name (e.g. 'Written', 'Practical')"),
    percentage: z
      .number()
      .min(0)
      .max(100)
      .describe("Weight as percentage of total marks"),
  })
  .describe("An exam assessment mode for a subject");

export const examModesSchema = z
  .record(
    z.string().min(1).describe("Mode slug (e.g. 'written', 'practical')"),
    examModeSchema,
  )
  .describe("Map of exam mode slug to mode definition");

export const subjectSchema = z
  .object({
    name: z
      .string()
      .min(1, "Subject name is required")
      .describe("Display name of the subject (e.g. 'Mathematics', 'English')"),
    books: z
      .array(bookSchema)
      .optional()
      .default([])
      .describe("Prescribed textbooks for this subject"),
    examModes: examModesSchema
      .optional()
      .default({})
      .describe("Exam assessment modes and their weights for this subject"),
  })
  .describe("Subject configuration including books and exam modes");

export const classConfigSchema = z
  .object({
    subjects: z
      .record(
        z.string().min(1).describe("Subject slug (e.g. 'math', 'english')"),
        subjectSchema,
      )
      .optional()
      .default({})
      .describe("Map of subject slug to subject configuration"),
  })
  .describe("Class-level configuration defining subjects, books, and exam modes");

export type ClassConfig = z.infer<typeof classConfigSchema>;
export type Subject = z.infer<typeof subjectSchema>;
export type Book = z.infer<typeof bookSchema>;
export type ExamMode = z.infer<typeof examModeSchema>;
