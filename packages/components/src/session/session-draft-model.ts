import type { SchoolSessionDto, SessionConfig } from './types';

/**
 * Normalizes session config ensuring undefined records become null/empty
 * to allow stable equality comparisons.
 */
function normalizeSessionConfig(config: SessionConfig | null | undefined) {
  if (!config) return null;
  return {
    examConfig: config.examConfig ?? {},
    coScholasticAreas: config.coScholasticAreas ?? {},
    gradingScale: config.gradingScale ?? {},
    attendanceTracking: config.attendanceTracking ?? { enabled: false },
  };
}

/** Whether two configurations differ, treating missing sections as their defaults. */
export function configsDiffer(
  left: SessionConfig | null | undefined,
  right: SessionConfig | null | undefined,
) {
  return (
    JSON.stringify(normalizeSessionConfig(left)) !==
    JSON.stringify(normalizeSessionConfig(right))
  );
}

/** A session's `updatedAt` as a number to compare; a session never updated is the oldest. */
function updatedAtTime(updatedAt: SchoolSessionDto['updatedAt']) {
  return updatedAt === null ? Number.NEGATIVE_INFINITY : new Date(updatedAt).getTime();
}

/**
 * The newest known copy of the session: the app's `session` prop, or the
 * session the last save returned while the app has not caught up with it
 * yet (its read is refetched after the save), so a saved edit never flashes
 * back to the configuration it replaced.
 */
export function newerSession(session: SchoolSessionDto, saved: SchoolSessionDto | null) {
  return saved !== null &&
    saved.id === session.id &&
    updatedAtTime(saved.updatedAt) > updatedAtTime(session.updatedAt)
    ? saved
    : session;
}

/** Shown when the save's outcome is unknown (the app's `onSave` failed). */
export const SAVE_UNCERTAIN_MESSAGE =
  'The settings may not have been saved. Load the latest settings to check them before saving again.';

/** Shown when the session changed elsewhere after the edit started. */
export const OUTDATED_MESSAGE =
  'This session was changed elsewhere after you started editing (for example, an examination was added). Load the latest settings, then make your changes again.';

/** The user's edit: the configuration on screen and the session it was made on. */
export interface SessionEdits {
  config: SessionConfig | null;
  basedOn: SchoolSessionDto;
}

/** A refused save, as shown next to the Save control (`SessionSaveResult`). */
export interface SessionSaveRefusal {
  message: string;
  reviewLatest: boolean;
}

/**
 * What the settings view shows, derived from the app's `session`, the session
 * the last save returned, the user's edits and the last refusal:
 *
 * - `latest`: the newest known session (`newerSession`).
 * - `basedOn`: the session the edits were made on, or `latest` without edits.
 * - `draft`: the configuration on screen; the latest one without edits.
 * - `isDirty`: the edits differ from the configuration they were made on.
 * - `isOutdated`: a newer session is known than the one the edits were made
 *   on (it changed elsewhere), so their save would be refused as stale.
 * - `needsReview`: Save is unavailable until the user loads the latest
 *   settings: outdated, or a save was refused as stale or ended with an
 *   unknown outcome.
 * - `message`: the refusal's message, else the outdated notice, else null.
 */
export function sessionDraftState({
  session,
  lastSaved,
  edits,
  refusal,
}: {
  session: SchoolSessionDto;
  lastSaved: SchoolSessionDto | null;
  edits: SessionEdits | null;
  refusal: SessionSaveRefusal | null;
}) {
  const latest = newerSession(session, lastSaved);
  const isOutdated =
    edits !== null &&
    updatedAtTime(latest.updatedAt) !== updatedAtTime(edits.basedOn.updatedAt);
  return {
    latest,
    basedOn: edits?.basedOn ?? latest,
    draft: edits ? edits.config : latest.sessionConfig,
    isDirty:
      edits !== null && configsDiffer(edits.config, edits.basedOn.sessionConfig),
    isOutdated,
    needsReview: isOutdated || (refusal?.reviewLatest ?? false),
    message: refusal?.message ?? (isOutdated ? OUTDATED_MESSAGE : null),
  };
}
