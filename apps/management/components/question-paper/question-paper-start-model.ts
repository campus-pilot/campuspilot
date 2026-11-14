import { QUESTION_PAPER_GENERATION_INSTRUCTIONS_MAX_CHARS } from '@campuspilot/api/routers/school/question-paper/question-paper.dto';
import type { AssistantAttachmentRef } from '@campuspilot/assistant-contract/attachments';
import { attachmentKindOfFile } from '@campuspilot/components/assistant/assistant-attachments-model';
import type { UploadFileInfo, UploadRejection } from '@campuspilot/components/question-paper/question-paper-model';

/**
 * The pure rules of the paper's first screen: what the tray holds, what a
 * picked file becomes, and what Create does. Nothing here touches the DOM or
 * the API (`question-paper-start.tsx` does).
 *
 * A paper is made from ONE source, with an optional note:
 * - photos of its pages (stored on the paper, read by the generation job),
 * - one PDF (sent to the paper's assistant as the PDF itself),
 * - an earlier paper of the same class and subject (copied, no AI),
 * - or nothing but the note, which is then a description the assistant writes
 *   the paper from.
 * Photos are the default: they are what the tray shows unless a PDF or an
 * earlier paper was chosen. Choosing one of those does not delete photos
 * already on the paper; they are simply not used.
 */

/** The earlier paper chosen to be copied, with what its row needs to say. */
export type EarlierPaper = {
  /** The earlier paper's own natural key (its school, session, exam, class, subject and mode). */
  key: { schoolId: string; sessionId: string; examSlug: string; classId: string; subjectSlug: string; modeSlug: string };
  versionNo: number;
  examName: string;
  sessionLabel: string;
  modeName: string;
  savedAt: Date;
  /** The maximum marks the earlier paper was written for (its plan's, as saved with the version); null when unknown. */
  planMaxMarks: number | null;
};

/** The PDF chosen, from the pick until it is sent with the first message. */
export type PdfSource = {
  fileName: string;
  byteSize: number;
  status: 'uploading' | 'ready' | 'failed';
  /** The stored attachment, once uploaded: what the first message carries. */
  attachment: AssistantAttachmentRef | null;
  /** Why the upload failed, when it did. */
  error: string | null;
};

/** What the paper will be made from, other than photos. Null means photos (or only the note). */
export type AlternativeSource = { kind: 'pdf'; pdf: PdfSource } | { kind: 'earlier'; earlier: EarlierPaper } | null;

/** The note may be a full description of a paper, so it is allowed to be long, but it stays a note. */
export const START_NOTE_MAX_LENGTH = 4000;

/** What files may be picked: photos and PDFs. The server decides again from the bytes. */
export const START_SOURCE_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf,.pdf';

export const WORD_FILE_REASON = "Word files can't be added. Save it as a PDF, then add the PDF.";
export const REFUSED_TYPE_REASON = "This file can't be added. Add photos of the pages, or a PDF.";
/** Why a file that is neither a photo nor a PDF is turned away, in words that say what to do next. */
export const refusedTypeReason = (file: Pick<UploadFileInfo, 'name'>) => (/\.(docx?|rtf|odt)$/i.test(file.name) ? WORD_FILE_REASON : REFUSED_TYPE_REASON);
export const MIXED_SOURCE_REASON = 'A paper is made from photos or from one PDF, not both.';

/** A pick sorted into what it adds: photos for the paper, or the one PDF, and what was turned away with the reason. */
export type SourcePicks<F extends UploadFileInfo> = { photos: F[]; pdf: F | null; refused: UploadRejection[] };

/**
 * Sorts picked files. Photos and a PDF never mix: with photos on the paper (or
 * in the same pick) a PDF is refused, and while a PDF or an earlier paper is
 * the source, photos are refused, each with a sentence that says what to do.
 * Only one PDF is taken. Whether a photo is acceptable (type, size, free
 * slots) is the upload queue's own check (`planUploads`).
 */
export function sortSourcePicks<F extends UploadFileInfo>(
  files: readonly F[],
  state: { alternative: AlternativeSource; photoCount: number },
): SourcePicks<F> {
  const picks: SourcePicks<F> = { photos: [], pdf: null, refused: [] };
  const refuse = (file: F, reason: string) => picks.refused.push({ name: file.name, reason });
  const images = files.filter((file) => attachmentKindOfFile(file) === 'image');
  const havePhotos = state.photoCount > 0 || images.length > 0;
  for (const file of files) {
    const kind = attachmentKindOfFile(file);
    if (kind === null) refuse(file, refusedTypeReason(file));
    else if (kind === 'image') {
      if (state.alternative === null) picks.photos.push(file);
      else refuse(file, state.alternative.kind === 'pdf' ? 'Remove the PDF to use photos instead.' : 'Remove the earlier paper to use photos instead.');
    } else if (state.alternative?.kind === 'pdf' || picks.pdf) refuse(file, 'Only one PDF can be used. Remove the first one to use another.');
    else if (state.alternative?.kind === 'earlier') refuse(file, 'Remove the earlier paper to use a PDF instead.');
    else if (havePhotos) refuse(file, `${MIXED_SOURCE_REASON} Remove the photos to use the PDF.`);
    else picks.pdf = file;
  }
  return picks;
}

