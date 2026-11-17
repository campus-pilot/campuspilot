import { CLASS_ACTIONS, type PermissionCheck } from '@campuspilot/api/routers/authorization/authorization.dto';
import type { pageDtoSchema } from '@campuspilot/api/routers/school/question-paper/question-paper.dto';
import type { z } from 'zod';
import type { ExamScope } from '@/components/exam/exam-model';
import type { QueryClient, QueryKey } from '@tanstack/react-query';

/** One paper: an exam, a class, a subject and an assessment mode of its plan. */
export type QuestionPaperScope = ExamScope & { classId: string; subjectSlug: string; modeSlug: string };

/**
 * How the first screen was asked for in the address (`?start=`): `sources`
 * shows it for a paper that already has versions (to add photos or a file
 * as a new version), `earlier` shows it with the earlier-paper picker open.
 */
export const QUESTION_PAPER_STARTS = ['sources', 'earlier'] as const;
export type QuestionPaperStart = (typeof QUESTION_PAPER_STARTS)[number];

/**
 * What the paper's screen shows.
 * - `start`: the first screen, where the paper is made (`picking`: its
 *   earlier-paper picker is open).
 * - `studio`: the paper beside its assistant.
 */
export type QuestionPaperView = { kind: 'start'; picking: boolean } | { kind: 'studio' };

/** Class-scoped permission, exactly as the procedures check it. */
export function questionPaperPermission(
  scope: QuestionPaperScope,
  kind: 'read' | 'manage',
): PermissionCheck {
  return {
    action: kind === 'read' ? CLASS_ACTIONS.READ_EXAM_QUESTION_PAPERS : CLASS_ACTIONS.MANAGE_EXAM_QUESTION_PAPERS,
    resource: { kind: 'class', schoolId: scope.schoolId, classId: scope.classId },
  };
}

/**
 * The view to show. The first screen named in the URL wins (the user asked
 * for it, also for a paper that already has versions: adding photos, copying
 * again). Otherwise the studio, when there is something in it: a saved
 * version, a generation at work, or a conversation with the assistant.
 * Otherwise the first screen: a paper with photos but nothing else returns
 * to its photos, so a visit continues where the last one stopped (and a
 * failed generation is read beside the photos it used).
 *
 * Each input is its own fact: none is inferred from another.
 */
export function resolveView(facts: {
  start: string | null | undefined;
  hasVersion: boolean;
  generating: boolean;
  hasChat: boolean;
}): QuestionPaperView {
  const start = QUESTION_PAPER_STARTS.find((candidate) => candidate === facts.start);
  if (start) return { kind: 'start', picking: start === 'earlier' };
  if (facts.hasVersion || facts.generating || facts.hasChat) return { kind: 'studio' };
  return { kind: 'start', picking: false };
}

/** A conversation id as the address may carry it: the assistant's own ids only, so nothing else reaches a request. */
export const chatIdOf = (raw: string | null | undefined): string | null => (raw && /^asc_[a-z0-9]{8,40}$/.test(raw) ? raw : null);

/** `?chat=new`: the user started a new conversation, which begins with their first message. */
export const NEW_CHAT_PARAM = 'new';

/**
 * The paper's conversation on screen. The address decides when it names one
 * (`?chat=<id>`) or asks for a new one (`?chat=new`); otherwise it is the
 * paper's latest conversation, so whoever opens the paper, and whoever comes
 * back to it, continues where the paper's work stands. Null: no conversation
 * yet (the first message starts one).
 */
export function paperChatOf(raw: string | null | undefined, latestConversationId: string | null): string | null {
  if (raw === NEW_CHAT_PARAM) return null;
  return chatIdOf(raw) ?? latestConversationId;
}

/**
 * Whether the paper has a studio to go back to from its first screen: a
 * version, a generation at work, the conversation on screen, or any
 * conversation shared with the paper (after New chat on a paper with no
 * version the screen is the first one, and Back must still reach the chat).
 */
export const hasStudioOf = (facts: { hasVersion: boolean; generating: boolean; chatId: string | null; latestConversationId: string | null }) =>
  facts.hasVersion || facts.generating || facts.chatId !== null || facts.latestConversationId !== null;

