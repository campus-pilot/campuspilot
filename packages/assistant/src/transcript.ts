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
 * never the image. Transcripts stay small and provider-independent; each
 * model request turns the markers into the provider's image parts
 * (`runtime/context.ts`), or into a short text note once the image is old.
 */
export type AttachmentMarker = {
  type: 'campuspilot_attachment';
  attachmentId: string;
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
  return `<question_paper_context>\nexam: ${seed.examSlug}; class: ${seed.classId}; subject: ${seed.subjectSlug}; mode: ${seed.modeSlug}; session: ${seed.sessionId}.\nThe user is working on this question paper. Read it with the getQuestionPaper tool.\n</question_paper_context>`;
}

/**
 * A user message as blocks, in order: the page the user was on (context, not
 * part of what they asked), the screen a seeded conversation started from,
 * one marker per attached image, then the text (omitted when the user sent
 * only images: providers reject empty text blocks).
 */
export function buildUserTranscriptContent(body: AssistantUserMessageBody): unknown[] {
  const blocks: unknown[] = [];
  if (body.pageContext) {
    const lines = [`Path: ${body.pageContext.path}`];
    if (body.pageContext.title) lines.push(`Title: ${body.pageContext.title}`);
    blocks.push({
      type: 'text',
      text: `<current_page>\n${lines.join('\n')}\n</current_page>`,
    });
  }
  if (body.seed) blocks.push({ type: 'text', text: seedText(body.seed) });
  const attachments = body.attachments ?? [];
  attachments.forEach((attachment, index) => {
    blocks.push({
      type: 'campuspilot_attachment',
      attachmentId: attachment.id,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      ordinal: index + 1,
      total: attachments.length,
    } satisfies AttachmentMarker);
  });
  if (body.text.length > 0) blocks.push({ type: 'text', text: body.text });
  return blocks;
}
