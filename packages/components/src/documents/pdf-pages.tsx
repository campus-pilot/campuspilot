'use client';

import { useCallback, useState } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';

/**
 * A PDF opened with pdf.js, with every page already read (a question paper
 * has at most 40), so the viewer knows each page's shape before drawing any.
 * `release` frees what pdf.js holds for it (its worker and parsed data): the
 * owner calls it once nothing shows the document any more.
 */
export type LoadedPdf = {
  pages: PDFPageProxy[];
  release: () => Promise<void>;
};

/**
 * Opens a PDF from its bytes. pdf.js is loaded on first use, so screens that
 * never show a PDF do not download it, and it parses in a worker of its own
 * (one per document, ended by `release`). The bytes are copied first: pdf.js
 * hands its input to the worker, which would empty a buffer the caller keeps.
 */
export async function loadPdf(bytes: ArrayBuffer): Promise<LoadedPdf> {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  }
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) });
  try {
    const document = await task.promise;
    const pages = await Promise.all(Array.from({ length: document.numPages }, (_, index) => document.getPage(index + 1)));
    return { pages, release: () => task.destroy() };
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
      task.promise.catch((error: unknown) => {
        if (!(error instanceof Error && error.name === 'RenderingCancelledException')) setFailed(true);
      });
      return () => task.cancel();
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
 * resolution. It takes its container's height and scrolls inside it. The
 * pages are pictures (no text layer), so text cannot be selected here; the
 * PDF itself is the file to download for that.
 */
export function PdfPages({ pdf, label }: { pdf: LoadedPdf; label: string }) {
  const { width, measure } = useSteppedWidth();
  const pageCount = pdf.pages.length;
  return (
    <section aria-label={label} className="h-full min-h-0 overflow-y-auto rounded-xl border bg-muted/40">
      <div ref={measure} className="flex flex-col items-center gap-4 p-3 sm:p-4">
        {pdf.pages.map((page, index) => (
          <PdfSheet key={page.pageNumber} page={page} pageNo={index + 1} pageCount={pageCount} cssWidth={Math.min(width, MAX_PAGE_WIDTH_PX)} />
        ))}
      </div>
    </section>
  );
}