/**
 * Whether an unsaved draft is still the newest thing about the paper: it was
 * written after every saved version (both are server times). A version made
 * since, by the photo job or in another conversation, is newer, and the
 * paper's side shows it instead (the draft stays in its chat).
 */
export const draftIsNewest = (writtenAt: Date, versions: readonly { createdAt: Date }[]) => versions.every((version) => writtenAt > version.createdAt);

/** What the paper's side of the studio shows. */
export type ShownPaper = { kind: 'draft' } | { kind: 'version'; versionNo: number } | { kind: 'nothing' };

/**
 * What the paper's side shows: a version named in the address; else the
 * assistant's unsaved draft when there is one (it is the newest thing); else
 * the latest version. Nothing only while a first paper is still being made.
 * A version the address names that does not exist falls back to the latest.
 */
export function shownPaperOf(versionParam: string | null | undefined, versionNos: readonly number[], hasDraft: boolean): ShownPaper {
  const named = versionParam !== null && versionParam !== undefined;
  if (hasDraft && !named) return { kind: 'draft' };
  const versionNo = resolveVersionNo(versionParam, versionNos);
  if (versionNo !== null) return { kind: 'version', versionNo };
  return hasDraft ? { kind: 'draft' } : { kind: 'nothing' };
}

/** `?compare=1`: the user asked to see the paper beside its photographed pages. Anything else is off. */
export const compareAsked = (raw: string | null | undefined): boolean => raw === '1';

/**
 * Whether the paper can be shown beside its photos: it has photographed
 * pages, and there is a paper on screen to read against them (a version or
 * the assistant's draft). The toggle exists only then, and an address that
 * asks for the comparison on a paper without either shows the paper alone.
 */
export const canCompareOf = (facts: { pageCount: number; shown: ShownPaper }): boolean => facts.pageCount > 0 && facts.shown.kind !== 'nothing';

/**
 * Whether the assistant is folded into its strip on wide screens. While the
 * paper is compared with its photos the two documents need the width, so the
 * assistant is folded unless the user opened it again during the comparison;
 * otherwise it is as the user left it. The two are separate facts, so ending
 * the comparison shows the assistant as it was before, with nothing to restore.
 */
export const assistantCollapsedOf = (facts: { comparing: boolean; collapsed: boolean; shownWhileComparing: boolean }): boolean =>
  facts.comparing ? !facts.shownWhileComparing : facts.collapsed;

/**
 * The position (from 0) of the photo the comparison shows: the page the user
 * stepped to while it is still one of the paper's pages, else the first (no
 * page chosen yet, or the chosen one was removed since). -1 when the paper has
 * no pages.
 */
export function comparePageIndex(pageIds: readonly string[], pageId: string | null): number {
  if (pageIds.length === 0) return -1;
  const index = pageId === null ? -1 : pageIds.indexOf(pageId);
  return index === -1 ? 0 : index;
}

/** How much larger than the pane's width a zoomed photo is drawn: enough to read handwriting. */
export const PHOTO_ZOOM = 2;

type Point = { x: number; y: number };

/**
 * Where a scrolling pane must be scrolled to after its content grew or shrank
 * by `factor`, so that the point under `pointer` (measured from the pane's
 * visible top left corner) stays under it: zooming into a word keeps that
 * word where it was pressed. The browser clamps the result to what can be
 * scrolled, so zooming out lands on the whole page.
 */
export function scrollAfterZoom(scroll: Point, pointer: Point, factor: number): Point {
  return { x: (scroll.x + pointer.x) * factor - pointer.x, y: (scroll.y + pointer.y) * factor - pointer.y };
}

/** The version to show: the one in the URL when it exists, otherwise the latest; null when there is none. */
export function resolveVersionNo(raw: string | null | undefined, versionNos: readonly number[]): number | null {
  const requested = raw === null || raw === undefined ? NaN : Number(raw);
  if (Number.isInteger(requested) && versionNos.includes(requested)) return requested;
  return versionNos.length === 0 ? null : Math.max(...versionNos);
}

/** How often the detail is read again: every 3 seconds while a generation is queued or running, otherwise never. */
export const GENERATION_POLL_MS = 3000;
export function detailPollInterval(
  data: { activeJob: unknown; pages: readonly { uploadStatus: 'awaiting' | 'stored'; derivativeStatus: string }[] } | undefined,
): number | false {
  if (!data) return false;
  if (pagesProcessing(data.pages)) return PAGE_PROCESSING_POLL_MS;
  return data.activeJob ? GENERATION_POLL_MS : false;
}

