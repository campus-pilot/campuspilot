'use client';

import type { pageDtoSchema } from '@campuspilot/api/routers/school/question-paper/question-paper.dto';
import { env } from '@campuspilot/env/management.client';
import { ORPCError } from '@orpc/client';
import { z } from 'zod';

/** The natural key of one paper, as the API and the upload routes take it. */
export type QuestionPaperPageKey = {
  schoolId: string;
  sessionId: string;
  examSlug: string;
  classId: string;
  subjectSlug: string;
  modeSlug: string;
};

/** A route of the API's `/api/blob` routes for one paper; `path` starts with `/`. */
function paperBlobUrl(key: QuestionPaperPageKey, path: string) {
  const segment = (value: string) => encodeURIComponent(value);
  return new URL(
    `/api/blob/schools/${segment(key.schoolId)}/sessions/${segment(key.sessionId)}/exams/${segment(key.examSlug)}/classes/${segment(key.classId)}/question-papers/${segment(key.subjectSlug)}/${segment(key.modeSlug)}${path}`,
    env.NEXT_PUBLIC_SERVER_URL,
  ).toString();
}

function pagesUrl(key: QuestionPaperPageKey, suffix = '') {
  return paperBlobUrl(key, `/pages${suffix}`);
}

/** What a page image URL needs to know of the page. */
export type QuestionPaperPageImageRef = { id: string; derivativeRevision: number };

/**
 * A derivative of a page (`thumb` or `model`), usable as `<img src>`: the
 * session cookie authenticates and the route redirects to a short-lived signed
 * URL. Turning a page makes its derivatives again under new storage keys, and
 * the route's redirect may be cached for a few minutes, so the URL carries the
 * page's `derivativeRevision` (`?v=`): a turned page gets a new URL and the
 * browser never shows a cached redirect to the objects of an earlier turn.
 */
function derivativeUrl(key: QuestionPaperPageKey, page: QuestionPaperPageImageRef, variant: 'thumb' | 'model') {
  return `${pagesUrl(key, `/${encodeURIComponent(page.id)}/${variant}`)}?v=${page.derivativeRevision}`;
}

/**
 * The thumbnail of a page (at most 360 px, turned as the page's `rotation`
 * says). A page whose photo the server could not decode, or has not processed
 * yet, has no thumbnail (404), so callers only ask for pages with
 * `derivativeStatus` `ready`.
 */
export function questionPaperThumbUrl(key: QuestionPaperPageKey, page: QuestionPaperPageImageRef) {
  return derivativeUrl(key, page, 'thumb');
}

/**
 * The copy of a page the AI reads (at most 1800 px JPEG, turned as the page's
 * `rotation` says), for a view large enough to read: what the user checks is
 * exactly what the model will get, the right way up. Only for pages with
 * `derivativeStatus` `ready`.
 */
export function questionPaperModelUrl(key: QuestionPaperPageKey, page: QuestionPaperPageImageRef) {
  return derivativeUrl(key, page, 'model');
}

/**
 * The photo of a page as it was uploaded (never turned), usable as `<img
 * src>`. It can be several megabytes and, for a HEIC original, a type the
 * browser cannot draw: the page viewer uses it only for a page the server
 * could not decode, which has no derivatives (and so cannot be turned).
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

/** What an `/api/blob` route answers when it refuses (`rpcErrorResponse`). */
const refusalBodySchema = z.object({ code: z.string().optional(), message: z.string().optional() });

/**
 * The bytes of a saved version's PDF (the file Download PDF gives), read with
 * the session cookie. A refusal becomes an `ORPCError` with the server's code,
 * status and message, like a refusal through the RPC client, so the screen
 * words it and decides about retrying the same way.
 */
export async function fetchQuestionPaperVersionPdf(key: QuestionPaperPageKey, versionNo: number, signal?: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(paperBlobUrl(key, `/versions/${versionNo}/pdf`), { credentials: 'include', signal });
  if (!response.ok) {
    const failure = refusalBodySchema.safeParse(await response.json().catch(() => null));
    const body = failure.success ? failure.data : null;
    throw new ORPCError(body?.code ?? 'INTERNAL_SERVER_ERROR', {
      status: response.status,
      message: body?.message ?? `The PDF could not be loaded (${response.status}).`,
    });
  }
  return response.arrayBuffer();
}
