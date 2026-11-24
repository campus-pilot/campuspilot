import { createHash } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { QUESTION_PAPER_LIMITS } from "@campuspilot/question-paper/limits";
import {
  TEMPLATE_DOCUMENT_TYPES,
  templateRenderingContract,
  type TemplateDocumentType,
} from "@campuspilot/assistant-contract/template-editing";

import {
  assertValidSchoolNoticeTemplate,
  imposeHalfPageNoticeCopies,
  renderNoticeDocument,
} from "../notice/notice.render";
import {
  assertValidSchoolQuestionPaperTemplate,
  renderSampleQuestionPaperDocument,
} from "../question-paper/question-paper.render";
import type { QuestionPaperContext } from "../question-paper/question-paper.context";
import { DOCUMENT_CONTEXT_HELP, sampleDocumentContext } from "./document.catalog";
import { contextImageChars } from "./document.images";
import { rpcError } from "../../../errors";
import type { DocumentTemplatePageSize, DocumentType } from "./document.dto";
import { combineDocuments, convertDocumentPdf, isConversionTimeout, renderDocument } from "./document.render";

/**
 * The document types the shared template-editing contract names are exactly
 * the API's: the contract package cannot import the API, so this fails the
 * build when one list gains a type the other lacks.
 */
const sameTypes: [DocumentType, TemplateDocumentType] extends [TemplateDocumentType, DocumentType] ? true : never = true;
void sameTypes;
void TEMPLATE_DOCUMENT_TYPES;

/**
 * Refuses template source that the school could not print, exactly as a save
 * checks it (`saveTemplate`): a Notice design the way notices render it (their
 * output budget and logo limit, at both print sizes), a Question paper design
 * with its one body slot, and every other type against its synthetic sample.
 * Every refusal is a BAD_REQUEST with the reason. Shared by the save and by
 * `validateDocumentTemplateDraft`, so a draft the assistant called valid is a
 * template the editor can save.
 */
export function assertValidTemplateSource(documentType: DocumentType, content: string): void {
  if (documentType === "notice") assertValidSchoolNoticeTemplate(content);
  else if (documentType === "question_paper") assertValidSchoolQuestionPaperTemplate(content);
  else renderDocument(content, sampleDocumentContext(documentType));
}

/** How many characters of one problem line a draft check returns (a Handlebars parse error quotes the source around it). */
const PROBLEM_LINE_CHARS = 600;

/**
 * A draft's id: the first 12 hex characters of the SHA-256 of its source. It
 * names a draft in the conversation (the chat's card); it is not a revision
 * and is never saved.
 */
export const templateDraftId = (content: string) =>
  createHash("sha256").update(content, "utf8").digest("hex").slice(0, 12);

export type TemplateDraftCheck = {
  valid: boolean;
  problems: string[];
  draftId: string | null;
  characters: number;
};

/**
 * Checks a proposed template exactly as saving it would
 * ({@link assertValidTemplateSource}) and reports the verdict instead of
 * throwing. The source is never echoed (the caller has it; the draft id names
 * it). A refusal's message is the problem; a syntax error also carries the
 * parser's own message, which says where it failed, so a model can fix it.
 * Anything that is not a refusal of the source (an infrastructure failure) is
 * rethrown, never reported as a problem of the draft.
 */
export function checkTemplateDraft(documentType: DocumentType, content: string): TemplateDraftCheck {
  const source = content.trim();
  try {
    assertValidTemplateSource(documentType, source);
    return { valid: true, problems: [], draftId: templateDraftId(source), characters: source.length };
  } catch (error) {
    if (!(error instanceof ORPCError) || error.code !== "BAD_REQUEST") throw error;
    const cause = error.cause instanceof Error && error.cause.message !== error.message ? error.cause.message : null;
    const problems = [error.message, ...(cause ? [cause] : [])].map((line) =>
      line.length > PROBLEM_LINE_CHARS ? `${line.slice(0, PROBLEM_LINE_CHARS)}…` : line,
    );
    return { valid: false, problems, draftId: null, characters: source.length };
  }
}

