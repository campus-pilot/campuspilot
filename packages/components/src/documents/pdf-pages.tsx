'use client';

import { useCallback, useState } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';

/**
 * A PDF opened with pdf.js, with every page already read (a question paper
 * has at most 40), so the viewer knows each page's shape before drawing any.
 *
 * Two parties keep it alive, each with its own fact:
 * - its owner (in the apps, the query cache) calls `release` once when it
 *   drops the document;
 * - every viewer showing it holds it with `retain` (the `PdfPages` list does,
 *   for as long as it is mounted with this document) and lets go with the
 *   function `retain` returns.
 * pdf.js frees the document (its parsed data in the worker) only when both
 * are done: released by its owner and held by no viewer. So a document a
 * screen still shows (a previous render kept on screen while the next one
 * loads, or after the next one failed) is never destroyed under it, however
 * soon the cache drops it.
 */
export type LoadedPdf = {
  pages: PDFPageProxy[];
  release: () => Promise<void>;
  retain: () => () => void;
};

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
type SharedWorker = InstanceType<PdfJs['PDFWorker']>;

/**
 * The one pdf.js worker of the page, created on first use and shared by
 * every document (pdf.js would otherwise start a worker per document and end
 * it only with that document). It lives as long as the page; destroying a
 * document does not end a worker it was given.
 */
let sharedWorker: SharedWorker | undefined;

/** pdf.js and the page's shared worker. */
async function pdfJsWithWorker(): Promise<{ pdfjs: PdfJs; worker: SharedWorker }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();
  }
  if (!sharedWorker || sharedWorker.destroyed) sharedWorker = new pdfjs.PDFWorker();
  return { pdfjs, worker: sharedWorker };
}

/**
 * The owner's and the viewers' hold on one document (see {@link LoadedPdf}),
 * destroying it through `destroy` once neither holds it. Pure, so the rule
 * is tested without pdf.js.
 */
export function createPdfHolds(destroy: () => Promise<void>) {
  let viewers = 0;
  let released = false;
  let destroyed: Promise<void> | null = null;
  const destroyWhenFree = () => {
    if (released && viewers === 0) destroyed ??= destroy();
    return destroyed ?? Promise.resolve();
  };
  return {
    release: () => {
      released = true;
      return destroyWhenFree();
    },
    retain: () => {
      viewers += 1;
      let held = true;
      return () => {
        if (!held) return;
        held = false;
        viewers -= 1;
        void destroyWhenFree();
      };
    },
  };
}

/**
 * Opens a PDF from its bytes. pdf.js is loaded on first use, so screens that
 * never show a PDF do not download it, and it parses in the page's one
 * shared worker. The bytes are copied first: pdf.js hands its input to the
 * worker, which would empty a buffer the caller keeps.
 *
 * `signal` is the caller's abort (a query's): a document finished after the
 * caller gave up is destroyed here and the abort is thrown, so nothing is
 * left that no one will release.
 *
 * The library and its worker come from pdf.js's `legacy` build, which
 * polyfills what browsers in use still lack. The default build assumes the
 * newest JavaScript: its TrueType parser calls `Math.sumPrecise`, which
 * Chrome 146 does not have, so every embedded font failed to load and pdf.js
 * drew the text in a generic system font without shaping (Hindi came out
 * broken while the PDF itself was fine).
 */
export async function loadPdf(bytes: ArrayBuffer, signal?: AbortSignal): Promise<LoadedPdf> {
  signal?.throwIfAborted();
  const { pdfjs, worker } = await pdfJsWithWorker();
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)), worker });
  try {
    const document = await task.promise;
    const pages = await Promise.all(Array.from({ length: document.numPages }, (_, index) => document.getPage(index + 1)));
    signal?.throwIfAborted();
    return { pages, ...createPdfHolds(() => task.destroy()) };
  } catch (error) {
    await task.destroy();
    throw error;
  }
}

/** The widest a page is drawn, in device pixels: sharp on a large retina pane without holding huge bitmaps. */
const MAX_DRAW_WIDTH_PX = 2400;
/** Pane widths are rounded up to this step, so a small resize does not draw every page again. */
const WIDTH_STEP_PX = 160;
/** The widest a page is laid out, in CSS pixels (the sheet's `max-w-[60rem]`). */
const MAX_PAGE_WIDTH_PX = 960;
/** Pages within this distance of the screen are drawn; the others keep their place blank and free their bitmap. */
const DRAW_MARGIN = '100% 0px';

