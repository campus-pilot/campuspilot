import { createHash } from "node:crypto";

import { ORPCError } from "@orpc/server";
import {
  TEMPLATE_DOCUMENT_TYPES,
  templateRenderingContract,
  type TemplateDocumentType,
} from "@campuspilot/assistant-contract/template-editing";

import {
  assertValidSchoolNoticeTemplate,
  imposeHalfPageNoticeCopies,
} from "../notice/notice.render";
import {
  assertValidSchoolQuestionPaperTemplate,
  renderSampleQuestionPaperDocument,
} from "../question-paper/question-paper.render";
import {
  DOCUMENT_CONTEXT_HELP,
  sampleDocumentContext,
  SAMPLE_NOTICE_CONTEXT,
} from "./document.catalog";
import type { DocumentTemplatePageSize, DocumentType } from "./document.dto";
import { combineDocuments, convertDocumentPdf, renderDocument } from "./document.render";

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
 * A template rendered with synthetic data for a preview. A Notice design is
 * laid out at the requested notice print size (`printSize`, full when
 * omitted) and told that size as `print.size`, exactly as a plain notice of
 * that size is printed; every other type uses its revision's footprint.
 */
export function previewTemplateHtml(
  content: string,
  documentType: DocumentType,
  pageSize: DocumentTemplatePageSize,
  printSize: DocumentTemplatePageSize | undefined,
) {
  if (documentType === "notice") {
    const size = printSize ?? "full";
    return combineDocuments([renderDocument(content, { ...SAMPLE_NOTICE_CONTEXT, print: { size } })], "notice", size);
  }
  // Rendered like a real paper (template budget, one body slot, logo limit),
  // with the English example paper as the body so an author sees a real page.
  if (documentType === "question_paper") return renderSampleQuestionPaperDocument(content);
  return combineDocuments([renderDocument(content, sampleDocumentContext(documentType))], documentType, pageSize);
}

/**
 * The preview as the PDF it prints as: the same HTML as
 * {@link previewTemplateHtml}, converted by the same Gotenberg call as a
 * generated document of the type, and for a half-A4 notice imposed two copies
 * per A4 sheet exactly as a published half notice is. Nothing is stored.
 */
export async function previewTemplatePdf(
  content: string,
  documentType: DocumentType,
  pageSize: DocumentTemplatePageSize,
  printSize: DocumentTemplatePageSize | undefined,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const html = previewTemplateHtml(content, documentType, pageSize, printSize);
  const converted = new Uint8Array(await convertDocumentPdf(html, documentType, signal));
  return documentType === "notice" && printSize === "half" ? imposeHalfPageNoticeCopies(converted) : converted;
}

/**
 * Marketplace designs already converted, by type, slug and notice print size.
 * See {@link previewMarketplaceTemplatePdf}.
 */
const marketplacePdfs = new Map<string, Promise<Uint8Array>>();

/**
 * A marketplace design as the PDF it prints as, with the same synthetic data
 * and conversion as {@link previewTemplatePdf}. The catalog ships with the
 * code and the sample data is fixed, so a design converts to the same PDF for
 * the life of the process: each design (and each print size of a Notice
 * design) is converted once, however many people preview it, and the map is
 * bounded by the catalog. A conversion in flight is shared and a failed one
 * is forgotten, so the next preview tries again. The caller's abort signal is
 * therefore not passed on: someone else may be waiting for the same
 * conversion, and a finished one is kept for the next.
 */
export function previewMarketplaceTemplatePdf(
  design: { slug: string; documentType: DocumentType; pageSize: DocumentTemplatePageSize; content: string },
  printSize: DocumentTemplatePageSize | undefined,
): Promise<Uint8Array> {
  // Only a Notice design is previewed at a print size (full when not asked).
  const size = design.documentType === "notice" ? (printSize ?? "full") : undefined;
  const key = `${design.documentType}:${design.slug}:${size ?? design.pageSize}`;
  const held = marketplacePdfs.get(key);
  if (held) return held;
  const converting = previewTemplatePdf(design.content, design.documentType, design.pageSize, size);
  marketplacePdfs.set(key, converting);
  converting.catch(() => marketplacePdfs.delete(key));
  return converting;
}

/**
 * What the in-app assistant (and any MCP client) is taught before it edits a
 * template of `documentType`: the shared rendering contract
 * (`templateRenderingContract`, the same rules the portable "Edit with AI"
 * brief carries), how a draft reaches the editor, and the variable reference.
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
      "When it is valid, the template editor loads it into the editor and its PDF preview at once. Tell the user in one or two sentences what changed; they look at the preview and save it themselves with the editor's Save button.",
      "Never save the template yourself with saveDocumentTemplate or selectMarketplaceTemplate from the template editor's chat.",
    ],
    contextHelp: DOCUMENT_CONTEXT_HELP,
  };
}
