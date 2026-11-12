import { encodedImageBytes, MODEL_REQUEST_IMAGE_BUDGET_BYTES } from '@campuspilot/assistant-contract/attachments';

import { isAttachmentMarker, type AttachmentMarker } from '../transcript';
import type { AttachmentFile, ModelProvider, ToolInputStubInput, TranscriptEntry } from './providers/types';

/**
 * The model's context for one request, built from the stored transcript
 * (design G2/G3, decisions D41/D45). It is a view for the model only: the
 * stored transcript, the items and the UI are never changed.
 *
 * - Attachment markers become the provider's image parts, newest first within
 *   an image byte budget, with a short note for anything that cannot be shown.
 * - Entries before the last two human messages are shortened: tool results
 *   that are long become a one-line stub, and every attachment becomes a note
 *   that keeps its id but says the image is no longer visible (the model may
 *   still embed it by id; it asks the user to attach it again only to look).
 *   Long text fields of old tool CALL inputs (the whole paper a model wrote
 *   into `validateQuestionPaperDraft` or `saveQuestionPaperVersion`) become a
 *   one-line stub too: every revision of a long paper would otherwise stay in
 *   the context in full for the rest of the chat. Cheap chats are the point;
 *   so is keeping the cache prefix stable: the cut moves only when a new human
 *   message arrives.
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
/**
 * A long text field of an old tool call input (about 1,000 tokens) is stubbed. Lower than
 * the result threshold on purpose: an input is the model's own words, which it can always re-send.
 */
export const CONTEXT_TOOL_INPUT_MIN_CHARS = 4_000;
/** Image bytes, as sent (base64), one chat request may carry; shared with the question paper job. */
export const CONTEXT_IMAGE_BUDGET_BYTES = MODEL_REQUEST_IMAGE_BUDGET_BYTES;

export type ModelContextOptions = {
  fullHumanMessages?: number;
  toolResultMinChars?: number;
  toolInputMinChars?: number;
  imageBudgetBytes?: number;
};

export type ModelContextDeps = {
  /** The bytes of an attachment the provider can read, or why not. */
  loadAttachment(attachmentId: string, readableMimeTypes: readonly string[]): Promise<AttachmentFile>;
};

/** The note that replaces a long tool result in an old entry. */
export const toolResultStub = ({ toolName, chars }: { toolName: string; chars: number }) =>
  `[Earlier result of ${toolName} omitted to keep the chat short (${chars.toLocaleString('en-US')} characters). Call the tool again if you need it.]`;

/**
 * The note that replaces a long text field of an old tool call input. The stored
 * transcript keeps the text (a draft id is the hash of it and saving resolves the id from
 * the stored call), so the stub points the model at what still works: the draft id in
 * that call's result, `getQuestionPaper` for a saved paper, or writing the paper again.
 * Only the field name and length are named, so the stub is stable and shorter than the threshold.
 */
export const toolInputStub = ({ toolName, field, chars }: ToolInputStubInput) =>
  `[Earlier \`${field}\` of ${toolName} omitted to keep the chat short (${chars.toLocaleString('en-US')} characters). The result of that call still names it (for a paper draft, its draftId). To change it, load the paper again with getQuestionPaper or write the whole paper again.]`;

/**
 * Replaces each top-level string field of a tool call input that has at least
 * `minChars` characters by the stub. Returns the same object when nothing is
 * long, and leaves non-string and nested values alone (the large inputs are
 * flat text fields such as `html`). A stub is far shorter than any threshold a
 * caller uses, so stubbing twice equals stubbing once.
 */
export function stubLongInputFields(
  toolName: string,
  input: unknown,
  stub: (input: ToolInputStubInput) => string,
  minChars: number,
): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input;
  const entries = Object.entries(input);
  if (!entries.some(([, value]) => typeof value === 'string' && value.length >= minChars)) return input;
  return Object.fromEntries(
    entries.map(([field, value]) =>
      typeof value === 'string' && value.length >= minChars ? [field, stub({ toolName, field, chars: value.length })] : [field, value],
    ),
  );
}

