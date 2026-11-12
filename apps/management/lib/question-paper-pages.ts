'use client';

import { env } from '@campuspilot/env/management.client';

/** The natural key of one paper, as the API and the upload routes take it. */
export type QuestionPaperPageKey = {
  schoolId: string;
  sessionId: string;
  examSlug: string;
  classId: string;
  subjectSlug: string;
  modeSlug: string;
};

function pagesUrl(key: QuestionPaperPageKey, suffix = '') {
  const segment = (value: string) => encodeURIComponent(value);
  return new URL(
    `/api/blob/schools/${segment(key.schoolId)}/sessions/${segment(key.sessionId)}/exams/${segment(key.examSlug)}/classes/${segment(key.classId)}/question-papers/${segment(key.subjectSlug)}/${segment(key.modeSlug)}/pages${suffix}`,
    env.NEXT_PUBLIC_SERVER_URL,
  ).toString();
}

/**
 * The thumbnail of a page, usable as `<img src>`: the session cookie
 * authenticates and the route redirects to a short-lived signed URL. A page
 * whose photo the server could not decode has no thumbnail (404), so callers
 * only ask for pages with `derivativeStatus` `ready`.
 */
export function questionPaperThumbUrl(key: QuestionPaperPageKey, pageId: string) {
  return pagesUrl(key, `/${encodeURIComponent(pageId)}/thumb`);
}

/** What the upload route answers on success (`{ page, pageRevision }`); only the revision is used. */
export type QuestionPaperUploadResult = { pageRevision: number };

/**
 * Uploads one photo as the next page of a paper (multipart field `page`).
 * Rejections come back as `{ message }`, which becomes the error's message so
 * the queue can show the server's own reason (type, size, 20 pages, running
 * generation, ended exam).
 */
export async function uploadQuestionPaperPage(key: QuestionPaperPageKey, file: File): Promise<QuestionPaperUploadResult> {
  const body = new FormData();
  body.set('page', file);
  let response: Response;
  try {
    response = await fetch(pagesUrl(key), { method: 'POST', body, credentials: 'include' });
  } catch {
    throw new Error('Unable to reach the server. Check your connection and try again.');
  }
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(failure?.message ?? `The upload failed (${response.status}).`);
  }
  return (await response.json()) as QuestionPaperUploadResult;
}
