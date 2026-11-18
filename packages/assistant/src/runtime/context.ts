import { encodedImageBytes, MODEL_REQUEST_ATTACHMENT_BUDGET_BYTES } from '@campuspilot/assistant-contract/attachments';

import { isAttachmentMarker, type AttachmentMarker } from '../transcript';
import type { ReadableMimeTypes } from './providers/image-types';
import type { AttachmentFile, ModelProvider, TranscriptEntry } from './providers/types';

/**
 * The model's context for one request, built from the stored transcript. It
 * is a view for the model only: the stored transcript, the items and the UI
 * are never changed.
 *
 * Nothing the model was given is taken away later in the conversation: every
 * tool result and tool call input stays in full, and so does the page a
 * message was sent from. A conversation shared with a question paper also
 * shows the paper's photographed pages before its first message, on every
 * request, so the model can always check the paper against them. Attachment
 * markers become the provider's image or document parts, newest first within
 * one byte budget shared with the page photos (the providers' request limit),
 * with a short note for anything that cannot be shown.
 *
 * Properties the tests pin: the number and order of entries never change; no
 * tool call or its id is touched; the output depends only on stored data and
 * the loaded files, so the same transcript gives byte-identical context.
 *
 * Imports only provider types: the turn loop may not reach school tables or
 * API code (see boundary.test.ts). Loading an attachment's bytes is injected.
 */

/** Attachment bytes (images and PDFs), as sent (base64), one chat request may carry; shared with the question paper job. */
export const CONTEXT_ATTACHMENT_BUDGET_BYTES = MODEL_REQUEST_ATTACHMENT_BUDGET_BYTES;

export type ModelContextOptions = {
  attachmentBudgetBytes?: number;
};

export type ModelContextDeps = {
  /** The bytes of an attachment the provider can read (per kind), or why not. */
  loadAttachment(attachmentId: string, readable: ReadableMimeTypes): Promise<AttachmentFile>;
  /**
   * The photographed pages of the question paper the conversation is shared
   * with, in order (none for any other conversation). They are shown before
   * the conversation's first message on every request.
   */
  loadPaperPages?(): Promise<PaperPagePhoto[]>;
};

/** One photographed page of a question paper, as the generation job read it (its model copy). */
export type PaperPagePhoto = { pageId: string; position: number; total: number; mimeType: string; bytes: Uint8Array };

/**
 * The line before a page photo. The page id is a server id (`qpg_...`), never
 * user text. A page is not a figure: a save refuses its id as `data-figure-id`.
 */
export const paperPageLabel = (page: Pick<PaperPagePhoto, 'pageId' | 'position' | 'total'>) =>
  `[Page ${page.position} of ${page.total} of this question paper as photographed (${page.pageId}). The paper was typed up from these photos: read them to check the paper or to redo a part of it. A page photo is not a figure: its id cannot be used as data-figure-id.]`;

/** The note for a page photo that cannot be shown. */
export const paperPageNote = (page: Pick<PaperPagePhoto, 'pageId' | 'position' | 'total'>, reason: 'unreadable' | 'omitted') =>
  reason === 'omitted'
    ? `[Page ${page.position} of ${page.total} of this question paper as photographed (${page.pageId}) - left out because the photos in this chat are too large to show at once.]`
    : `[Page ${page.position} of ${page.total} of this question paper as photographed (${page.pageId}) - in a format this assistant cannot read.]`;

/**
 * Server-generated and sanitised facts only: the id (`asat_...`), the sanitised
 * file name (brackets and line breaks removed so it cannot close or split the
 * line) and the content type. No user free text ever reaches this line.
 */
const describe = (marker: AttachmentMarker) =>
  `${marker.attachmentId}: ${marker.fileName.replace(/[[\]\r\n]/g, '_')}, ${marker.contentType}`;

/** Tells the model what an image attachment id is for, once per note. */
const FIGURE_HINT = 'Use this id as data-figure-id on an <img> to put the image in a question paper.';
/**
 * Tells the model what a document is for, once per note: source material to
 * read, never a figure (a save refuses a document id as `data-figure-id`).
 */
const DOCUMENT_HINT = 'It is a PDF document: read it as source material. It is not an image and cannot be used as data-figure-id.';

/** Why an attachment is shown as a note instead of its content. */
export type AttachmentNoteReason = Exclude<AttachmentFile['kind'], 'image' | 'document'>;

function imageNote(head: string, reason: AttachmentNoteReason): string {
  switch (reason) {
    case 'unreadable':
      return `${head} - in a format this assistant cannot read. Ask the user to convert it to JPEG and attach it again.]`;
    case 'omitted':
      return `${head} - left out because the images in this chat are too large to show at once. ${FIGURE_HINT} Ask the user to attach it again if you need to look at it.]`;
    case 'missing':
      return `${head} - no longer available. Ask the user to attach it again if you need to look at it.]`;
  }
}

function documentNote(head: string, reason: AttachmentNoteReason): string {
  switch (reason) {
    case 'unreadable':
      return `${head} - a document this assistant cannot read. Ask the user to attach photos of its pages instead.]`;
    case 'omitted':
      return `${head} - left out because the attachments in this chat are too large to show at once. ${DOCUMENT_HINT} Ask the user to attach it again if you need to read it.]`;
    case 'missing':
      return `${head} - no longer available. Ask the user to attach it again if you need to read it.]`;
  }
}