type PageOrder = { id: string; position: number };

/**
 * The pages as they will be once the server applies `pageIds`: reordered and
 * renumbered from 1. Pages missing from the list keep their relative order at
 * the end, so a stale list never drops a page from the screen.
 */
export function applyPageOrder<P extends PageOrder>(pages: readonly P[], pageIds: readonly string[]): P[] {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const listed = pageIds.flatMap((id) => {
    const page = byId.get(id);
    return page ? [page] : [];
  });
  const rest = pages.filter((page) => !pageIds.includes(page.id));
  return [...listed, ...rest].map((page, index) => ({ ...page, position: index + 1 }));
}

/** Clockwise quarter turns of a page on top of its photo's own orientation (0, 90, 180 or 270). */
export type PageRotation = z.infer<typeof pageDtoSchema>['rotation'];

/**
 * The rotation a page has after one more quarter turn: Rotate right adds 90
 * degrees clockwise, Rotate left takes 90 away, wrapping around a full turn.
 * The result is what the screen sends (`rotateQuestionPaperPage` takes the
 * rotation the page should have, checked against the page revision).
 */
export function turnedRotation(rotation: PageRotation, turn: 'left' | 'right'): PageRotation {
  return ((rotation + (turn === 'right' ? 90 : 270)) % 360) as PageRotation;
}

/** The user-facing text of a failed request, with the server's own message when it has one. */
export function requestErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Whether the server refused because the pages changed since the screen loaded them. */
export function isConflict(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code: unknown }).code === 'CONFLICT');
}

/** Photos sent at the same time. Their pages are reserved in order first, so the order they finish in does not matter. */
export const PAGE_UPLOAD_CONCURRENCY = 3;

/**
 * Runs `worker` over `items` with at most `limit` running at once, starting
 * them in order; resolves when every one has settled. `worker` handles its
 * own failures (a rejected worker does not stop the others).
 */
export async function runWithConcurrency<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const next = async (): Promise<void> => {
    const item = queue.shift();
    if (item === undefined) return;
    await worker(item).catch(() => undefined);
    return next();
  };
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, next));
}

/**
 * The in-flight job as the shared components take it. The API types a job's
 * status with all four values; `activeJob` only ever holds a queued or running
 * one, and anything else is treated as no job.
 */
export function inFlightJob(job: { status: 'queued' | 'running' | 'succeeded' | 'failed' } | null | undefined) {
  return job && (job.status === 'queued' || job.status === 'running') ? { status: job.status } : null;
}

/** How many photos are still being prepared or uploaded; a failed one waits for the user and does not count. */
export const uploadsInFlight = (items: readonly { status: 'converting' | 'uploading' | 'error' }[]) =>
  items.filter((item) => item.status !== 'error').length;

/**
 * Photos on their way that hold no reserved page yet. A reserved one is
 * already one of the paper's pages (`pageCount` counts it), so only these are
 * added to it when counting the paper's photos.
 */
export const unreservedUploads = (items: readonly { status: 'converting' | 'uploading' | 'error'; pageId?: string }[]) =>
  items.filter((item) => item.status !== 'error' && item.pageId === undefined).length;

/** The pages that are stored but whose copies the worker has not made yet; the screen polls until there are none. */
export const pagesProcessing = (pages: readonly { uploadStatus: 'awaiting' | 'stored'; derivativeStatus: string }[]) =>
  pages.some((page) => page.uploadStatus === 'stored' && page.derivativeStatus === 'pending');

/** How often the paper is read while photos are processed: a copy takes well under a second. */
export const PAGE_PROCESSING_POLL_MS = 1000;

/**
 * Puts a stored page into the cached paper, where its reservation already
 * stands. A read of the paper already in flight (the processing poll) is
 * cancelled first: it was answered before this photo was stored, and landing
 * after this patch it would put the page back to `awaiting`.
 */
export async function patchStoredPage<Page extends { id: string }>(queryClient: QueryClient, queryKey: QueryKey, page: Page) {
  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData<{ pages: Page[] }>(queryKey, (detail) =>
    detail ? { ...detail, pages: detail.pages.map((current) => (current.id === page.id ? page : current)) } : detail,
  );
}