/** The first message of the paper's conversation when it starts from a description. */
export const describedPaperMessage = (description: string) => `Write this question paper from my description:\n\n${description.trim()}`;

/** The first message of the paper's conversation when it starts from a PDF, with the user's note when there is one. */
export function pdfPaperMessage(fileName: string, note: string): string {
  const base = `Create this question paper from the attached PDF "${fileName}".`;
  return note
    ? `${base} Keep everything my instructions do not mention as it is in the PDF.\n\nMy instructions:\n${note}`
    : `${base} Keep every question, its numbering and its marks as written; do not add or remove questions.`;
}

/** What Create does with what is in the card. */
export type CreatePlan =
  /** Photos: the generation job reads them, with the note as the teacher's instructions. */
  | { kind: 'generate'; instructions: string | null }
  /** An earlier paper: copied as a new version; a note is then the first thing asked of the assistant. */
  | { kind: 'copy'; earlier: EarlierPaper; followUp: string | null }
  /** A PDF or a description: the first message of the paper's conversation. */
  | { kind: 'assistant'; message: string; attachments: AssistantAttachmentRef[] }
  /** Nothing to create from yet, or something is not ready. `reason` is written beside the button; null when the card is simply empty. */
  | { kind: 'blocked'; reason: string | null };

/**
 * What Create does. Every fact is passed in on its own: the chosen
 * alternative, the stored photos, the photos still uploading and the note.
 */
export function createPlanOf(input: { alternative: AlternativeSource; pageCount: number; uploading: boolean; note: string }): CreatePlan {
  const note = input.note.trim();
  if (note.length > START_NOTE_MAX_LENGTH) return { kind: 'blocked', reason: `Keep the note under ${START_NOTE_MAX_LENGTH} characters.` };
  const { alternative } = input;
  if (alternative?.kind === 'earlier') return { kind: 'copy', earlier: alternative.earlier, followUp: note || null };
  if (alternative?.kind === 'pdf') {
    const { pdf } = alternative;
    if (pdf.status === 'uploading') return { kind: 'blocked', reason: 'The PDF is still uploading.' };
    if (pdf.status === 'failed' || !pdf.attachment) return { kind: 'blocked', reason: 'Remove the PDF that could not be uploaded.' };
    return { kind: 'assistant', message: pdfPaperMessage(pdf.fileName, note), attachments: [pdf.attachment] };
  }
  if (input.uploading) return { kind: 'blocked', reason: 'The photos are still uploading.' };
  if (input.pageCount > 0) {
    // The job takes a shorter note than a description may be: it says what to change, the photos are the paper.
    if (note.length > QUESTION_PAPER_GENERATION_INSTRUCTIONS_MAX_CHARS) {
      return { kind: 'blocked', reason: `Keep the instructions under ${QUESTION_PAPER_GENERATION_INSTRUCTIONS_MAX_CHARS.toLocaleString('en-IN')} characters.` };
    }
    return { kind: 'generate', instructions: note || null };
  }
  if (note) return { kind: 'assistant', message: describedPaperMessage(note), attachments: [] };
  return { kind: 'blocked', reason: null };
}

/**
 * What to say when the earlier paper was written for other marks than this
 * one: a copy is the old paper as it is, so an 80-mark paper would land in a
 * 20-mark exam unnoticed. Null when the marks agree or are not known.
 */
export function marksMismatchOf(earlier: EarlierPaper, planMaxMarks: number): string | null {
  if (earlier.planMaxMarks === null || earlier.planMaxMarks === planMaxMarks) return null;
  return `That paper is for ${earlier.planMaxMarks} marks and this one is for ${planMaxMarks}. It is copied as it is unless you say in the instructions what to keep.`;
}

/**
 * The note's words. With a source it is an optional instruction; alone it is
 * the description of the paper. The label stays visible while the user types;
 * the placeholder is an example of what one writes there, short enough for
 * one line on a phone. `marksDiffer`: the earlier paper chosen was written
 * for other marks, so the example is about that.
 */
export function noteWordsOf(input: { alternative: AlternativeSource; hasPhotos: boolean; marksDiffer?: boolean }): { label: string; placeholder: string } {
  if (input.alternative === null && !input.hasPhotos) {
    return { label: 'Or describe the paper', placeholder: 'For example: chapters 4 to 6, grammar' };
  }
  return { label: 'Instructions (optional)', placeholder: input.marksDiffer ? 'For example: keep section A only' : 'For example: change the numbers' };
}
