/**
 * Decodes a dynamic route segment. A malformed escape (such as `%E0`) makes
 * `decodeURIComponent` throw; that URL cannot name any record, so callers
 * show their not-found state instead of crashing.
 */
export function decodeRouteParam(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Links to one class's results or growth. The class record id is a path
 * segment (`/results/class/{recordId}`), not a query parameter; the server
 * only resolves it within the signed-in admission's own class records.
 */
export const classResultsHref = (recordId: string) => `/results/class/${encodeURIComponent(recordId)}`;
export const classGrowthHref = (recordId: string) => `/growth/class/${encodeURIComponent(recordId)}`;

/** The Fees screen and one bill on it (`/fees/{billId}`, the finance bill id). */
export const FEES_HREF = '/fees';
export const billHref = (billId: string) => `/fees/${encodeURIComponent(billId)}`;

/**
 * One exam's result screen (`/results/{examId}`). The exam id is the
 * server's `{studentId}.{classId}.{examSlug}` (class record id + exam slug,
 * see `parseExamId` in the cadet academics service); the server resolves it
 * only within the signed-in admission and answers NOT_FOUND otherwise.
 */
export const examResultHref = (ids: { studentId: string; classId: string; examSlug: string }) =>
  `/results/${encodeURIComponent(`${ids.studentId}.${ids.classId}.${ids.examSlug}`)}`;

/**
 * The Notices screen and one notice on it (`/notices/{noticeId}`). The
 * server only resolves a notice addressed to the signed-in student and
 * answers NOT_FOUND otherwise.
 */
export const NOTICES_HREF = '/notices';
export const noticeHref = (noticeId: string) => `/notices/${encodeURIComponent(noticeId)}`;
