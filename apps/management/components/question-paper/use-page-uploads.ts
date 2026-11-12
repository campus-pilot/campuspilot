'use client';

import { useCallback, useRef } from 'react';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { planUploads, QUESTION_PAPER_MAX_PAGES } from '@campuspilot/components/question-paper/question-paper-model';
import type { UploadQueueItem } from '@campuspilot/components/question-paper/upload-queue';
import { uploadQuestionPaperPage, type QuestionPaperPageKey } from '@/lib/question-paper-pages';
import { prepareUploadFile } from './prepare-upload-file';
import { requestErrorMessage, runInOrder, uploadsInFlight } from './question-paper-model';

const queueSchema = z.object({
  items: z.array(z.object({ id: z.string(), name: z.string(), status: z.enum(['converting', 'uploading', 'error']) }).loose()),
  rejections: z.array(z.object({ name: z.string(), reason: z.string() })),
});

const PREVIEWABLE = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * The upload queue of one paper. Its state lives in a TanStack Form (`items`
 * and `rejections`), so the screen derives progress with `form.Subscribe`.
 *
 * Choosing files is an event handler (`addFiles`): files are checked at once
 * (type, 15 MB, free slots), the accepted ones appear in the queue with a local
 * preview, and a single chain then prepares and uploads them **one at a time,
 * in the order chosen** (also across several picks), because the server numbers
 * a page when it is stored. Each success refreshes the paper and then drops its
 * queue entry, so the photo moves from the queue to the grid without a gap.
 * A failure stays in the queue with the server's reason until dismissed, and
 * the rest carry on. Closing the tab loses only photos still in flight.
 *
 * The hook is called by the paper's layout, above the Pages / Result /
 * Versions sections, so switching section keeps the queue, its progress and its
 * slot count (leaving the paper altogether asks first, `DirtyGuard`).
 * `rootRef` revokes the local preview URLs when the paper leaves the page.
 */
export type PageUploads = ReturnType<typeof usePageUploads>;

export function usePageUploads({ pageKey, refresh }: { pageKey: QuestionPaperPageKey; refresh: () => Promise<void> }) {
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

  async function processEntry(entry: { id: string; file: File }) {
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
      await uploadQuestionPaperPage(pageKey, prepared.file);
      await refresh();
      remove(entry.id);
    } catch (error) {
      // The chain carries on, so photos chosen after this one are stored before it is added again: say where it ended up.
      patch(entry.id, { status: 'error', error: `${requestErrorMessage(error, 'The upload failed.')} This photo is not in the paper. Add it again; photos chosen after it were still added, so drag it into place.` });
    }
  }

  /** Photos still on their way count as taken slots, so two quick picks cannot pass 20 together. */
  const inFlight = () => uploadsInFlight(form.getFieldValue('items'));

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
    chain.current = chain.current.then(() => runInOrder(entries, processEntry));
  }

  /** Files dropped with a type the zone does not take: reported, never counted against the slots. */
  function rejectFiles(files: File[]) {
    form.setFieldValue('rejections', planUploads(files, 0).rejected);
  }

  return {
    form,
    rootRef,
    addFiles,
    rejectFiles,
    dismiss: remove,
    dismissRejections: () => form.setFieldValue('rejections', []),
  };
}
