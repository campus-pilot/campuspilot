import { isAttachmentMarker, type AttachmentMarker } from '../transcript';
import type { AttachmentFile, ModelProvider, TranscriptEntry } from './providers/types';

/**
 * The model's context for one request, built from the stored transcript
 * (design G2/G3, decisions D41/D45). It is a view for the model only: the
 * stored transcript, the items and the UI are never changed.
 *
 * - Attachment markers become the provider's image parts, newest first within
 *   an image byte budget, with a short note for anything that cannot be shown.
 * - Entries before the last two human messages are shortened: tool results
 *   that are long become a one-line stub, and every attachment becomes a note
 *   telling the model to ask the user to attach it again (it cannot look at it
 *   any more). Cheap chats are the point; so is keeping the cache prefix
 *   stable: the cut moves only when a new human message arrives.
 *
 * Properties the tests pin: the number and order of entries never change; no
 * tool call or its id is touched, so every call keeps its result (Anthropic
 * `tool_use`/`tool_result`, Gemini `functionCall`/`functionResponse`); the
 * output depends only on stored data (tool name, length, file name, type), so
 * the same transcript gives byte-identical context and pruning twice equals
 * pruning once.
 *
 * Imports only provider types: the turn loop may not reach school tables or
 * API code (see boundary.test.ts). Loading an attachment's bytes is injected.
 */

/** How many of the newest human messages are shown to the model in full. */
export const CONTEXT_FULL_HUMAN_MESSAGES = 2;
/** Tool results of at least this many characters (about 2,000 tokens) are stubbed once old. */
export const CONTEXT_TOOL_RESULT_MIN_CHARS = 8_000;
/** Image bytes one request may carry; providers cap requests at 20-32 MB. */
export const CONTEXT_IMAGE_BUDGET_BYTES = 18 * 1024 * 1024;

export type ModelContextOptions = {
  fullHumanMessages?: number;
  toolResultMinChars?: number;
  imageBudgetBytes?: number;
};

export type ModelContextDeps = {
  /** The bytes of an attachment the provider can read, or why not. */
  loadAttachment(attachmentId: string, readableMimeTypes: readonly string[]): Promise<AttachmentFile>;
};

/** The note that replaces a long tool result in an old entry. */
export const toolResultStub = ({ toolName, chars }: { toolName: string; chars: number }) =>
  `[Earlier result of ${toolName} omitted to keep the chat short (${chars.toLocaleString('en-US')} characters). Call the tool again if you need it.]`;

const label = (marker: AttachmentMarker) =>
  `Attachment ${marker.ordinal} of ${marker.total}: ${marker.fileName}`;

/** The text that stands in for an attachment that is not shown as an image. */
export function attachmentNote(marker: AttachmentMarker, kind: Exclude<AttachmentFile['kind'], 'image'> | 'old'): string {
  const name = `"${marker.fileName}"`;
  switch (kind) {
    case 'old':
      return `[Attachment ${name} (${marker.contentType}) was shown earlier and can no longer be read. Ask the user to attach it again if you need to look at it.]`;
    case 'unreadable':
      return `[Attachment ${name} (${marker.contentType}) is in a format this assistant cannot read. Ask the user to convert it to JPEG and attach it again.]`;
    case 'omitted':
      return `[Attachment ${name} was left out because the images in this chat are too large to show at once. Ask the user to attach it again if you need to look at it.]`;
    case 'missing':
      return `[Attachment ${name} is no longer available. Ask the user to attach it again if you need to look at it.]`;
  }
}

/** The label that precedes an image so the model can tell pages apart. */
export const attachmentLabel = label;

/** Index of the first entry of the oldest human message that is still shown in full (0 when there are fewer). */
export function fullContextBoundary(
  entries: readonly TranscriptEntry[],
  provider: Pick<ModelProvider, 'context'>,
  fullHumanMessages = CONTEXT_FULL_HUMAN_MESSAGES,
): number {
  let seen = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index]!.role === 'user' && provider.context.isHumanTurn(entries[index]!)) {
      seen += 1;
      if (seen === fullHumanMessages) return index;
    }
  }
  return 0;
}

const markersOf = (entry: TranscriptEntry): AttachmentMarker[] => entry.content.filter(isAttachmentMarker);

/**
 * Builds the context for one model request. Pure apart from `loadAttachment`;
 * entries are copied, never mutated.
 */
export async function buildModelContext(
  entries: readonly TranscriptEntry[],
  provider: Pick<ModelProvider, 'context' | 'imageMimeTypes'>,
  deps: ModelContextDeps,
  options: ModelContextOptions = {},
): Promise<TranscriptEntry[]> {
  const minChars = options.toolResultMinChars ?? CONTEXT_TOOL_RESULT_MIN_CHARS;
  const boundary = fullContextBoundary(entries, provider, options.fullHumanMessages);
  const toolNames = provider.context.toolNamesByUseId(entries);

  // Newest first, so when the image budget runs out it is the older pages that are left out.
  let remaining = options.imageBudgetBytes ?? CONTEXT_IMAGE_BUDGET_BYTES;
  const files = new Map<string, AttachmentFile>();
  for (let index = entries.length - 1; index >= boundary; index -= 1) {
    for (const marker of markersOf(entries[index]!).reverse()) {
      const loaded = await deps.loadAttachment(marker.attachmentId, provider.imageMimeTypes);
      if (loaded.kind === 'image' && loaded.bytes.byteLength > remaining) {
        files.set(marker.attachmentId, { kind: 'omitted' });
        continue;
      }
      if (loaded.kind === 'image') remaining -= loaded.bytes.byteLength;
      files.set(marker.attachmentId, loaded);
    }
  }

  return entries.map((entry, index) => {
    const old = index < boundary;
    const shortened = old ? provider.context.stubToolResults(entry, toolNames, toolResultStub, minChars) : entry;
    if (!shortened.content.some(isAttachmentMarker)) return shortened;
    const content = shortened.content.flatMap((block) => {
      if (!isAttachmentMarker(block)) return [block];
      return old
        ? provider.context.stubAttachment(block)
        : provider.context.materializeAttachment(block, files.get(block.attachmentId) ?? { kind: 'missing' });
    });
    return { ...shortened, content };
  });
}
