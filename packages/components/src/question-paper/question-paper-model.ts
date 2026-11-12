/**
 * Pure rules of the Question paper screen: what a grid cell says, which files
 * may be uploaded, how a drag moves pages, and how job states read. Nothing
 * here touches the DOM or the API, so the rules are unit tested directly.
 */

/** Pages (photos) one paper may hold. Mirrors `QUESTION_PAPER_MAX_PAGES` on the server. */
export const QUESTION_PAPER_MAX_PAGES = 20;
/** The largest accepted photo, 15 MiB. Mirrors `QUESTION_PAPER_MAX_PAGE_BYTES` on the server (D24). */
export const QUESTION_PAPER_MAX_PAGE_BYTES = 15 * 1024 * 1024;
/**
 * The file picker filter. Extensions are listed as well as MIME types because
 * browsers report an empty or generic type for `.heic` files.
 */
export const QUESTION_PAPER_UPLOAD_ACCEPT =
  'image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']);
const HEIF_EXTENSIONS = new Set(['heic', 'heif']);
const HEIF_TYPES = new Set(['image/heic', 'image/heif']);

/** The parts of a `File` the rules read, so tests need no DOM. */
export type UploadFileInfo = { name: string; type: string; size: number };

function extensionOf(name: string) {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Whether the file is HEIC/HEIF, by media type or, when the browser sent none, by extension. */
export function isHeifFile(file: UploadFileInfo) {
  return HEIF_TYPES.has(file.type.toLowerCase()) || HEIF_EXTENSIONS.has(extensionOf(file.name));
}

/** Whether the file looks like a photo this screen accepts (the server checks the bytes again). */
export function isAcceptedImage(file: UploadFileInfo) {
  const type = file.type.toLowerCase();
  if (IMAGE_TYPES.has(type)) return true;
  // Browsers send an empty or generic type for HEIC; the extension then decides.
  return (type === '' || type === 'application/octet-stream') && IMAGE_EXTENSIONS.has(extensionOf(file.name));
}

export type UploadRejection = { name: string; reason: string };
export type UploadPlan<F extends UploadFileInfo> = { accepted: F[]; rejected: UploadRejection[] };

/**
 * Splits chosen files into those to upload and those refused with a reason:
 * not a photo type, larger than 15 MiB, or beyond the free page slots
 * (`remaining`, already net of files still uploading). Files keep the order
 * they were chosen in.
 */
export function planUploads<F extends UploadFileInfo>(files: readonly F[], remaining: number): UploadPlan<F> {
  const accepted: F[] = [];
  const rejected: UploadRejection[] = [];
  for (const file of files) {
    if (!isAcceptedImage(file)) {
      rejected.push({ name: file.name, reason: 'Choose a JPEG, PNG, WebP or HEIC photo.' });
    } else if (file.size > QUESTION_PAPER_MAX_PAGE_BYTES) {
      rejected.push({ name: file.name, reason: 'The photo is larger than 15 MB.' });
    } else if (file.size === 0) {
      rejected.push({ name: file.name, reason: 'The file is empty.' });
    } else if (accepted.length >= Math.max(0, remaining)) {
      rejected.push({
        name: file.name,
        reason: `A paper holds at most ${QUESTION_PAPER_MAX_PAGES} pages.`,
      });
    } else {
      accepted.push(file);
    }
  }
  return { accepted, rejected };
}

/** What `getQuestionPaperDetail` and `listQuestionPapers` say about one paper's job state. */
export type PaperCellInput = {
  pageCount: number;
  latestVersionNo: number;
  /** No longer produced by the API (nothing adds up a paper's marks); the UI phase removes it. */
  totalMarks?: number | null;
  planMaxMarks: number | null;
  warningCount: number;
  activeJob: { status: 'queued' | 'running' } | null;
  lastJobFailure: { message: string } | null;
} | null;

export type CellStatusKind = 'empty' | 'pages' | 'generating' | 'failed' | 'ready' | 'warning';
export type CellStatus = {
  kind: CellStatusKind;
  label: string;
  /** A second line (marks, the safe failure message), if there is one. */
  detail?: string;
};

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

/** Marks as people write them: `15`, `7.5`, never `15.000`. */
export function formatMarks(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

/**
 * The status of one subject and mode, in order of what needs attention:
 * a running job, then a failed one, then the saved paper (with warnings),
 * then uploaded pages, then nothing.
 */
export function cellStatus(paper: PaperCellInput): CellStatus {
  if (!paper) return { kind: 'empty', label: 'No paper yet' };
  if (paper.activeJob) {
    return { kind: 'generating', label: paper.activeJob.status === 'queued' ? 'Queued' : 'Generating' };
  }
  if (paper.lastJobFailure) {
    return { kind: 'failed', label: 'Generation failed', detail: paper.lastJobFailure.message };
  }
  if (paper.latestVersionNo > 0) {
    const marks =
      paper.totalMarks == null
        ? undefined
        : paper.planMaxMarks === null
          ? `${formatMarks(paper.totalMarks)} marks`
          : `${formatMarks(paper.totalMarks)} of ${paper.planMaxMarks} marks`;
    return paper.warningCount > 0
      ? { kind: 'warning', label: `Version ${paper.latestVersionNo} · ${plural(paper.warningCount, 'warning')}`, detail: marks }
      : { kind: 'ready', label: `Version ${paper.latestVersionNo}`, detail: marks };
  }
  if (paper.pageCount > 0) return { kind: 'pages', label: plural(paper.pageCount, 'page') };
  return { kind: 'empty', label: 'No paper yet' };
}

/** "AI from photos" or "Assistant chat": who wrote a version. */
export function versionSourceLabel(source: 'ai_job' | 'agent') {
  return source === 'ai_job' ? 'AI from photos' : 'Assistant chat';
}

/** The first line of a generation panel: what the background job is doing. */
export function generationStatusLabel(status: 'queued' | 'running' | 'failed') {
  switch (status) {
    case 'queued':
      return 'Waiting to start';
    case 'running':
      return 'Reading your photos and writing the paper';
    case 'failed':
      return 'Generation failed';
  }
}

/**
 * The page ids after dragging `activeId` onto `overId`, or null when nothing
 * moves (dropped on itself, or an id is unknown). The caller sends the result
 * to the server with the revision it last saw.
 */
export function movePageId(ids: readonly string[], activeId: string, overId: string): string[] | null {
  if (activeId === overId) return null;
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0) return null;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, activeId);
  return next;
}

