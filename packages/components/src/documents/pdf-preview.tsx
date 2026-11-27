'use client';

import { Button } from '@campuspilot/ui/components/button';
import { Skeleton } from '@campuspilot/ui/components/skeleton';
import { Spinner } from '@campuspilot/ui/components/spinner';
import { cn } from '@campuspilot/ui/lib/utils';
import { RotateCcw } from 'lucide-react';

import { PdfPages, type LoadedPdf } from './pdf-pages';

export type PdfPreviewProps = {
  /**
   * The document to draw, opened with `loadPdf`. It may be an earlier render
   * while a newer one is on its way (`updating`), so the pages never blank
   * between two renders. Null until the first one arrives. The owner releases
   * it (in the app, the query cache does when it drops the query).
   */
  pdf: LoadedPdf | null;
  /** Names the pages for assistive technology ("Receipt template preview"). */
  label: string;
  /** The shape of the page the loading skeleton draws (a timetable prints on landscape A4). */
  orientation?: 'portrait' | 'landscape';
  /** A newer render is on its way: the pages on screen stay, with a quiet badge. */
  updating?: boolean;
  /** Why the latest render failed, in a sentence; shown over the pages, or alone when there are none yet. */
  error?: string | null;
  /** Renders again; offered beside the error. */
  onRetry?: () => void;
  className?: string;
};

/** A4's sides, so the skeleton has the shape of the page that will replace it. */
const A4_ASPECT = { portrait: '210 / 297', landscape: '297 / 210' } as const;

/** One blank sheet in the pages' own frame while the first render is on its way. */
function PdfPreviewSkeleton({ orientation, label }: { orientation: 'portrait' | 'landscape'; label: string }) {
  return (
    <div role="status" aria-label={`${label}: loading`} className="flex h-full min-h-0 flex-col items-center overflow-hidden rounded-xl border bg-muted/40 p-3 sm:p-4">
      <Skeleton className="w-full max-w-[60rem] shrink-0 rounded-sm" style={{ aspectRatio: A4_ASPECT[orientation] }} />
    </div>
  );
}

/** Why the render failed, with the way to try again. */
function PdfPreviewError({ message, onRetry, floating }: { message: string; onRetry?: () => void; floating: boolean }) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 text-sm text-destructive',
        floating && 'absolute inset-x-3 top-3 z-10 shadow-md sm:inset-x-4 sm:top-4',
      )}
    >
      <p className="min-w-0 flex-1 break-words">{message}</p>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <RotateCcw data-icon="inline-start" aria-hidden /> Try again
        </Button>
      ) : null}
    </div>
  );
}

/**
 * A document preview as the PDF it prints as: the same pdf.js pages, page
 * chrome and scrolling as a question paper's saved version (`PdfPages`), with
 * the states a live preview needs around them: a page-shaped skeleton before
 * the first render, the previous pages kept on screen (with an "Updating"
 * badge) while a newer render is on its way, and a failed render said over
 * the pages with Try again. It takes its container's height and scrolls
 * inside it, so it fits a pane, a tab or a full-screen dialog alike.
 *
 * Presentational: the caller turns its source into bytes (a template draft,
 * a marketplace design, a stored version) and opens them with `loadPdf`; this
 * component makes no request.
 */
export function PdfPreview({ pdf, label, orientation = 'portrait', updating = false, error = null, onRetry, className }: PdfPreviewProps) {
  if (!pdf) {
    return (
      <div className={cn('h-full min-h-0', className)}>
        {error ? <PdfPreviewError message={error} onRetry={onRetry} floating={false} /> : <PdfPreviewSkeleton orientation={orientation} label={label} />}
      </div>
    );
  }
  return (
    <div className={cn('relative h-full min-h-0', className)} aria-busy={updating}>
      <PdfPages pdf={pdf} label={label} />
      {error ? (
        <PdfPreviewError message={error} onRetry={onRetry} floating />
      ) : updating ? (
        <p
          role="status"
          className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-full border bg-background/95 px-2.5 py-1 text-xs text-muted-foreground shadow-sm sm:right-4 sm:top-4"
        >
          <Spinner className="size-3" /> Updating preview…
        </p>
      ) : null}
    </div>
  );
}