/**
 * Gives back the page of a photo whose upload failed, and says whether the
 * photo is in fact stored. The release answers CONFLICT only when the page
 * already has its photo: the store committed and only its answer was lost (a
 * dropped connection), so the photo must not be reported as missing. Any other
 * failure leaves the page to the server's sweep.
 */
export async function releaseFailedUpload(release: () => Promise<unknown>): Promise<'released' | 'stored'> {
  try {
    await release();
  } catch (error) {
    if (isConflict(error)) return 'stored';
  }
  return 'released';
}

/** What the page preview says when it cannot show a page's photo: only a photo the server stored but could not decode (HEIC) may still be read by the AI. */
export function pagePreviewFallback(page: { uploadStatus: 'awaiting' | 'stored'; derivativeStatus: string }) {
  if (page.uploadStatus === 'awaiting') return 'This photo has not arrived. Remove the page and add the photo again.';
  if (page.derivativeStatus === 'failed') return 'This photo could not be read. Remove the page and add the photo again.';
  return 'This photo cannot be shown here. The AI can still read it.';
}

/**
 * Why the page viewer offers no turn for a page, or null when it can be
 * turned. Only a page whose copies exist (`ready`) can be: the server makes
 * them again from the uploaded photo and refuses every other page. A page
 * still uploading or still being prepared can be turned once the poll sees
 * it ready.
 */
export function pageTurnBlockedReason(page: { uploadStatus: 'awaiting' | 'stored'; derivativeStatus: string }): string | null {
  if (page.uploadStatus === 'awaiting') return 'This photo is still uploading.';
  if (page.derivativeStatus === 'pending') return 'This photo is still being prepared.';
  if (page.derivativeStatus === 'failed') return 'This photo could not be read.';
  if (page.derivativeStatus !== 'ready') return "This photo's format cannot be turned.";
  return null;
}

/**
 * Why the paper's pages cannot be used yet, or null: a page whose photo is
 * still awaited (a reservation another tab left, or one still uploading), one
 * the worker is still processing, or one it could not read. Mirrors the
 * server's refusal, so the button explains itself before it is pressed.
 */
export function pagesNotReadyReason(pages: readonly { position: number; uploadStatus: 'awaiting' | 'stored'; derivativeStatus: string }[]): string | null {
  const failed = pages.find((page) => page.derivativeStatus === 'failed');
  if (failed) return `Page ${failed.position} could not be read as an image. Remove it and add it again.`;
  const awaiting = pages.find((page) => page.uploadStatus === 'awaiting');
  if (awaiting) return `Page ${awaiting.position} is still uploading. Wait for it, or remove it.`;
  if (pagesProcessing(pages)) return 'Preparing the photos…';
  return null;
}

type JobFacts = {
  lastFinishedJob: { id: string; status: 'queued' | 'running' | 'succeeded' | 'failed'; errorCode: string | null; errorMessage: string | null; createdAt: Date; completedAt: Date } | null;
  versions: ReadonlyArray<{ versionNo: number; createdAt: Date; sourceJobId: string | null }>;
};

/**
 * The last AI failure, until a version is saved after it (the paper was then
 * fixed another way, for example in chat). The heading badge and the job panel
 * both read this, so a failure that is no longer news shows nowhere.
 */
export function currentJobFailure(detail: JobFacts) {
  const last = detail.lastFinishedJob;
  const newest = detail.versions[0];
  if (last?.status !== 'failed' || !last.errorCode) return null;
  if (newest && newest.createdAt >= last.completedAt) return null;
  return { errorCode: last.errorCode, message: last.errorMessage ?? 'AI generation failed.' };
}

/**
 * The version the last generation produced, while it is still the newest:
 * the job succeeded and the newest version is that job's own output
 * (`sourceJobId`). A version saved in chat afterwards, or by a later job, is
 * not news of this job, so this is null then.
 */
export function generatedVersionReady(detail: JobFacts): number | null {
  const last = detail.lastFinishedJob;
  const newest = detail.versions[0];
  if (last?.status !== 'succeeded' || !newest) return null;
  return newest.sourceJobId === last.id ? newest.versionNo : null;
}