/** The facts that make a paper read-only; each is its own field of the paper (they differ in what the user can do about them). */
export type PaperLockFacts = { examCompleted: boolean; sessionActive: boolean };

/** Whether the paper cannot be changed, whatever the user's permissions. */
export const isPaperLocked = (facts: PaperLockFacts) => facts.examCompleted || !facts.sessionActive;

/** Why a paper is read-only, in a sentence, or null when it is not. An ended exam is named first. */
export function paperLockReason(facts: PaperLockFacts): string | null {
  if (facts.examCompleted) return 'This examination has ended, so its question papers can no longer be changed.';
  if (!facts.sessionActive) return 'This examination belongs to an academic session that is not the active one, so its question papers can no longer be changed.';
  return null;
}

/** Whether a mutation of pages, generation or deletion is currently possible, and if not, why. */
export function editBlockedReason(input: PaperLockFacts & {
  canManage: boolean;
  jobActive: boolean;
}): string | null {
  const locked = paperLockReason(input);
  if (locked) return locked;
  if (!input.canManage) return 'You can view this paper but not change it.';
  if (input.jobActive) return 'The paper is being generated. You can change it once that finishes.';
  return null;
}

/** Why Generate with AI is unavailable, or null when it is available. First reason wins. */
export function generateBlockedReason(input: {
  pageCount: number;
  templateConfigured: boolean;
  blockedReason: string | null;
  /** Photos still being prepared or uploaded: a job started now would read only the ones already stored. */
  uploading?: boolean;
}): string | null {
  if (input.blockedReason) return input.blockedReason;
  if (input.uploading) return 'Wait for the photos to finish uploading.';
  if (input.pageCount < 1) return 'Upload at least one photo first.';
  if (!input.templateConfigured) return 'Choose a question paper template before generating papers.';
  return null;
}

/** Human size of an original photo (`2.4 MB`). */
export function formatPageSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Number((bytes / (1024 * 1024)).toFixed(1))} MB`;
}

/**
 * Screen reader announcements for dragging a page, in terms of page numbers and
 * file names (dnd-kit would otherwise read out the opaque page ids).
 */
export function pageDragAnnouncements(pages: ReadonlyArray<{ id: string; position: number; originalName: string }>) {
  const name = (id: string | number) => {
    const page = pages.find((candidate) => candidate.id === String(id));
    return page ? `page ${page.position}, ${page.originalName}` : 'a page';
  };
  const target = (id: string | number) => {
    const page = pages.find((candidate) => candidate.id === String(id));
    return page ? `position ${page.position}` : 'its place';
  };
  return {
    onDragStart: ({ active }: { active: { id: string | number } }) => `Picked up ${name(active.id)}.`,
    onDragOver: ({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) =>
      over ? `${name(active.id)} is over ${target(over.id)}.` : `${name(active.id)} is not over a position.`,
    onDragEnd: ({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) =>
      over ? `Dropped ${name(active.id)} at ${target(over.id)}.` : `Dropped ${name(active.id)}. The order is unchanged.`,
    onDragCancel: ({ active }: { active: { id: string | number } }) => `Moving ${name(active.id)} was cancelled. The order is unchanged.`,
  };
}

/** Instructions read when the drag handle takes focus. */
export const PAGE_DRAG_INSTRUCTIONS =
  'Press space to pick up this page, use the arrow keys to move it, and press space again to drop it. Press escape to cancel.';
