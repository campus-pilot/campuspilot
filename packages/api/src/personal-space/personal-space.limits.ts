/**
 * The limits of a personal space (docs/personal-space.md, "Limits"): what one
 * free space may hold and how fast it may print, so a person cannot fill
 * storage or keep the PDF printer busy. Importable by the browser apps (no
 * database imports). Every number is named here and listed in the guide.
 *
 * A personal space becomes read-only when its trial ends, and read-only also
 * means nothing can be deleted, so these limits are what bounds the space for
 * good: they are checked inside the transaction that adds the bytes or the
 * version, under a lock, so concurrent requests cannot pass them together.
 */

/**
 * The stored bytes one personal space may hold: every page photo with its
 * thumbnail and model copy, every figure image and every version's PDF
 * (`personalSpaceStoredBytes`). 2 GiB.
 */
export const PERSONAL_SPACE_STORAGE_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;

/** The question papers one personal space may hold, used or not (`createStandalonePaper`). */
export const STANDALONE_PAPERS_PER_SPACE_LIMIT = 100;

/** The versions one standalone paper may have; versions are immutable and never deleted one by one. */
export const STANDALONE_PAPER_MAX_VERSIONS = 50;

/**
 * Saves of standalone paper versions one personal space may make per
 * {@link STANDALONE_SAVE_WINDOW_MS}, each one a printed PDF. Counted from the
 * stored versions themselves (their `created_at`), so the limit holds for
 * every way in: the app, the in-app assistant and MCP clients.
 */
export const STANDALONE_SAVES_PER_WINDOW = 30;

/** The window of {@link STANDALONE_SAVES_PER_WINDOW}: one minute. */
export const STANDALONE_SAVE_WINDOW_MS = 60_000;

/**
 * The AI generations a personal space may have queued or running at once.
 * The monthly AI limit is checked against a cached spend sum, so concurrent
 * jobs could overshoot it; a free space runs one at a time. Real schools keep
 * `QUESTION_PAPER_MAX_RUNNING_JOBS_PER_SCHOOL`.
 */
export const PERSONAL_SPACE_MAX_RUNNING_JOBS = 1;

/** `data.reason` of the refusal of each limit. */
export const PERSONAL_SPACE_LIMIT_REASONS = {
  storage: 'PERSONAL_SPACE_STORAGE_FULL',
  papers: 'PERSONAL_SPACE_PAPER_LIMIT',
  versions: 'STANDALONE_PAPER_VERSION_LIMIT',
  saveRate: 'STANDALONE_PAPER_SAVE_RATE',
} as const;

export type PersonalSpaceLimit = keyof typeof PERSONAL_SPACE_LIMIT_REASONS;

const GIB = 1024 * 1024 * 1024;

/** What the person is told for each limit, in the app and in the API error. */
export const PERSONAL_SPACE_LIMIT_MESSAGES = {
  storage: `Your personal space is full: it can store ${PERSONAL_SPACE_STORAGE_QUOTA_BYTES / GIB} GB of photos, images and PDFs. Delete papers you no longer need, then try again.`,
  papers: `A personal space can hold at most ${STANDALONE_PAPERS_PER_SPACE_LIMIT} question papers. Delete some to create another.`,
  versions: `A question paper can have at most ${STANDALONE_PAPER_MAX_VERSIONS} versions. Create a new paper to keep writing.`,
  saveRate: `Your personal space saved ${STANDALONE_SAVES_PER_WINDOW} versions in the last minute. Wait a minute, then save again.`,
} as const satisfies Record<PersonalSpaceLimit, string>;

/** The limit a caught API error refuses, or null for any other error. */
export function personalSpaceLimitOf(error: unknown): PersonalSpaceLimit | null {
  if (typeof error !== 'object' || error === null || !('data' in error)) return null;
  const reason = (error.data as { reason?: unknown } | null | undefined)?.reason;
  const entry = Object.entries(PERSONAL_SPACE_LIMIT_REASONS).find(([, value]) => value === reason);
  return entry ? (entry[0] as PersonalSpaceLimit) : null;
}