/**
 * The bounds of one template preview (docs/document-system.md, "Preview
 * limits"). A preview renders source the person typed (or a saved revision)
 * against one context (the school's own data where the caller may read it,
 * the sample elsewhere: `document.preview-context.ts`), so it needs far less
 * than a generated batch, and each one is a Chromium conversion: these keep
 * a single preview small and short whatever the source does.
 *
 * - `renderChars`: the render budget (`maxOutputChars`), the Notice and
 *   Question paper template budget (2,000,000) instead of a batch's
 *   25,000,000. A catalog design renders its sample in a few kilobytes
 *   (the sample logo is 1 KB), so only a template that repeats itself
 *   massively reaches it. The Question paper preview keeps its own renderer,
 *   which already holds the template to this budget, and so does the Notice
 *   preview (`renderNoticeDocument`); both place the logo after rendering,
 *   at most three times.
 * - `imageUses`: how many times the other types' previews may print each
 *   embedded image (the school logo, a student photo) on top of
 *   `renderChars`. A real logo can be a data URI of several megabytes (an
 *   image may be 5 MB), which printed once would pass `renderChars` on its
 *   own; generation sends images as conversion assets and never counts
 *   them, so the preview budget grows by `imageUses` times the context's
 *   image characters (`contextImageChars`). A design that prints a large
 *   logo more often than this is refused in the preview, as a notice is.
 * - `timeoutMs`: how long the converter may work on one preview (a generated
 *   document gets 120 seconds, a question paper 60). Running out is refused
 *   as the template's fault ({@link PREVIEW_TIMEOUT_MESSAGE}).
 * - `pages`: how many pages one preview may print, by type, from what the
 *   sample prints. The converter is asked for one page more and a preview
 *   over the cap is refused, never cut (`ConversionPageLimit`):
 *   - report cards, ID cards, admit cards, bills, receipts and statements:
 *     the sample is one document, which the print wrapper puts on exactly one
 *     sheet (a fixed sheet with `overflow:hidden`; eight ID cards or two half
 *     documents to a sheet). 4 leaves room for a design whose own CSS lets
 *     content spill past the sheet, which then shows instead of being refused.
 *   - timetable: one landscape sheet holding the grid of every classroom of
 *     the exam (the all-classroom invariant: a timetable is never split per
 *     class), so a design may paginate a long grid over several sheets; 8.
 *   - notice: notices flow; the sample notice prints on one full page or one
 *     to two half pages (counted before two half pages are put on a sheet);
 *     6 leaves room for a tall letterhead and footer.
 *   - question paper: the example paper flows like a real one, so the cap is
 *     the paper cap itself (`QUESTION_PAPER_LIMITS.pdfPages`), which the
 *     converter applies to every question paper anyway.
 */
export const TEMPLATE_PREVIEW_LIMITS = {
  renderChars: 2_000_000,
  imageUses: 4,
  timeoutMs: 20_000,
  pages: {
    report_card: 4,
    id_card: 4,
    admit_card: 4,
    bill: 4,
    receipt: 4,
    statement: 4,
    timetable: 8,
    notice: 6,
    question_paper: QUESTION_PAPER_LIMITS.pdfPages,
  } satisfies Record<DocumentType, number>,
} as const;

/** What a preview that ran out of time says: most likely the template, possibly a busy converter. */
export const PREVIEW_TIMEOUT_MESSAGE = `The preview took longer than ${TEMPLATE_PREVIEW_LIMITS.timeoutMs / 1000} seconds to print, which is the limit. Simplify the template (fewer repeated blocks, smaller images), or try again in a moment.`;

/** What a preview over its type's page cap says. */
const previewPageLimitMessage = (pages: number) =>
  `This template prints the sample on more than ${pages} pages, which is the preview limit. Check for content that overflows the page or repeats.`;

/**
 * A template rendered for a preview, within the preview render budget
 * ({@link TEMPLATE_PREVIEW_LIMITS}), against `context`: the preview context
 * the procedures resolve for the caller (`templatePreviewRenderContext`,
 * images embedded), or the type's static sample when omitted (unit tests).
 * A Notice design is rendered as a notice is (`renderNoticeDocument`: the
 * notice budget, the logo placed at most three times) at the requested
 * notice print size (`printSize`, full when omitted) and told that size as
 * `print.size`, exactly as a plain notice of that size is printed; a
 * Question paper design gets the example paper as its body; every other type
 * uses its revision's footprint.
 */