/**
 * Server-generated and sanitised facts only: the id (`asat_...`), the sanitised
 * file name (brackets and line breaks removed so it cannot close or split the
 * line) and the content type. No user free text ever reaches this line.
 */
const describe = (marker: AttachmentMarker) =>
  `${marker.attachmentId}: ${marker.fileName.replace(/[[\]\r\n]/g, '_')}, ${marker.contentType}`;

/** Tells the model what an attachment id is for, once per note. */
const FIGURE_HINT = 'Use this id as data-figure-id on an <img> to put the image in a question paper.';

/**
 * The text that stands in for an attachment that is not shown as an image.
 * Every note keeps the attachment's id: an id stays valid for figures while the
 * attachment exists server-side for this user, even when its pixels are not
 * shown any more.
 */
export function attachmentNote(marker: AttachmentMarker, kind: Exclude<AttachmentFile['kind'], 'image'> | 'old'): string {
  const head = `[Attachment ${describe(marker)}`;
  switch (kind) {
    case 'old':
      return `${head} - the image content is no longer visible to you (it was shown earlier). ${FIGURE_HINT} Ask the user to attach it again only if you need to look at it.]`;
    case 'unreadable':
      return `${head} - in a format this assistant cannot read. Ask the user to convert it to JPEG and attach it again.]`;
    case 'omitted':
      return `${head} - left out because the images in this chat are too large to show at once. ${FIGURE_HINT} Ask the user to attach it again if you need to look at it.]`;
    case 'missing':
      return `${head} - no longer available. Ask the user to attach it again if you need to look at it.]`;
  }
}

/** The line that precedes an image: its id for figure nodes, name and type, and its place among the message's images. */
export const attachmentLabel = (marker: AttachmentMarker) =>
  `[Attachment ${describe(marker)} (${marker.ordinal} of ${marker.total}). ${FIGURE_HINT}]`;

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
  provider: Pick<ModelProvider, 'context' | 'imageMimeTypes' | 'maxImageBytes'>,
  deps: ModelContextDeps,
  options: ModelContextOptions = {},
): Promise<TranscriptEntry[]> {
  const minChars = options.toolResultMinChars ?? CONTEXT_TOOL_RESULT_MIN_CHARS;
  const inputMinChars = options.toolInputMinChars ?? CONTEXT_TOOL_INPUT_MIN_CHARS;
  const boundary = fullContextBoundary(entries, provider, options.fullHumanMessages);
  const toolNames = provider.context.toolNamesByUseId(entries);

  // Newest first, so when the image budget runs out it is the older pages that are left out.
  let remaining = options.imageBudgetBytes ?? CONTEXT_IMAGE_BUDGET_BYTES;
  const files = new Map<string, AttachmentFile>();
  for (let index = entries.length - 1; index >= boundary; index -= 1) {
    for (const marker of markersOf(entries[index]!).reverse()) {
      const loaded = await deps.loadAttachment(marker.attachmentId, provider.imageMimeTypes);
      if (loaded.kind === 'image' && provider.maxImageBytes !== undefined && loaded.bytes.byteLength > provider.maxImageBytes) {
        // One image over the provider's own cap would fail every request of the run: say so instead.
        files.set(marker.attachmentId, { kind: 'unreadable' });
        continue;
      }
      const cost = loaded.kind === 'image' ? encodedImageBytes(loaded.bytes.byteLength) : 0;
      if (cost > remaining) {
        files.set(marker.attachmentId, { kind: 'omitted' });
        continue;
      }
      remaining -= cost;
      files.set(marker.attachmentId, loaded);
    }
  }

  return entries.map((entry, index) => {
    const old = index < boundary;
    const shortened = old
      ? provider.context.stubToolInputs(provider.context.stubToolResults(entry, toolNames, toolResultStub, minChars), toolInputStub, inputMinChars)
      : entry;
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
