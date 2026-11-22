import {
  isSessionStaleError,
  sessionVersionToken,
} from '@campuspilot/api/routers/school/session/session.contract';
import type {
  SchoolSessionDto,
  SessionSaveRequest,
  SessionSaveResult,
} from '@campuspilot/components/session';

/** Shown next to Save when the session changed elsewhere after the edit started. */
const STALE_SAVE_MESSAGE =
  'These settings were changed elsewhere after you started editing. Your changes are still shown but were not saved. Load the latest settings, review them, make your changes again and save.';

/**
 * The `updateSession` fields for a save from the settings view: the edited
 * configuration and `expectedUpdatedAt`, the version of the session the edit
 * started from, so a save based on an outdated read is refused (as stale)
 * instead of removing exams created elsewhere meanwhile.
 */
export function toSessionSaveInput(request: SessionSaveRequest) {
  return {
    sessionConfig: request.sessionConfig,
    expectedUpdatedAt: sessionVersionToken(request.basedOnUpdatedAt),
  };
}

/**
 * Runs a settings save and reports its outcome to the settings view, which
 * shows a refusal next to Save. A stale refusal (`isSessionStaleError`) reads
 * the session again (`refresh`) and asks the user to load the latest
 * settings; any other refusal shows the server's message.
 */
export async function reportSessionSave(
  save: () => Promise<SchoolSessionDto | undefined>,
  refresh: () => Promise<unknown>,
): Promise<SessionSaveResult> {
  try {
    const saved = await save();
    if (!saved)
      return {
        status: 'refused',
        message: 'The session is not loaded yet. Try again.',
        reviewLatest: false,
      };
    return { status: 'saved', session: saved };
  } catch (error) {
    if (isSessionStaleError(error)) {
      await refresh();
      return { status: 'refused', message: STALE_SAVE_MESSAGE, reviewLatest: true };
    }
    return {
      status: 'refused',
      message:
        error instanceof Error ? error.message : 'The settings could not be saved.',
      reviewLatest: false,
    };
  }
}
