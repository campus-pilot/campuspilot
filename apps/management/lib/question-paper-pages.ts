'use client';

import type { pageDtoSchema } from '@campuspilot/api/routers/school/question-paper/question-paper.dto';
import { env } from '@campuspilot/env/management.client';
import type { z } from 'zod';

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
 * whose photo the server could not decode, or has not processed yet, has no
 * thumbnail (404), so callers only ask for pages with `derivativeStatus`
 * `ready`.
 */
export function questionPaperThumbUrl(key: QuestionPaperPageKey, pageId: string) {
  return pagesUrl(key, `/${encodeURIComponent(pageId)}/thumb`);
}

/**
 * The photo of a page as it was uploaded, usable as `<img src>` for a view
 * large enough to read. It can be several megabytes and, for a HEIC original,
 * a type the browser cannot draw: callers load it only when the user asks to
 * see the page and fall back to the thumbnail.
 */
export function questionPaperOriginalUrl(key: QuestionPaperPageKey, pageId: string) {
  return pagesUrl(key, `/${encodeURIComponent(pageId)}/original`);
}

/** One page as the API returns it (`getQuestionPaperDetail().pages[n]`). */
export type QuestionPaperPage = z.infer<typeof pageDtoSchema>;

/**
 * Sends the photo of a page reserved with `reserveQuestionPaperPages`
 * (multipart field `page`) and answers with the page, now `stored` and
 * `pending` until the worker has made its thumbnail and model copy.
 * Rejections come back as `{ message }`, which becomes the error's message so
 * the queue can show the server's own reason (type, size, a reservation that
 * expired, running generation, ended exam).
 */
export async function storeQuestionPaperPage(key: QuestionPaperPageKey, pageId: string, file: File): Promise<QuestionPaperPage> {
  const body = new FormData();
  body.set('page', file);
  let response: Response;
  try {
    response = await fetch(pagesUrl(key, `/${encodeURIComponent(pageId)}`), { method: 'POST', body, credentials: 'include' });
  } catch {
    throw new Error('Unable to reach the server. Check your connection and try again.');
  }
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(failure?.message ?? `The upload failed (${response.status}).`);
  }
  return ((await response.json()) as { page: QuestionPaperPage }).page;
}
