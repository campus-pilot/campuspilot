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
 * A user message as text blocks; the page the user was on is a
 * separate, labelled block: it is context, not part of what they asked.
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
  blocks.push({ type: 'text', text: body.text });
  return blocks;
}
