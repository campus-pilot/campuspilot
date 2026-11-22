'use client';

import { useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import { editBlockedReason } from '@campuspilot/components/question-paper/question-paper-model';
import { Button } from '@campuspilot/ui/components/button';
import { Skeleton } from '@campuspilot/ui/components/skeleton';
import { Spinner } from '@campuspilot/ui/components/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@campuspilot/ui/components/tooltip';
import { cn } from '@campuspilot/ui/lib/utils';
import { Notice, ReadError } from '@/components/exam/exam-common';
import { questionPaperModelUrl, questionPaperOriginalUrl } from '@/lib/question-paper-pages';
import { comparePageIndex, inFlightJob, pagePreviewFallback, PHOTO_ZOOM, scrollAfterZoom, uploadsInFlight } from './question-paper-model';
import type { PaperTarget } from './paper-target';
import { PageTurnButtons, type PageTurning, type PageView } from './source-preview-dialogs';
import type { PageUploads } from './use-page-uploads';
import { pageTurningOf, useRefreshQuestionPaper, useRotatePage, type QuestionPaperDetail } from './use-question-paper-detail';

/** A page as the comparison draws it: with its size (as turned), so the place it loads into already has its shape. */
type ComparePage = PageView & { width: number | null; height: number | null };

/** The shape a page loads into: its own once the server measured it, else a portrait sheet of paper. */
const pageShapeOf = (page: ComparePage) => (page.width && page.height ? `${page.width} / ${page.height}` : '210 / 297');

/**
 * A small control of the photo's bar, named by its tooltip. Quiet on purpose:
 * the two documents are the content. An unavailable control is
 * `aria-disabled`, not `disabled`, so keyboard focus stays on it (a focused
 * button that becomes disabled drops focus to the page, and ←/→ on the pane
 * stop working).
 */
function BarButton({ label, icon, disabled = false, onClick }: { label: string; icon: ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground aria-disabled:opacity-50"
          aria-label={label}
          aria-disabled={disabled || undefined}
          onClick={disabled ? undefined : onClick}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** What stands in a photo's place when it cannot be drawn: the app's read error with a retry, or why there is nothing to retry. */
function PhotoUnavailable({ decoded, fallback, onRetry }: { decoded: boolean; fallback: string; onRetry: () => void }) {
  return (
    <div className="p-3">
      {decoded ? (
        <ReadError error={new Error('This page could not be loaded.')} retry={onRetry} />
      ) : (
        // A page without a copy to show (a HEIC, one not made yet, or a photo that could not be read): the browser was asked to draw
        // the upload and could not, or there is none yet.
        <Notice>{fallback}</Notice>
      )}
    </div>
  );
}

/**
 * One photographed page, as wide as the pane (or {@link PHOTO_ZOOM} times
 * that when zoomed, which the pane then pans by scrolling). It is the copy
 * the AI read (the `model` derivative, turned as the page says), like the
 * page viewer, so what is read against the paper is what the paper was made
 * from; a page without such a copy (one the server could not decode, or
 * whose copy the worker has not made yet) shows the upload instead.
 *
 * Whether the image arrived is this component's own state, and the caller
 * keys it by page, readiness and turn, so each one starts as a skeleton of the page's
 * shape: no effect watches the address of the image.
 */
function PhotoImage({
  scope,
  page,
  count,
  zoomed,
  dimmed,
  onPress,
  onLoadError,
}: {
  scope: PaperTarget;
  page: ComparePage;
  count: number;
  zoomed: boolean;
  /** The page is being turned: what is shown is about to be replaced. */
  dimmed: boolean;
  /** The photo was pressed at this point of the window. */
  onPress: (point: { x: number; y: number }) => void;
  /**
   * The image failed to load. The paper is read again: a tab that held the
   * page before someone turned it has a cached redirect to the copy the turn
   * deleted, and the fresh page's revision gives a new URL (this image is
   * keyed by it, so it loads again).
   */
  onLoadError: () => void;
}) {
  const [load, setLoad] = useState<{ status: 'loading' | 'shown' | 'failed'; attempt: number }>({ status: 'loading', attempt: 0 });
  const decoded = page.derivativeStatus === 'ready';
  if (load.status === 'failed') {
    return (
      <PhotoUnavailable
        decoded={decoded}
        fallback={pagePreviewFallback(page)}
        onRetry={() => {
          onLoadError();
          setLoad((current) => ({ status: 'loading', attempt: current.attempt + 1 }));
        }}
      />
    );
  }
  return (
    <>
      {load.status === 'loading' ? <Skeleton className="max-h-full w-full rounded-none" style={{ aspectRatio: pageShapeOf(page) }} /> : null}
      {/* Pressing the photo is the pointer's way to zoom; the bar's zoom button is the same action for the keyboard. */}
      <img
        key={load.attempt}
        src={decoded ? questionPaperModelUrl(scope, page) : questionPaperOriginalUrl(scope, page.id)}
        alt={`Page ${page.position} of ${count}`}
        draggable={false}
        className={cn(
          'bg-white transition-opacity',
          load.status === 'shown' ? 'block' : 'hidden',
          zoomed ? 'w-[200%] max-w-none cursor-zoom-out' : 'w-full cursor-zoom-in',
          dimmed && 'opacity-40',
        )}
        onLoad={() => setLoad((current) => ({ ...current, status: 'shown' }))}
        onError={() => {
          setLoad((current) => ({ ...current, status: 'failed' }));
          onLoadError();
        }}
        onClick={(event) => onPress({ x: event.clientX, y: event.clientY })}
      />
    </>
  );
}

/**
 * Where the photo is drawn: it scrolls inside the pane, on its own. The paper
 * beside it does not follow, because a photographed page and a printed page
 * do not hold the same lines. The scrolling box takes focus, so the keyboard
 * scrolls it, and it outlives the photos shown in it, so stepping to the next
 * page keeps the focus.
 */
function PhotoSheet({ scroller, label, turning, children }: { scroller: RefObject<HTMLDivElement | null>; label: string; turning: boolean; children: ReactNode }) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        role="group"
        aria-label={label}
        aria-busy={turning}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        {children}
      </div>
      {turning ? (
        <span role="status" className="pointer-events-none absolute inset-0 grid place-items-center">
          <Spinner className="size-5" />
          <span className="sr-only">Turning the page</span>
        </span>
      ) : null}
    </div>
  );
}

/** Which page is shown, with the way to the ones beside it. A paper of one page has nowhere to step to. */
function PhotoStepper({ position, count, onStep }: { position: number; count: number; onStep: (by: number) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      {count > 1 ? <BarButton label="Previous page" icon={<ChevronLeft aria-hidden />} disabled={position <= 1} onClick={() => onStep(-1)} /> : null}
      <span aria-live="polite" className="min-w-12 text-center text-xs tabular-nums text-muted-foreground">
        <span className="sr-only">Page </span>
        {position} of {count}
      </span>
      {count > 1 ? <BarButton label="Next page" icon={<ChevronRight aria-hidden />} disabled={position >= count} onClick={() => onStep(1)} /> : null}
    </div>
  );
}

/** The strip under the photo: zoom at one end, the pages in the middle, turning (when the pages may be changed) at the other. */
function PhotoBar({ zoom, stepper, turn }: { zoom: ReactNode; stepper: ReactNode; turn: ReactNode }) {
  return (
    <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-t bg-card px-2 py-1">
      <span className="flex justify-self-start">{zoom}</span>
      {stepper}
      <span className="flex justify-self-end">{turn}</span>
    </div>
  );
}

/**
 * The paper's photographed pages, one at a time, in a frame like the paper's
 * own preview: the page fitted to the pane's width, a strip under it to step
 * through the pages, zoom and (for someone who may change the pages) turn the
 * one shown.
 *
 * - **Pages.** The page shown is this pane's own state (it is not in the
 *   address): the one stepped to while it is still a page of the paper, else
 *   the first. Left and Right step through the pages while the pane has
 *   focus.
 * - **Zoom.** Pressing the photo, or the zoom button, switches between the
 *   page fitted to the pane and {@link PHOTO_ZOOM} times that, which is then
 *   panned by scrolling. While zoomed, Left and Right pan like the other
 *   arrows instead of stepping. Zoom stays on from page to page: someone
 *   reading handwriting reads the next page the same way.
 */
function PhotoPane({ scope, pages, turning }: { scope: PaperTarget; pages: readonly ComparePage[]; turning?: PageTurning }) {
  const [pageId, setPageId] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const refresh = useRefreshQuestionPaper(scope);
  const index = comparePageIndex(pages.map((candidate) => candidate.id), pageId);
  const page = pages[index];
  if (!page) return null;
  const step = (by: number) => {
    const next = pages[index + by];
    if (!next) return;
    setPageId(next.id);
    scroller.current?.scrollTo(0, 0);
  };
  /**
   * Zooms about a point of the window (where the photo was pressed), or about
   * the middle of what is in view for the button. The pane can only be
   * scrolled to the new place once the photo has its new size, so that size
   * is committed first, inside this press: no effect has to run afterwards.
   */
  const toggleZoom = (point?: { x: number; y: number }) => {
    const pane = scroller.current;
    if (!pane) return;
    const box = pane.getBoundingClientRect();
    const pointer = point ? { x: point.x - box.left, y: point.y - box.top } : { x: pane.clientWidth / 2, y: pane.clientHeight / 2 };
    const next = scrollAfterZoom({ x: pane.scrollLeft, y: pane.scrollTop }, pointer, zoomed ? 1 / PHOTO_ZOOM : PHOTO_ZOOM);
    flushSync(() => setZoomed(!zoomed));
    pane.scrollTo(next.x, next.y);
  };
  const stepWithArrows = (event: KeyboardEvent<HTMLElement>) => {
    if (zoomed || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    step(event.key === 'ArrowLeft' ? -1 : 1);
  };
  return (
    <section aria-label="Uploaded photos" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-muted/30" onKeyDown={stepWithArrows}>
      <PhotoSheet scroller={scroller} label={`Photo of page ${page.position}`} turning={turning?.turningPageId === page.id}>
        {/* Keyed by page, readiness and turn: a page whose copy is made, or that was turned, is a new image, and a failed load
            on one page never hides the next. */}
        <PhotoImage
          key={`${page.id}:${page.derivativeStatus}:${page.derivativeRevision}`}
          scope={scope}
          page={page}
          count={pages.length}
          zoomed={zoomed}
          dimmed={turning?.turningPageId === page.id}
          onPress={toggleZoom}
          onLoadError={() => void refresh()}
        />
      </PhotoSheet>
      <PhotoBar
        zoom={<BarButton label={zoomed ? 'Fit to width' : 'Zoom in'} icon={zoomed ? <ZoomOut aria-hidden /> : <ZoomIn aria-hidden />} onClick={() => toggleZoom()} />}
        stepper={<PhotoStepper position={index + 1} count={pages.length} onStep={step} />}
        turn={turning ? <PageTurnButtons page={page} turning={turning} quiet /> : null}
      />
    </section>
  );
}

/**
 * The photographed pages beside the paper, so a teacher can read what was
 * typed against what was written ({@link PhotoPane}).
 *
 * A page lying on its side is turned here too, by the same request as in the
 * page viewer and under the same conditions: only someone who may change the
 * pages of a paper that can still change, not while a generation is reading
 * them, and never while a photo is still uploading or another turn is on its
 * way (each bumps the revision a turn is checked against). Reordering and
 * removing pages happen on the photos card, which is not on screen with the
 * paper; the server's revision check still covers a change made elsewhere.
 */
export function PaperPhotoCompare({ scope, detail, canManage, uploads }: { scope: PaperTarget; detail: QuestionPaperDetail; canManage: boolean; uploads: PageUploads }) {
  const rotate = useRotatePage(scope);
  const { paper } = detail;
  const closed =
    editBlockedReason({
      examCompleted: paper.examCompleted,
      sessionActive: paper.sessionActive,
      canManage,
      jobActive: inFlightJob(detail.activeJob) !== null,
    }) !== null;
  return (
    <uploads.form.Subscribe selector={(state) => uploadsInFlight(state.values.items) > 0}>
      {(uploading) => <PhotoPane scope={scope} pages={detail.pages} turning={closed ? undefined : pageTurningOf(rotate, paper.pageRevision, uploading)} />}
    </uploads.form.Subscribe>
  );
}