/**
 * The text that stands in for an attachment whose content cannot be shown.
 * Every note keeps the attachment's id: an image id stays valid for figures
 * while the attachment exists server-side for this user; a document note says
 * it is not a figure.
 */
export function attachmentNote(marker: AttachmentMarker, reason: AttachmentNoteReason): string {
  const head = `[Attachment ${describe(marker)}`;
  return marker.kind === 'document' ? documentNote(head, reason) : imageNote(head, reason);
}

/**
 * The line that precedes an attachment's content: its id, name and type, its
 * place among the message's attachments, and what the id is for (a figure for
 * an image; nothing but reading for a document). The image line is unchanged
 * from before documents existed, so a cached prompt prefix stays valid.
 */
export const attachmentLabel = (marker: AttachmentMarker) =>
  `[Attachment ${describe(marker)} (${marker.ordinal} of ${marker.total}). ${marker.kind === 'document' ? DOCUMENT_HINT : FIGURE_HINT}]`;

const markersOf = (entry: TranscriptEntry): AttachmentMarker[] => entry.content.filter(isAttachmentMarker);

/** The context for one request, and how many PDFs it shows the model (a refused request is then explained as a PDF problem). */
export type ModelContext = { entries: TranscriptEntry[]; documentsShown: number };

/**
 * Builds the context for one model request (see {@link buildModelContextWithStats}).
 */
export async function buildModelContext(
  entries: readonly TranscriptEntry[],
  provider: Pick<ModelProvider, 'context' | 'imageMimeTypes' | 'documentMimeTypes' | 'maxImageBytes'>,
  deps: ModelContextDeps,
  options: ModelContextOptions = {},
): Promise<TranscriptEntry[]> {
  return (await buildModelContextWithStats(entries, provider, deps, options)).entries;
}

/**
 * Builds the context for one model request. Pure apart from `loadAttachment`;
 * entries are copied, never mutated. Images and documents share one byte
 * budget, newest first; a file whose loaded kind is not the kind its marker
 * names (which cannot happen while rows keep their kind) is shown as
 * unreadable rather than sent as something it is not.
 */
export async function buildModelContextWithStats(
  entries: readonly TranscriptEntry[],
  provider: Pick<ModelProvider, 'context' | 'imageMimeTypes' | 'documentMimeTypes' | 'maxImageBytes'>,
  deps: ModelContextDeps,
  options: ModelContextOptions = {},
): Promise<ModelContext> {
  const readable: ReadableMimeTypes = { image: provider.imageMimeTypes, document: provider.documentMimeTypes };
  let remaining = options.attachmentBudgetBytes ?? CONTEXT_ATTACHMENT_BUDGET_BYTES;

  // The paper's own photos come first: they are what every question in the chat is about.
  const pageParts: unknown[] = [];
  for (const page of (await deps.loadPaperPages?.()) ?? []) {
    const image = provider.maxImageBytes !== undefined && page.bytes.byteLength > provider.maxImageBytes ? null : provider.context.image(page);
    const cost = encodedImageBytes(page.bytes.byteLength);
    if (image === null) pageParts.push(provider.context.text(paperPageNote(page, 'unreadable')));
    else if (cost > remaining) pageParts.push(provider.context.text(paperPageNote(page, 'omitted')));
    else {
      remaining -= cost;
      pageParts.push(provider.context.text(paperPageLabel(page)), image);
    }
  }

  // Newest first, so when the budget runs out it is the older pages and files that are left out.
  let documentsShown = 0;
  const files = new Map<string, AttachmentFile>();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    for (const marker of markersOf(entries[index]!).reverse()) {
      const loaded = await deps.loadAttachment(marker.attachmentId, readable);
      const carried = loaded.kind === 'image' || loaded.kind === 'document';
      if (carried && loaded.kind !== marker.kind) {
        files.set(marker.attachmentId, { kind: 'unreadable' });
        continue;
      }
      if (loaded.kind === 'image' && provider.maxImageBytes !== undefined && loaded.bytes.byteLength > provider.maxImageBytes) {
        // One image over the provider's own cap would fail every request of the run: say so instead.
        files.set(marker.attachmentId, { kind: 'unreadable' });
        continue;
      }
      const cost = carried ? encodedImageBytes(loaded.bytes.byteLength) : 0;
      if (cost > remaining) {
        files.set(marker.attachmentId, { kind: 'omitted' });
        continue;
      }
      remaining -= cost;
      if (loaded.kind === 'document') documentsShown += 1;
      files.set(marker.attachmentId, loaded);
    }
  }

  const firstUser = entries.findIndex((entry) => entry.role === 'user');
  const built = entries.map((entry, index) => {
    const pages = index === firstUser ? pageParts : [];
    if (!entry.content.some(isAttachmentMarker) && pages.length === 0) return entry;
    const content = entry.content.flatMap((block) =>
      isAttachmentMarker(block) ? provider.context.materializeAttachment(block, files.get(block.attachmentId) ?? { kind: 'missing' }) : [block],
    );
    return { ...entry, content: [...pages, ...content] };
  });
  return { entries: built, documentsShown };
}