/**
 * The width pages are laid out at, measured from the list itself (a pane, a
 * dialog or a phone screen) and rounded up to {@link WIDTH_STEP_PX}. The
 * observer is the one outside system involved, so it lives in the ref
 * callback that attaches it and is disconnected by the callback's cleanup.
 */
function useSteppedWidth() {
  const [width, setWidth] = useState(0);
  const measure = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    const update = () => setWidth(Math.ceil(element.clientWidth / WIDTH_STEP_PX) * WIDTH_STEP_PX);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { width, measure };
}

/**
 * One page drawn into a canvas at `cssWidth` times the screen's pixel ratio
 * (capped), so text stays sharp at any zoom the browser applies to the page.
 * A new width draws again; leaving the screen or a newer draw cancels the
 * one in progress. A page that cannot be drawn says so in its place.
 */
function PageCanvas({ page, cssWidth }: { page: PDFPageProxy; cssWidth: number }) {
  const [failed, setFailed] = useState(false);
  const draw = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas) return;
      const natural = page.getViewport({ scale: 1 });
      const drawWidth = Math.min(cssWidth * window.devicePixelRatio, MAX_DRAW_WIDTH_PX);
      const viewport = page.getViewport({ scale: drawWidth / natural.width });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const task = page.render({ canvas, viewport });
      // A draw that was let go of (a new width, another document, its document freed) is not a failure of this page.
      let current = true;
      task.promise.catch((error: unknown) => {
        if (current && !(error instanceof Error && error.name === 'RenderingCancelledException')) setFailed(true);
      });
      return () => {
        current = false;
        task.cancel();
      };
    },
    [page, cssWidth],
  );
  if (failed) {
    return <p className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">This page could not be shown.</p>;
  }
  return <canvas ref={draw} className="block h-full w-full" />;
}

/**
 * One sheet at the page's own proportions. Its canvas exists only while the
 * sheet is near the screen (an observer in the ref callback, as above), so a
 * long paper holds a few bitmaps, not forty.
 */
function PdfSheet({ page, pageNo, pageCount, cssWidth }: { page: PDFPageProxy; pageNo: number; pageCount: number; cssWidth: number }) {
  const [near, setNear] = useState(false);
  const watch = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setNear(entry?.isIntersecting ?? false), { rootMargin: DRAW_MARGIN });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const { width, height } = page.getViewport({ scale: 1 });
  return (
    <div
      ref={watch}
      role="img"
      aria-label={`Page ${pageNo} of ${pageCount}`}
      className="w-full max-w-[60rem] shrink-0 overflow-hidden rounded-sm bg-white shadow-md ring-1 ring-black/5"
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      {near && cssWidth > 0 ? <PageCanvas page={page} cssWidth={cssWidth} /> : null}
    </div>
  );
}

/**
 * A PDF as its printed pages: white sheets one under the other, as wide as
 * the container allows (at most 60rem), each drawn by pdf.js at the screen's
 * resolution. It holds the document while it shows it (`LoadedPdf.retain`),
 * so its owner may release it at any time. It takes its container's height
 * and scrolls inside it. The
 * pages are pictures (no text layer), so text cannot be selected here; the
 * PDF itself is the file to download for that.
 */
export function PdfPages({ pdf, label }: { pdf: LoadedPdf; label: string }) {
  const { width, measure } = useSteppedWidth();
  const pageCount = pdf.pages.length;
  // The list holds the document while it is mounted with it (see `LoadedPdf`): the ref callback's cleanup lets go.
  const hold = useCallback((element: HTMLElement | null) => (element ? pdf.retain() : undefined), [pdf]);
  return (
    <section ref={hold} aria-label={label} className="h-full min-h-0 overflow-y-auto rounded-xl border bg-muted/40">
      <div ref={measure} className="flex flex-col items-center gap-4 p-3 sm:p-4">
        {pdf.pages.map((page, index) => (
          <PdfSheet key={page.pageNumber} page={page} pageNo={index + 1} pageCount={pageCount} cssWidth={Math.min(width, MAX_PAGE_WIDTH_PX)} />
        ))}
      </div>
    </section>
  );
}
