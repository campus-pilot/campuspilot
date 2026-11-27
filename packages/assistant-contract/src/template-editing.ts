import { z } from 'zod';

/**
 * What any AI needs to know to edit a school document template, shared by
 * the two ways a template is edited with AI (docs/document-system.md):
 *
 * - the portable brief a person copies into their own AI app
 *   (`createTemplateEditingPrompt` in `@campuspilot/components`), which sends
 *   nothing anywhere;
 * - the in-app assistant beside the template editor, which reads the same
 *   rules from `learn_document_template_editing` and proposes a draft through
 *   `validateDocumentTemplateDraft`.
 *
 * One source, so the two never describe a different printing contract. The
 * document types are the API's template types (`templateDocumentTypeSchema`:
 * every document type but a Bill due, which is printed with the bill
 * template; the API checks at build time that both lists agree): this
 * package cannot import the API.
 */
export const TEMPLATE_DOCUMENT_TYPES = [
  'report_card',
  'id_card',
  'admit_card',
  'timetable',
  'bill',
  'receipt',
  'statement',
  'notice',
  'question_paper',
] as const;
export const templateDocumentTypeSchema = z.enum(TEMPLATE_DOCUMENT_TYPES);
export type TemplateDocumentType = z.infer<typeof templateDocumentTypeSchema>;
export type TemplatePageSize = 'full' | 'half';

/** How a template's document is named in a sentence ("Edit my CampusPilot finance bill template."). */
export const TEMPLATE_DOCUMENT_LABELS: Record<TemplateDocumentType, string> = {
  report_card: 'student report card',
  id_card: 'student ID card',
  admit_card: 'examination admit card',
  timetable: 'examination timetable',
  bill: 'finance bill',
  receipt: 'payment or refund receipt',
  statement: 'admission account statement',
  notice: 'school notice',
  question_paper: 'question paper heading and footer',
};

/**
 * The paper a template is printed on, as one rule. A Notice and a Question
 * paper design have no footprint of their own (their revisions are always
 * `full`), so `pageSize` only matters for the types that can print two-up.
 */
export function templatePaperRule(documentType: TemplateDocumentType, pageSize?: TemplatePageSize): string {
  if (documentType === 'id_card') return 'Each card must fit exactly 86mm × 54mm. CampusPilot imposes the cards onto A4 sheets.';
  if (documentType === 'timetable') return 'Use landscape A4.';
  if (documentType === 'notice') {
    return 'One design prints notices of two sizes, chosen per notice and given to the template as print.size: "full" (portrait A4 pages, 16mm margin) or "half" (210mm × 148.5mm pages, 10mm margin; CampusPilot prints two copies on each A4 sheet). Adapt to it with a class such as notice--{{print.size}} (for example a compact letterhead and smaller type for .notice--half). A notice flows over as many pages as its text needs: do not set a fixed height, overflow:hidden or outer page padding.';
  }
  if (documentType === 'question_paper') {
    return 'Use portrait A4 pages: CampusPilot sets the page margins (14mm left, right and top, 10mm bottom) and keeps a 14mm band free at the bottom of every page for the footer. The template only draws the school heading and footer; the questions are NOT part of it. Keep {{{questionPaper.bodyHtml}}} (triple braces) exactly once, in element content, where the questions belong, and never wrap it in a loop, an attribute or a condition. Put the heading in normal flow above it, and the footer in an element with position:fixed; bottom:0; left:0; right:0, at most 12mm tall, so it repeats on every printed page (never use a negative bottom). The paper flows over as many pages as it needs: do not set a fixed height, overflow:hidden or outer page padding. The dir and lang attributes are not kept: set direction with style="direction:{{questionPaper.direction}}" on the root element. Set font-family only for the heading and footer; the questions carry their own script fonts.';
  }
  return pageSize === 'half'
    ? 'Design one half-A4 document (210mm × 148.5mm). CampusPilot places two documents vertically on each portrait A4 sheet.'
    : 'Use portrait A4. Each student document starts on a new printed page.';
}

/**
 * What a type's template must handle beyond the shared rules, or null. A bill
 * template prints two kinds of document (docs/document-system.md "Bill
 * due"), and a template that assumes every bill has a number or no credits
 * prints a broken Bill due.
 */
