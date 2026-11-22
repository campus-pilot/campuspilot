import type { AssistantAttachmentKind } from '@campuspilot/assistant-contract/attachments';
import type { AssistantUserMessageBody } from '@campuspilot/db/schema/assistant';

/**
 * Stable keys for everything a run creates. Restate may retry a step after
 * it partly ran; inserting by these keys makes every retry a no-op instead of
 * a duplicate message, tool call or transcript entry.
 */
export const userMessageItemKey = (runId: string) => `${runId}:user`;
export const assistantMessageItemKey = (runId: string, step: number) =>
  `${runId}:model:${step}`;
export const toolCallItemKey = (runId: string, toolUseId: string) =>
  `${runId}:tool:${toolUseId}`;

export const userTranscriptKey = (runId: string) => `${runId}:user`;
export const modelTranscriptKey = (runId: string, step: number) =>
  `${runId}:model:${step}`;
export const toolResultsTranscriptKey = (runId: string, step: number) =>
  `${runId}:tools:${step}`;
/** Closes a tool loop the run abandoned (stop or failure) so history stays valid. */
export const interruptedTranscriptKey = (runId: string) => `${runId}:interrupted`;

/**
 * Where an attachment sits in a stored user turn: a provider-neutral marker,
 * never the file. Transcripts stay small and provider-independent; each
 * model request turns the markers into the provider's image or document parts
 * (`runtime/context.ts`), or into a short text note once the file is old.
 */
export type AttachmentMarker = {
  type: 'campuspilot_attachment';
  attachmentId: string;
  /** Image or document, copied from the attachment's reference (the notes and labels differ per kind). */
  kind: AssistantAttachmentKind;
  fileName: string;
  contentType: string;
  /** 1-based position within its message. */
  ordinal: number;
  total: number;
};

export const isAttachmentMarker = (block: unknown): block is AttachmentMarker =>
  typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'campuspilot_attachment';

/**
 * The model's view of the screen a conversation was started from. The seed
 * names the paper by its natural key only; permission is decided by the tools
 * the model then calls.
 */
function seedText(seed: NonNullable<AssistantUserMessageBody['seed']>): string {
  if (seed.kind === 'standalone_question_paper') {
    return `<question_paper_context>\nstandalone paper: ${seed.paperId}.\nThe user is working on this question paper of their personal space. Read it with the getStandalonePaper tool.\n</question_paper_context>`;
  }
  return `<question_paper_context>\nexam: ${seed.examSlug}; class: ${seed.classId}; subject: ${seed.subjectSlug}; mode: ${seed.modeSlug}; session: ${seed.sessionId}.\nThe user is working on this question paper. Read it with the getQuestionPaper tool.\n</question_paper_context>`;
}

/** The line that introduces the page's text inside a `<current_page>` block. */
const PAGE_TEXT_INTRO =
  'The page’s text (all of it, above and below the user’s view too; top to bottom, cells of a row joined by " | "; the part on their screen now is framed by marker lines; it may be cut where it says so):';
const PAGE_FENCE = '"""';
const PAGE_BLOCK_END = '</current_page>';
/** An opening or closing tag of the page block, however it is spaced or cased. */
const PAGE_TAG = /<\s*\/?\s*current_page\s*>/gi;

/**
 * The page's text made safe to stand inside its fence. Every tag of the block
 * is removed until none is left (removing one can join the two halves of
 * another, as in `</current_</current_page>page>`), and only then the fence
 * itself is taken out, so no removal can put either back together.
 */
function fencedPageText(text: string): string {
  return withoutPageTags(text).replaceAll(PAGE_FENCE, "'''");
}

/** `text` with every tag of the page block removed, until none is left. */
function withoutPageTags(text: string): string {
  let safe = text;
  for (;;) {
    const next = safe.replace(PAGE_TAG, '');
    if (next === safe) return safe;
    safe = next;
  }
}

/**
 * A page's path or title as one line of the block. A title is the browser
 * tab's, which holds a record's name (a student's, a notice's): it must not
 * end the block or start a line of its own any more than the page's text may.
 */
const pageLine = (value: string) => withoutPageTags(value).replace(/\s+/g, ' ').trim();

/**
 * A user message as blocks, in order: the page the user was on (context, not
 * part of what they asked), the screen a seeded conversation started from,
 * one marker per attached file, then the text (omitted when the user sent
 * only files: providers reject empty text blocks).
 */
export function buildUserTranscriptContent(body: AssistantUserMessageBody): unknown[] {
  const blocks: unknown[] = [];
  if (body.pageContext) {
    const lines = [`Path: ${pageLine(body.pageContext.path)}`];
    const title = body.pageContext.title ? pageLine(body.pageContext.title) : '';
    if (title) lines.push(`Title: ${title}`);
    // The screen's text is data, like a tool result; it is fenced so a line in it cannot pass for the end of the block.
    if (body.pageContext.pageText) {
      lines.push(PAGE_TEXT_INTRO, PAGE_FENCE, fencedPageText(body.pageContext.pageText), PAGE_FENCE);
    }
    blocks.push({
      type: 'text',
      text: `<current_page>\n${lines.join('\n')}\n${PAGE_BLOCK_END}`,
    });
  }
  if (body.seed) blocks.push({ type: 'text', text: seedText(body.seed) });
  const attachments = body.attachments ?? [];
  attachments.forEach((attachment, index) => {
    blocks.push({
      type: 'campuspilot_attachment',
      attachmentId: attachment.id,
      kind: attachment.kind,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      ordinal: index + 1,
      total: attachments.length,
    } satisfies AttachmentMarker);
  });
  if (body.text.length > 0) blocks.push({ type: 'text', text: body.text });
  return blocks;
}
