import { isExamNameTakenError } from '@campuspilot/api/routers/school/exam/exam-definition.contract';
import {
  SCHOOL_WRITE_REFUSAL_MESSAGES,
  schoolWriteRefusalOf,
} from '@campuspilot/api/school-access/school-access.contract';
import {
  isSessionStaleError,
  sessionVersionToken,
} from '@campuspilot/api/routers/school/session/session.contract';
import type { SessionSaveRequest } from '@campuspilot/components/session';
import { errorMessage, isExamSaveUncertain } from '../exam/exam-model';

/** Shown next to Save when the session changed elsewhere after the edit started. */
export const SESSION_STALE_SAVE_MESSAGE =
  'These settings were changed elsewhere after you started editing (for example, an examination was added from the Examinations list). Your changes are still shown but were not saved. Load the latest settings, review them, make your changes again and save.';

/** Shown next to Save when the edit gives two examinations one name. */
export const SESSION_EXAM_NAME_TAKEN_MESSAGE =
  'Another examination in this session already has one of these names. Review the examinations, give each a different name and save again.';

/** Shown next to Save when the save may or may not have been applied. */
export const SESSION_SAVE_UNCERTAIN_MESSAGE =
  'The settings may not have been saved. Load the latest settings to check them before saving again.';

/**
 * How the session settings screen reports a refused `updateSession` save,
 * decided by the refusal's explicit reason, never by its code alone:
 *
 * - Stale (`isSessionStaleError`): the session changed after the edit
 *   started. The session is read again and the user must load the latest
 *   settings before saving (`reviewLatest`); the edits stay on screen until
 *   they do, so nothing is lost without their say.
 * - Taken exam name (`isExamNameTakenError`): the stale check runs first on
 *   the server, so the clash is in the user's own edit of the current
 *   settings. The session is read again (as for any conflict on the exam
 *   list) but the edits stay editable: the user renames and saves again.
 * - Unknown outcome (`isExamSaveUncertain`: a network or server failure after
 *   the request left): the session is read again and the user must load it,
 *   because a save that did commit has moved the session on.
 * - A read-only school: its fixed message (`SCHOOL_WRITE_REFUSAL_MESSAGES`).
 * - Anything else (permission, an exam with data that cannot be removed, an
 *   inactive session): the server's message; the edits stay editable.
 */
export function sessionSaveRefusal(error: unknown): {
  message: string;
  reviewLatest: boolean;
  refetch: boolean;
} {
  if (isSessionStaleError(error))
    return { message: SESSION_STALE_SAVE_MESSAGE, reviewLatest: true, refetch: true };
  if (isExamNameTakenError(error))
    return { message: SESSION_EXAM_NAME_TAKEN_MESSAGE, reviewLatest: false, refetch: true };
  const readOnly = schoolWriteRefusalOf(error);
  if (readOnly)
    return { message: SCHOOL_WRITE_REFUSAL_MESSAGES[readOnly], reviewLatest: false, refetch: false };
  if (isExamSaveUncertain(error))
    return { message: SESSION_SAVE_UNCERTAIN_MESSAGE, reviewLatest: true, refetch: true };
  return { message: errorMessage(error), reviewLatest: false, refetch: false };
}

/**
 * The `updateSession` request for a save from the settings screen. It always
 * carries `expectedUpdatedAt`, the version of the session the edit started
 * from, so a save based on an outdated read is refused instead of removing
 * exams created elsewhere meanwhile.
 */
export function toUpdateSessionInput(
  scope: { schoolId: string; sessionId: string },
  request: SessionSaveRequest,
) {
  return {
    schoolId: scope.schoolId,
    sessionId: scope.sessionId,
    sessionConfig: request.sessionConfig,
    expectedUpdatedAt: sessionVersionToken(request.basedOnUpdatedAt),
  };
}