export function previewTemplateHtml(
  content: string,
  documentType: DocumentType,
  pageSize: DocumentTemplatePageSize,
  printSize: DocumentTemplatePageSize | undefined,
  context: object = sampleDocumentContext(documentType),
) {
  if (documentType === "notice") {
    const size = printSize ?? "full";
    const notice = { ...(context as { school: { logoUrl: string | null } }), print: { size } };
    return renderNoticeDocument(content, notice, TEMPLATE_PREVIEW_LIMITS.renderChars);
  }
  // Rendered like a real paper (template budget, one body slot, logo limit),
  // with the English example paper as the body so an author sees a real page.
  if (documentType === "question_paper")
    return renderSampleQuestionPaperDocument(content, context as QuestionPaperContext);
  const budget = {
    maxOutputChars: TEMPLATE_PREVIEW_LIMITS.renderChars + TEMPLATE_PREVIEW_LIMITS.imageUses * contextImageChars(context),
  };
  // A half-A4 design prints two documents per sheet, so its preview fills the
  // sheet with two copies of the sample: one copy alone reads as a full page.
  // (ID cards keep one sample; the sheet's other slots stay empty.)
  const rendered = renderDocument(content, context, budget);
  return combineDocuments(pageSize === "half" ? [rendered, rendered] : [rendered], documentType, pageSize);
}

/**
 * The preview as the PDF it prints as: the same HTML as
 * {@link previewTemplateHtml} (with the same `context`), converted by the
 * same Gotenberg call as a generated document of the type, within the
 * preview's page cap and timeout ({@link TEMPLATE_PREVIEW_LIMITS}; running
 * out of time is a BAD_REQUEST with {@link PREVIEW_TIMEOUT_MESSAGE}, not a
 * server error), and for a half-A4 notice imposed two copies per A4 sheet
 * exactly as a published half notice is. Nothing is stored and nothing is
 * cached: the context is the school's data as the caller may read it now.
 * Every caller converts inside one of the person's conversion slots
 * (`withPreviewConversionSlot`), the marketplace's previews included.
 */
export async function previewTemplatePdf(
  content: string,
  documentType: DocumentType,
  pageSize: DocumentTemplatePageSize,
  printSize: DocumentTemplatePageSize | undefined,
  options: { context?: object; signal?: AbortSignal } = {},
): Promise<Uint8Array> {
  const html = previewTemplateHtml(content, documentType, pageSize, printSize, options.context);
  const pages = TEMPLATE_PREVIEW_LIMITS.pages[documentType];
  let converted: Uint8Array;
  try {
    converted = new Uint8Array(
      await convertDocumentPdf(html, documentType, options.signal, [], {
        // A question paper keeps the converter's own cap and message.
        ...(documentType === "question_paper" ? {} : { pageLimit: { pages, message: previewPageLimitMessage(pages) } }),
        timeoutMs: TEMPLATE_PREVIEW_LIMITS.timeoutMs,
      }),
    );
  } catch (error) {
    if (isConversionTimeout(error)) throw rpcError.badRequest(PREVIEW_TIMEOUT_MESSAGE, error);
    throw error;
  }
  return documentType === "notice" && printSize === "half" ? imposeHalfPageNoticeCopies(converted) : converted;
}

/**
 * What the in-app assistant (and any MCP client) is taught before it edits a
 * template of `documentType`: the shared rendering contract
 * (`templateRenderingContract`, the same rules the portable "Edit with AI"
 * brief carries), how a draft is proposed, and the variable reference. The
 * workflow names both callers, because the guide cannot tell them apart: in
 * the template editor's own conversation a valid draft is shown in the editor
 * (and saving tools are refused there, see the assistant's
 * `TEMPLATE_EDITOR_REFUSED_TOOLS`); an MCP client or another chat has no
 * editor, so a valid draft is only a template that would save.
 */
export function templateEditingGuide(documentType: DocumentType) {
  return {
    documentType,
    rules: templateRenderingContract({
      documentType,
      output:
        "Propose the COMPLETE final HTML/Handlebars template (never a fragment or a diff) as the content of validateDocumentTemplateDraft.",
    }),
    workflow: [
      "Edit the newest source: the latest <template_editor_source> block in the conversation (the editor's unsaved source), your own latest valid draft, else the saved template from getActiveDocumentTemplate. Change only what the user asked.",
      "Call validateDocumentTemplateDraft with the documentType and the complete template. It checks the template exactly as saving it would and changes nothing.",
      "When it is not valid, fix the problems it lists and validate again before you answer.",
      "In CampusPilot's own template editor (a conversation started there, which carries <document_template_context>), a valid draft is loaded into the editor and its PDF preview at once. Tell the user in one or two sentences what changed; they look at the preview and save it themselves with the editor's Save button. Saving tools (saveDocumentTemplate, selectMarketplaceTemplate) are refused in such a conversation.",
      "Anywhere else (another chat or an MCP client), nothing shows a draft for you: a valid check only means the template would save. Save it with saveDocumentTemplate, sending the selected revision's revisionId from getActiveDocumentTemplate as expectedRevisionId, only when the user asked for the change to be saved.",
    ],
    contextHelp: DOCUMENT_CONTEXT_HELP,
  };
}
