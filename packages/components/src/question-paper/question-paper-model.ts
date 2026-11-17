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
  warningCount: number;
  activeJob: { status: 'queued' | 'running' } | null;
  lastJobFailure: { message: string } | null;
} | null;

export type CellStatusKind = 'empty' | 'pages' | 'generating' | 'failed' | 'ready' | 'warning';
export type CellStatus = {
  kind: CellStatusKind;
  label: string;
  /** A second line (the safe failure message), if there is one. */
  detail?: string;
};

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The status of one subject and mode, in order of what needs attention:
 * a running job, then a failed one, then the saved paper (with notices about what was removed),
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
    return paper.warningCount > 0
      ? { kind: 'warning', label: `Version ${paper.latestVersionNo} · ${plural(paper.warningCount, 'notice')}` }
      : { kind: 'ready', label: `Version ${paper.latestVersionNo}` };
  }
  if (paper.pageCount > 0) return { kind: 'pages', label: plural(paper.pageCount, 'page') };
  return { kind: 'empty', label: 'No paper yet' };
}

/** Who wrote a version (the API's `source`, the `question_paper_version_source` enum). */
export type QuestionPaperVersionSource = 'ai_job' | 'agent' | 'copy';

/** Who wrote a version, for people: "AI from photos", "Assistant chat" or "Copied from an earlier paper". */
export function versionSourceLabel(source: QuestionPaperVersionSource): string {
  switch (source) {
    case 'ai_job':
      return 'AI from photos';
    case 'agent':
      return 'Assistant chat';
    case 'copy':
      return 'Copied from an earlier paper';
    default: {
      // Exhaustive: a new source must get its own label here.
      const unknown: never = source;
      return unknown;
    }
  }
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

/**
 * The parts of a `listQuestionPapers` class the Question paper tab's filter,
 * accordion and summary read. Structural, so the API's response and the
 * table's view types both fit.
 */
export type PaperListClass = {
  classId: string;
  className: string;
  subjects: ReadonlyArray<{
    subjectSlug: string;
    subjectName: string;
    modes: ReadonlyArray<{ modeSlug: string; modeName: string; paper: PaperCellInput }>;
  }>;
};

/** One choice of the mode filter: the slug is what is stored, the name what is shown. */
export type PaperModeOption = { slug: string; name: string };

/**
 * Every distinct assessment mode of the loaded classes, keyed by slug, for
 * the mode filter. A slug keeps the first name it is seen with (a mode is
 * configured once per session, so its name is the same everywhere). Sorted
 * by name, then slug, so the order never depends on which class or subject
 * comes first.
 */
export function paperModeOptions(classes: readonly PaperListClass[]): PaperModeOption[] {
  const names = new Map<string, string>();
  for (const classView of classes) {
    for (const subject of classView.subjects) {
      for (const mode of subject.modes) {
        if (!names.has(mode.modeSlug)) names.set(mode.modeSlug, mode.modeName);
      }
    }
  }
  return [...names]
    .map(([slug, name]) => ({ slug, name }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.slug.localeCompare(right.slug));
}

/**
 * The stored selection as the filter shows it: the stored slugs that are
 * modes of this examination, in the options' order. A stored slug the
 * examination does not have is left out here and nowhere else (see
 * `mergeModeSelection`), so it still applies on another examination that has it.
 */
export function visibleModeSelection(stored: readonly string[], options: readonly PaperModeOption[]): string[] {
  const chosen = new Set(stored);
  return options.filter((option) => chosen.has(option.slug)).map((option) => option.slug);
}

/**
 * The selection to store after the person changed what the filter shows:
 * the stored slugs this examination does not have (kept untouched, in their
 * order) followed by the new visible choice. Clearing the filter therefore
 * clears only this examination's modes.
 */
export function mergeModeSelection(
  stored: readonly string[],
  options: readonly PaperModeOption[],
  nextVisible: readonly string[],
): string[] {
  const known = new Set(options.map((option) => option.slug));
  const kept = stored.filter((slug) => !known.has(slug));
  const next = nextVisible.filter((slug) => known.has(slug));
  return [...kept, ...new Set(next)];
}

/**
 * Why a class shows no rows, as its own fact: `no-subjects` (its plan has
 * none) and `no-matching-modes` (the mode filter hid every row) read
 * differently, so an empty filtered class never looks empty by plan.
 */
export type PaperClassEmptyReason = 'no-subjects' | 'no-matching-modes' | null;

/**
 * The classes with only the rows of the selected modes. An empty selection
 * shows every mode. A subject left with no rows is dropped; a class is never
 * dropped (it keeps its place in the accordion) and says why it is empty.
 * `selected` is the visible selection (`visibleModeSelection`).
 */
export function applyModeFilter<C extends PaperListClass>(
  classes: readonly C[],
  selected: readonly string[],
): Array<C & { emptyReason: PaperClassEmptyReason }> {
  const chosen = new Set(selected);
  return classes.map((classView) => {
    const hasRows = classView.subjects.some((subject) => subject.modes.length > 0);
    const subjects =
      chosen.size === 0
        ? classView.subjects
        : classView.subjects
            .map((subject) => ({ ...subject, modes: subject.modes.filter((mode) => chosen.has(mode.modeSlug)) }))
            .filter((subject) => subject.modes.length > 0);
    const shown = subjects.some((subject) => subject.modes.length > 0);
    const emptyReason: PaperClassEmptyReason = !hasRows ? 'no-subjects' : shown ? null : 'no-matching-modes';
    return { ...classView, subjects, emptyReason } as C & { emptyReason: PaperClassEmptyReason };
  });
}

/** What a class's accordion trigger says about its papers, counted from the rows it shows. */
export type PaperClassSummary = {
  /** Rows (subject and mode) shown. */
  total: number;
  /** Rows whose paper has a saved version (with or without notices). */
  ready: number;
  /** Rows with a queued or running generation. */
  generating: number;
  /** Rows whose last generation failed (and none is running). */
  failed: number;
};

/**
 * Counts a class's shown rows by `cellStatus`, so the trigger and the table
 * never disagree. The caller passes the filtered class, so the summary
 * describes what opening the class shows.
 */
export function paperClassSummary(classView: PaperListClass): PaperClassSummary {
  const summary: PaperClassSummary = { total: 0, ready: 0, generating: 0, failed: 0 };
  for (const subject of classView.subjects) {
    for (const mode of subject.modes) {
      const kind = cellStatus(mode.paper).kind;
      summary.total += 1;
      if (kind === 'ready' || kind === 'warning') summary.ready += 1;
      if (kind === 'generating') summary.generating += 1;
      if (kind === 'failed') summary.failed += 1;
    }
  }
  return summary;
}

/** The summary in words: "3 of 8 ready", then the generating and failed counts when there are any. */
export function paperClassSummaryLabel(summary: PaperClassSummary): string {
  const parts = [`${summary.ready} of ${summary.total} ready`];
  if (summary.generating > 0) parts.push(`${summary.generating} generating`);
  if (summary.failed > 0) parts.push(`${summary.failed} failed`);
  return parts.join(' · ');
}

/**
 * The class the `class` query parameter opens: the id when it names a class
 * of the list, otherwise null (no parameter, a class the person may not open,
 * a stale link). An unknown id opens nothing and is not an error.
 */
export function openClassOf(param: string | null | undefined, classes: readonly { classId: string }[]): string | null {
  if (!param) return null;
  return classes.some((classView) => classView.classId === param) ? param : null;
}