export function templateTypeRule(documentType: TemplateDocumentType): string | null {
  if (documentType === 'bill') {
    return 'This one template prints ordinary bills and bills due (a bill for one student as of a chosen date). On a bill due billDue is set, bill.number is null (print a number such as DUE/{{billDue.date.day}}/{{billDue.date.month}}/{{billDue.date.year}} in its place) and credits[] lists payments, discounts and other credits of the period; on an ordinary bill billDue is null and credits[] is empty. Show "Statement through" only inside {{#if billDue}}. Dates are parts ({iso,day,month,year,monthName}), never preformatted; print bill.period (cadence, start, end) instead of bill.periodKey. balanceBefore and the period totals are null when zero; balanceAfter (the amount due) is always present. A design that prints only paidThisPeriod and discountThisPeriod must also print otherCreditsThisPeriod (every other credit) to add up.';
  }
  return null;
}

/**
 * The rendering contract as bullet lines. `output` is what the AI hands back,
 * which differs per way of editing (pasted text for an external app, a tool
 * call for the in-app assistant); it is the third bullet, after the paper.
 */
export function templateRenderingContract(input: {
  documentType: TemplateDocumentType;
  pageSize?: TemplatePageSize;
  output: string;
}): string {
  return [
    '- This is HTML with Handlebars bindings, rendered to PDF using Gotenberg/Chromium.',
    `- ${templatePaperRule(input.documentType, input.pageSize)}`,
    `- ${input.output}`,
    ...[templateTypeRule(input.documentType)].flatMap((rule) => (rule ? [`- ${rule}`] : [])),
    '- Preserve existing bindings and conditional/loop structure unless the requested changes require otherwise. Do not replace variables with sample or invented student data.',
    '- Use self-contained CSS in style blocks or inline styles. No JavaScript, forms, external images, fonts, stylesheets, or network requests.',
    '- School logos and student photos are provided as data URIs; use the documented image variables with conditional checks for missing images.',
    '- Use standard Handlebars helpers such as each, if, unless, and lookup. Only own properties are available.',
    '- Treat missing optional values explicitly and never fabricate zero marks, attendance, or grades.',
    '- Attendance and co-scholastic activities come from the exam-wide assessment. Use the documented root fields and honor reportSections printing flags. Never promote legacy subject metadata to shared values.',
  ].join('\n');
}

/** The longest template source, as the API's `templateContentSchema` accepts it. */
export const TEMPLATE_SOURCE_MAX_CHARS = 200_000;

/**
 * The template editor's unsaved source, sent with a message from the editor's
 * assistant (`editorSource` on `sendMessage`) when it differs from what the
 * conversation already holds: the saved revision the model can read, or the
 * assistant's own latest draft. It is the user's own working copy, so the
 * model edits what the user sees, hand edits included. It is data for the
 * model, never instructions (`buildUserTranscriptContent` fences it).
 */
export const assistantEditorSourceSchema = z.object({
  documentType: templateDocumentTypeSchema,
  content: z.string().min(1).max(TEMPLATE_SOURCE_MAX_CHARS),
});
export type AssistantEditorSource = z.infer<typeof assistantEditorSourceSchema>;

/**
 * The tools that change a school's template, by MCP name. In a conversation
 * started from the template editor (its first message carries the
 * `document_template` seed) the assistant's runtime refuses them before they
 * reach an approval card: there the person saves with the editor's own Save,
 * and the model proposes through `validateDocumentTemplateDraft` only. This
 * does not rely on the model following its instructions. Any new procedure
 * that writes a school template belongs here.
 */
export const TEMPLATE_EDITOR_REFUSED_TOOLS: ReadonlySet<string> = new Set([
  'school.saveDocumentTemplate',
  'school.selectMarketplaceTemplate',
]);

/** What a refused template write tells the model (see {@link TEMPLATE_EDITOR_REFUSED_TOOLS}). */
export const TEMPLATE_EDITOR_REFUSED_MESSAGE =
  'This conversation was started from the template editor, where only the person saves, with the editor\'s Save button. Propose the complete template with validateDocumentTemplateDraft instead; a valid draft is shown in the editor.';
