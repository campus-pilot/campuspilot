import { z } from 'zod';

/**
 * Views the assistant can show inside a conversation. The model never writes
 * markup: it fills one of these structures and the app renders it with its
 * own components, so everything it shows follows the design system.
 *
 * - `records` names platform records; the app fetches them itself, with the
 *   user's permissions, and renders the platform's record summaries.
 * - `exam_result` renders the platform's student result preview.
 * - `documents` names generated documents; the app shows each with a
 *   Download button and fetches the file itself, with the user's session. The
 *   model never writes a download link: links are long, short-lived, and
 *   models copy them unreliably.
 * - `table`, `stats`, `details`, `bars` and `notice` are composed from data
 *   the model already has (normally from a tool result).
 *
 * Limits keep a single view readable in a chat column.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const title = text(120).optional().describe('Short heading shown above the view.');

/** Semantic tones map to the app's badge and accent styles. */
export const assistantViewToneSchema = z
  .enum(['neutral', 'positive', 'warning', 'negative'])
  .describe('neutral, positive (done/healthy), warning (needs attention) or negative (failed/blocked).');
export type AssistantViewTone = z.infer<typeof assistantViewToneSchema>;

export const assistantRecordEntitySchema = z.enum(['admission', 'student', 'class', 'exam', 'staff']);
export type AssistantRecordEntity = z.infer<typeof assistantRecordEntitySchema>;

const recordsViewSchema = z.object({
  type: z.literal('records'),
  title,
  entity: assistantRecordEntitySchema.describe(
    'admission: admission ids; student: student ids (needs sessionId); class: class ids (needs sessionId); exam: exam slugs (needs sessionId); staff: user ids of school members.',
  ),
  ids: z.array(text(120)).min(1).max(12).describe('Ids (or exam slugs) exactly as tools returned them.'),
  sessionId: text(120).optional().describe('Academic session id; required for student, class and exam.'),
});

const examResultViewSchema = z.object({
  type: z.literal('exam_result'),
  title,
  sessionId: text(120),
  examSlug: text(100),
  classId: text(120),
  studentId: text(120),
});

const documentsViewSchema = z.object({
  type: z.literal('documents'),
  title,
  documents: z
    .array(
      z.object({
        artifactId: text(120).describe('The document artifact id exactly as a document tool returned it.'),
        documentType: text(60).describe('Its documentType exactly as the tool returned it, such as report_card.'),
        name: text(160).describe('What to call it, such as "Report card: Ananya Gupta, First Semester".'),
        detail: text(160).optional().describe('One short line of context, such as the class or the date generated.'),
      }),
    )
    .min(1)
    .max(12),
});

const cellValueSchema = z.union([z.string().max(300), z.number(), z.null()]);

const tableColumnSchema = z.object({
  key: text(40).describe('Property name in each row.'),
  label: text(60),
  format: z
    .enum(['text', 'number', 'date', 'badge'])
    .optional()
    .describe('number and date align right; badge shows the value as a status pill.'),
});

const tableViewSchema = z.object({
  type: z.literal('table'),
  title,
  columns: z.array(tableColumnSchema).min(1).max(6),
  rows: z.array(z.record(z.string(), cellValueSchema)).max(50),
  footnote: text(300).optional(),
});

const statsViewSchema = z.object({
  type: z.literal('stats'),
  title,
  stats: z
    .array(
      z.object({
        label: text(60),
        value: z.union([text(40), z.number()]),
        detail: text(120).optional().describe('One short line of context, such as "of 24 enrolled".'),
        tone: assistantViewToneSchema.optional(),
      }),
    )
    .min(1)
    .max(6),
});

const detailsViewSchema = z.object({
  type: z.literal('details'),
  title,
  fields: z
    .array(z.object({ label: text(60), value: z.union([z.string().max(300), z.number()]) }))
    .min(1)
    .max(16),
});

const barsViewSchema = z.object({
  type: z.literal('bars'),
  title,
  /** What the numbers measure, e.g. "students". */
  unit: text(30).optional(),
  bars: z
    .array(z.object({ label: text(60), value: z.number().min(0), tone: assistantViewToneSchema.optional() }))
    .min(1)
    .max(20),
});

const noticeViewSchema = z.object({
  type: z.literal('notice'),
  tone: assistantViewToneSchema,
  title,
  text: text(500),
});

export const assistantViewSchema = z.discriminatedUnion('type', [
  recordsViewSchema,
  examResultViewSchema,
  documentsViewSchema,
  tableViewSchema,
  statsViewSchema,
  detailsViewSchema,
  barsViewSchema,
  noticeViewSchema,
]);
export type AssistantView = z.infer<typeof assistantViewSchema>;
export type AssistantRecordsView = z.infer<typeof recordsViewSchema>;
export type AssistantExamResultView = z.infer<typeof examResultViewSchema>;
export type AssistantDocumentsView = z.infer<typeof documentsViewSchema>;
export type AssistantTableView = z.infer<typeof tableViewSchema>;
export type AssistantStatsView = z.infer<typeof statsViewSchema>;
export type AssistantDetailsView = z.infer<typeof detailsViewSchema>;
export type AssistantBarsView = z.infer<typeof barsViewSchema>;
export type AssistantNoticeView = z.infer<typeof noticeViewSchema>;

/**
 * The one display tool the model calls. A single tool with a discriminated
 * `view` keeps the tool list short and gives every provider one schema.
 */
export const SHOW_VIEW_TOOL_NAME = 'show_view';

export const showViewInputSchema = z.object({ view: assistantViewSchema });

export const SHOW_VIEW_TOOL_DESCRIPTION = [
  'Show information to the user as a view inside the chat, rendered with the app’s own components.',
  'Use it whenever an answer contains records, lists, numbers or comparisons, instead of writing tables or long lists in text:',
  'records for specific admissions, students, classes, exams or staff (pass their ids); exam_result for one student’s result in an exam;',
  'documents for generated documents such as report cards, bills or receipts, each shown with a Download button (this is the only way to give the user a document: never write a download link);',
  'table for rows of data; stats for a few headline numbers; details for one item’s facts; bars to compare amounts; notice for one important caution.',
  'Only use data you got from tools. After showing a view, add at most one or two sentences of explanation; do not repeat what the view shows.',
].join(' ');
