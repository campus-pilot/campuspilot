'use client';

import { useCallback, useRef } from 'react';
import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { planUploads, QUESTION_PAPER_MAX_PAGES } from '@campuspilot/components/question-paper/question-paper-model';
import type { UploadQueueItem } from '@campuspilot/components/question-paper/paper-source-tray';
import { client, orpc } from '@/lib/orpc';
import { storeQuestionPaperPage, type QuestionPaperPage, type QuestionPaperPageKey } from '@/lib/question-paper-pages';
import { prepareUploadFile } from './prepare-upload-file';
import { PAGE_UPLOAD_CONCURRENCY, requestErrorMessage, runWithConcurrency, unreservedUploads } from './question-paper-model';
import type { QuestionPaperDetail } from './use-question-paper-detail';

const queueSchema = z.object({
  items: z.array(z.object({ id: z.string(), name: z.string(), status: z.enum(['converting', 'uploading', 'error']), pageId: z.string().optional() }).loose()),
  rejections: z.array(z.object({ name: z.string(), reason: z.string() })),
});

const PREVIEWABLE = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * The upload queue of one paper. Its state lives in a TanStack Form (`items`
 * and `rejections`), so the screen derives progress with `form.Subscribe`.
 *
 * Choosing files is an event handler (`addFiles`): files are checked at once
 * (type, 15 MB, free slots), the accepted ones appear in the queue with a local
 * preview, and a chain then handles each pick in turn: it **reserves one page
 * per photo in the order chosen** (`reserveQuestionPaperPages`, one cheap
 * request), then shrinks (`prepareUploadFile`) and sends the photos
 * {@link PAGE_UPLOAD_CONCURRENCY} at a time into their own pages, so the order
 * never depends on which finishes first. A stored photo replaces its page in
 * the cached paper at once (no read per photo) and leaves the queue; the grid
 * shows it as processing until the worker has made its copies (the paper is
 * polled meanwhile), and the paper is read once when the pick is done. A
 * failure releases its page, stays in the queue with the server's reason until
 * dismissed, and the rest carry on. Closing the tab loses only photos still in
 * flight; their reserved pages are removed by the server after 15 minutes, or
 * by the teacher at once.
 *
 * The hook is called by the paper's layout, above its views (the first screen
 * and the studio), so switching view keeps the queue, its progress and its
 * slot count (leaving the paper altogether asks first, `DirtyGuard`).
 * `rootRef` revokes the local preview URLs when the paper leaves the page.
 */
export type PageUploads = ReturnType<typeof usePageUploads>;

export function usePageUploads({ pageKey, refresh }: { pageKey: QuestionPaperPageKey; refresh: () => Promise<void> }) {
  const queryClient = useQueryClient();
  const form = useForm({
    defaultValues: { items: [] as UploadQueueItem[], rejections: [] as { name: string; reason: string }[] },
    validators: { onChange: queueSchema },
  });
  const chain = useRef<Promise<void>>(Promise.resolve());
  const previews = useRef(new Map<string, string>());
  const counter = useRef(0);

  const rootRef = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    const urls = previews.current;
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const patch = (id: string, change: Partial<UploadQueueItem>) =>
    form.setFieldValue('items', (items) => items.map((item) => (item.id === id ? { ...item, ...change } : item)));
  const remove = (id: string) => {
    const url = previews.current.get(id);
    if (url) URL.revokeObjectURL(url);
    previews.current.delete(id);
    form.setFieldValue('items', (items) => items.filter((item) => item.id !== id));
  };

  /** Puts a stored page into the cached paper, where its reservation already stands, so the grid shows it without a read. */
  const showStoredPage = (page: QuestionPaperPage) =>
    queryClient.setQueryData(orpc.school.getQuestionPaperDetail.queryKey({ input: pageKey }), (detail: QuestionPaperDetail | undefined) =>
      detail ? { ...detail, pages: detail.pages.map((current) => (current.id === page.id ? page : current)) } : detail,
    );

  async function processEntry(entry: { id: string; file: File; pageId: string }) {
    patch(entry.id, { status: 'converting', error: undefined });
    try {
      const prepared = await prepareUploadFile(entry.file);
      // A converted HEIC can be previewed now; an original HEIC cannot be drawn by most browsers.
      if (!previews.current.has(entry.id) && PREVIEWABLE.has(prepared.file.type)) {
        const url = URL.createObjectURL(prepared.file);
        previews.current.set(entry.id, url);
        patch(entry.id, { previewUrl: url });
      }
      patch(entry.id, { status: 'uploading' });
      showStoredPage(await storeQuestionPaperPage(pageKey, entry.pageId, prepared.file));
      remove(entry.id);
    } catch (error) {
      // Its page is given back so the paper holds no empty page; the photos after it keep their own pages.
      await client.school.releaseQuestionPaperPage({ ...pageKey, pageId: entry.pageId }).catch(() => undefined);
      patch(entry.id, {
        status: 'error',
        pageId: undefined,
        error: `${requestErrorMessage(error, 'The upload failed.')} This photo is not in the paper. Add it again; photos chosen after it were still added, so drag it into place.`,
      });
    }
  }

  /** Reserves the pick's pages in order, reads the paper once so they stand in the grid, then sends the photos in parallel. */
  async function processPick(entries: Array<{ id: string; file: File }>) {
    let reserved: QuestionPaperPage[];
    try {
      ({ pages: reserved } = await client.school.reserveQuestionPaperPages({ ...pageKey, fileNames: entries.map((entry) => entry.file.name) }));
    } catch (error) {
      for (const entry of entries) patch(entry.id, { status: 'error', error: requestErrorMessage(error, 'The photos could not be added.') });
      return;
    }
    const withPages = entries.map((entry, index) => ({ ...entry, pageId: reserved[index]!.id }));
    for (const entry of withPages) patch(entry.id, { pageId: entry.pageId });
    await refresh();
    await runWithConcurrency(withPages, PAGE_UPLOAD_CONCURRENCY, processEntry);
    await refresh();
  }

  /** Photos on their way that hold no page yet count as taken slots, so two quick picks cannot pass 20 together. */
  const inFlight = () => unreservedUploads(form.getFieldValue('items'));

  function addFiles(files: File[], savedPages: number) {
    const remaining = QUESTION_PAPER_MAX_PAGES - savedPages - inFlight();
    const plan = planUploads(files, remaining);
    form.setFieldValue('rejections', plan.rejected);
    if (plan.accepted.length === 0) return;
    const entries = plan.accepted.map((file) => {
      counter.current += 1;
      const id = `upload-${counter.current}`;
      const previewable = PREVIEWABLE.has(file.type);
      const previewUrl = previewable ? URL.createObjectURL(file) : undefined;
      if (previewUrl) previews.current.set(id, previewUrl);
      return { id, file, item: { id, name: file.name, previewUrl, status: 'converting' } satisfies UploadQueueItem };
    });
    form.setFieldValue('items', (items) => [...items, ...entries.map((entry) => entry.item)]);
    // Picks are handled one after another, so a later pick's pages come after an earlier pick's.
    chain.current = chain.current.then(() => processPick(entries));
  }

  /** Files turned away before they reached the queue (a type the paper does not take, a source that cannot be mixed in): reported beside the queue's own refusals. */
  function reportRejections(rejections: readonly { name: string; reason: string }[]) {
    if (rejections.length > 0) form.setFieldValue('rejections', (current) => [...current, ...rejections]);
  }

  return {
    form,
    rootRef,
    addFiles,
    reportRejections,
    dismiss: remove,
    dismissRejections: () => form.setFieldValue('rejections', []),
  };
}
