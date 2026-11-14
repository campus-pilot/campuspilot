import { CLASS_ACTIONS, type PermissionCheck } from '@campuspilot/api/routers/authorization/authorization.dto';
import type { ExamScope } from '@/components/exam/exam-model';

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

/** The version to show: the one in the URL when it exists, otherwise the latest; null when there is none. */
export function resolveVersionNo(raw: string | null | undefined, versionNos: readonly number[]): number | null {
  const requested = raw === null || raw === undefined ? NaN : Number(raw);
  if (Number.isInteger(requested) && versionNos.includes(requested)) return requested;
  return versionNos.length === 0 ? null : Math.max(...versionNos);
}

/** How often the detail is read again: every 3 seconds while a generation is queued or running, otherwise never. */
export const GENERATION_POLL_MS = 3000;
export function detailPollInterval(data: { activeJob: unknown } | undefined): number | false {
  return data?.activeJob ? GENERATION_POLL_MS : false;
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

/** The user-facing text of a failed request, with the server's own message when it has one. */
export function requestErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Whether the server refused because the pages changed since the screen loaded them. */
export function isConflict(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code: unknown }).code === 'CONFLICT');
}

/**
 * Runs `worker` over `items` one at a time, in order. Uploads are sequential
 * on purpose: the server numbers a page when it is stored, so photos chosen
 * together must arrive in the order they were chosen.
 */
export async function runInOrder<T>(items: readonly T[], worker: (item: T) => Promise<void>): Promise<void> {
  for (const item of items) await worker(item);
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
