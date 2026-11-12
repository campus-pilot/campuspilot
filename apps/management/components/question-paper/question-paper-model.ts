import { CLASS_ACTIONS, type PermissionCheck } from '@campuspilot/api/routers/authorization/authorization.dto';
import type { ExamScope } from '@/components/exam/exam-model';

/** One paper: an exam, a class, a subject and an assessment mode of its plan. */
export type QuestionPaperScope = ExamScope & { classId: string; subjectSlug: string; modeSlug: string };

export const QUESTION_PAPER_SECTIONS = ['pages', 'result', 'versions'] as const;
export type QuestionPaperSection = (typeof QUESTION_PAPER_SECTIONS)[number];

export const SECTION_LABELS: Record<QuestionPaperSection, string> = {
  pages: 'Pages',
  result: 'Result',
  versions: 'Versions',
};

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
 * The section to show: the one in the URL when valid, otherwise Result when a
 * version exists (that is what the user came to see) and Pages when not.
 */
export function resolveSection(raw: string | null | undefined, hasVersion: boolean): QuestionPaperSection {
  const requested = QUESTION_PAPER_SECTIONS.find((section) => section === raw);
  return requested ?? (hasVersion ? 'result' : 'pages');
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

/**
 * Where "Want to update something? Continue in chat" leads: the assistant page
 * with the paper's natural key in the query (ids and slugs only, nothing
 * personal). Contract with the chat: `?seed=question_paper&sessionId=&examSlug=
 * &classId=&subjectSlug=&modeSlug=`. The chat reads the seed, starts a new
 * conversation with a prefilled draft and a context chip, and sends nothing
 * until the user does (decision D31).
 */
export function continueInChatHref(scope: QuestionPaperScope) {
  const params = new URLSearchParams({
    seed: 'question_paper',
    sessionId: scope.sessionId,
    examSlug: scope.examSlug,
    classId: scope.classId,
    subjectSlug: scope.subjectSlug,
    modeSlug: scope.modeSlug,
  });
  return `/school/${encodeURIComponent(scope.schoolId)}/assistant?${params.toString()}`;
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
