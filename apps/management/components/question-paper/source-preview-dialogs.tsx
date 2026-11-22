'use client';

import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import { DocumentPreview } from '@campuspilot/components/documents/document-controls';
import { Button } from '@campuspilot/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@campuspilot/ui/components/dialog';
import { Skeleton } from '@campuspilot/ui/components/skeleton';
import { Spinner } from '@campuspilot/ui/components/spinner';
import { ToggleGroup, ToggleGroupItem } from '@campuspilot/ui/components/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@campuspilot/ui/components/tooltip';
import { cn } from '@campuspilot/ui/lib/utils';
import { ReadError } from '@/components/exam/exam-common';
import { orpc } from '@/lib/orpc';
import { questionPaperModelUrl, questionPaperOriginalUrl } from '@/lib/question-paper-pages';
import { earlierPaperTitle } from './earlier-paper-dialog';
import { pagePreviewFallback, pageTurnBlockedReason, turnedRotation, type PageRotation } from './question-paper-model';
import type { PaperTarget } from './paper-target';
import type { EarlierPaper } from './question-paper-start-model';
import { useRefreshQuestionPaper } from './use-question-paper-detail';

/** What the page viewer and the comparison beside the paper need to know of a page. */
export type PageView = {
  id: string;
  position: number;
  originalName: string;
  uploadStatus: 'awaiting' | 'stored';
  derivativeStatus: 'pending' | 'ready' | 'unsupported' | 'failed';
  rotation: PageRotation;
  derivativeRevision: number;
};

/** Turning pages in the viewer. Absent while the paper's pages cannot be changed (no permission, a completed exam). */
export type PageTurning = {
  /** The page whose turn the server is making now; null when none is. */
  turningPageId: string | null;
  /**
   * Another page change is on its way (an upload, a reorder, a removal) or a
   * turn is: each bumps the revision a turn is checked against, so the
   * buttons wait for it.
   */
  busy: boolean;
  onRotate: (pageId: string, rotation: PageRotation) => void;
};

/**
 * The page as large as the dialog allows. A page the server could decode is
 * shown as the copy the AI reads (at most 1800 px, turned as the page says),
 * so what the user checks is what the model gets, the right way up; the
 * photo as uploaded is never turned and would show the old way round. A page
 * without that copy cannot be turned, and the uploaded photo is tried
 * instead: one the server could not decode (a HEIC), one whose copy the
 * worker has not made yet, or one it could not read. When that photo cannot
 * be drawn either, {@link pagePreviewFallback} says why in the image's place.
 */
/**
 * The page large enough to read. A failed load reads the paper again
 * (`onLoadError`): a tab that held the page before someone turned it has a
 * cached redirect to the copy the turn deleted, and the fresh revision gives
 * a new URL; the image is keyed by it, so it loads again with its own alt.
 */
function PageImage({ scope, page, turning, onLoadError }: { scope: PaperTarget; page: PageView; turning: boolean; onLoadError: () => void }) {
  const ready = page.derivativeStatus === 'ready';
  return (
    <div aria-busy={turning} className="relative grid min-h-0 flex-1 place-items-center overflow-auto rounded-lg border bg-muted/40">
      {/* Keyed by page, readiness and turn: a failed load on one page never hides the next, and a page whose copy is
          made, or that was turned, is a new image with its own alt. */}
      <img
        key={`${page.id}:${page.derivativeStatus}:${page.derivativeRevision}`}
        src={ready ? questionPaperModelUrl(scope, page) : questionPaperOriginalUrl(scope, page.id)}
        alt={`Page ${page.position}`}
        className={cn('max-h-[68dvh] w-auto max-w-full object-contain transition-opacity', turning && 'opacity-40')}
        onError={(event) => {
          event.currentTarget.alt = ready ? 'This page could not be loaded. Close it and open it again.' : pagePreviewFallback(page);
          onLoadError();
        }}
      />
      {turning ? (
        <span role="status" className="absolute inset-0 grid place-items-center">
          <Spinner className="size-5" />
          <span className="sr-only">Turning the page</span>
        </span>
      ) : null}
    </div>
  );
}

/**
 * One quarter-turn button, named by its tooltip. `quiet` draws it without an
 * outline, for a place where it is not the main thing. While it must wait it
 * is `aria-disabled`, not `disabled`, so keyboard focus stays on it between
 * two turns (a focused button that becomes disabled drops focus to the page).
 */
function TurnButton({ label, icon, disabled, quiet, onClick }: { label: string; icon: ReactNode; disabled: boolean; quiet: boolean; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={quiet ? 'ghost' : 'outline'}
          size="icon-sm"
          className={cn('aria-disabled:opacity-50', quiet && 'text-muted-foreground')}
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

/**
 * Rotate left and Rotate right for the page shown: a quarter turn each, for a
 * page photographed with the phone held sideways. The server makes the page's
 * copies again from the uploaded photo (which is kept as it is), so the
 * buttons wait while a turn or another page change is on its way. A page
 * without that copy cannot be turned (yet), which is said instead.
 *
 * `quiet` is for the comparison beside the paper, where the two documents are
 * the content: the buttons lose their outline, and a page that cannot be
 * turned shows no buttons and no sentence.
 */
export function PageTurnButtons({ page, turning, quiet = false }: { page: PageView; turning: PageTurning; quiet?: boolean }) {
  const blocked = pageTurnBlockedReason(page);
  if (blocked) {
    return quiet ? null : <span className="text-xs text-muted-foreground">{blocked}</span>;
  }
  const disabled = turning.busy || turning.turningPageId !== null;
  return (
    <span className={cn('flex', quiet ? 'gap-0.5' : 'gap-1.5')}>
      <TurnButton label="Rotate left" icon={<RotateCcw aria-hidden />} disabled={disabled} quiet={quiet} onClick={() => turning.onRotate(page.id, turnedRotation(page.rotation, 'left'))} />
      <TurnButton label="Rotate right" icon={<RotateCw aria-hidden />} disabled={disabled} quiet={quiet} onClick={() => turning.onRotate(page.id, turnedRotation(page.rotation, 'right'))} />
    </span>
  );
}

/**
 * The viewer's row of actions. Previous and Next keep the row to themselves on
 * a phone; turning and removing are quiet, apart from them, and removing
 * still asks first.
 */
function PageViewerActions({
  page,
  turning,
  onRemove,
  onPrevious,
  onNext,
}: {
  page: PageView | undefined;
  turning?: PageTurning;
  onRemove?: (pageId: string) => void;
  /** Absent on the first page. */
  onPrevious?: () => void;
  /** Absent on the last page. */
  onNext?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="flex items-center gap-2 max-sm:order-last">
        {page && turning ? <PageTurnButtons page={page} turning={turning} /> : null}
        {page && onRemove ? (
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onRemove(page.id)}>
            <Trash2 aria-hidden />
            Remove page
          </Button>
        ) : null}
      </span>
      <span className="flex gap-2 max-sm:w-full max-sm:justify-between">
        <Button type="button" variant="outline" size="sm" disabled={!onPrevious} onClick={onPrevious}>
          <ChevronLeft aria-hidden />
          Previous
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={!onNext} onClick={onNext}>
          Next
          <ChevronRight aria-hidden />
        </Button>
      </span>
    </div>
  );
}

/**
 * One photographed page large enough to read, so the user can check it is the
 * right page, the right way up and complete before a paper is made from it
 * (see {@link PageImage} for which image that is). A page lying on its side is
 * turned here ({@link PageTurnButtons}). Previous and next move through the
 * paper's pages.
 */
export function PagePreviewDialog({
  scope,
  pages,
  pageId,
  onPageChange,
  onRemove,
  turning,
}: {
  scope: PaperTarget;
  pages: readonly PageView[];
  /** The page shown; null closes the dialog. */
  pageId: string | null;
  onPageChange: (pageId: string | null) => void;
  /** Asks to remove the page shown (the caller confirms first); absent while pages cannot be changed. */
  onRemove?: (pageId: string) => void;
  /** Turning the page shown; absent while pages cannot be changed. */
  turning?: PageTurning;
}) {
  const index = pages.findIndex((page) => page.id === pageId);
  const page = pages[index];
  const go = (step: number) => onPageChange(pages[index + step]?.id ?? null);
  const refresh = useRefreshQuestionPaper(scope);
  return (
    <Dialog open={page !== undefined} onOpenChange={(open) => (open ? undefined : onPageChange(null))}>
      {/* Focus goes to the dialog itself, not to "Previous": nothing should look pre-selected when a page opens. */}
      <DialogContent
        className="flex max-h-[92dvh] flex-col sm:max-w-3xl"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement).focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{page ? `Page ${page.position} of ${pages.length}` : 'Page'}</DialogTitle>
          {/* The file's name means nothing to the reader (a scanner's or a camera's), so it is said to assistive technology only. */}
          <DialogDescription className="sr-only">{page?.originalName}</DialogDescription>
        </DialogHeader>
        {page ? <PageImage scope={scope} page={page} turning={turning?.turningPageId === page.id} onLoadError={() => void refresh()} /> : null}
        <PageViewerActions page={page} turning={turning} onRemove={onRemove} onPrevious={index > 0 ? () => go(-1) : undefined} onNext={index >= 0 && index < pages.length - 1 ? () => go(1) : undefined} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * One control with two states, so which one is on is plain: for a phone,
 * where two things that sit side by side on a wide screen (or a page and its
 * larger form) take turns in one frame. As wide as its container.
 */
export function TwoWaySwitch<V extends string>({
  label,
  value,
  options,
  onValueChange,
  className,
}: {
  /** What the switch chooses, for assistive technology. */
  label: string;
  value: V;
  options: readonly [{ value: V; label: string }, { value: V; label: string }];
  onValueChange: (value: V) => void;
  className?: string;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      spacing={0}
      aria-label={label}
      className={cn('w-full', className)}
      value={value}
      onValueChange={(next) => {
        // Pressing the chosen side again leaves it chosen (a single toggle group would otherwise clear).
        const chosen = options.find((option) => option.value === next);
        if (chosen) onValueChange(chosen.value);
      }}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          className="h-9 flex-1 text-muted-foreground data-[state=on]:bg-secondary data-[state=on]:font-semibold data-[state=on]:text-foreground"
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** The earlier paper as it prints, read only when the dialog is open. */
function EarlierPaperPreview({ earlier, actualSize }: { earlier: EarlierPaper; actualSize: boolean }) {
  const preview = useQuery(orpc.school.getQuestionPaperPreview.queryOptions({ input: { ...earlier.key, versionNo: earlier.versionNo } }));
  // Held data wins over a failed refetch, so the paper never blanks under the user.
  if (preview.data === undefined) {
    return preview.isPending ? <Skeleton className="h-full w-full rounded-xl" /> : <ReadError error={preview.error} retry={preview.refetch} />;
  }
  return <DocumentPreview html={preview.data.html} label="Earlier question paper" fitPageWidth fill actualSize={actualSize} />;
}

/**
 * Shows the earlier paper that was chosen, as it prints, so the user can see
 * it is the right one before it is copied. On a phone the whole page fitted
 * to the screen is too small to read, so there the page can be switched to
 * its real size, which pans sideways.
 */
export function EarlierPaperPreviewDialog({ earlier, open, onOpenChange }: { earlier: EarlierPaper; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [actualSize, setActualSize] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[88dvh] flex-col sm:max-w-3xl"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement).focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{earlierPaperTitle(earlier)}</DialogTitle>
          <DialogDescription>This paper will be copied. Scroll to read it.</DialogDescription>
        </DialogHeader>
        <TwoWaySwitch
          label="Page size"
          className="sm:hidden"
          value={actualSize ? 'actual' : 'fit'}
          options={[
            { value: 'fit', label: 'Whole page' },
            { value: 'actual', label: 'Larger text' },
          ]}
          onValueChange={(value) => setActualSize(value === 'actual')}
        />
        <div className="min-h-0 flex-1">{open ? <EarlierPaperPreview earlier={earlier} actualSize={actualSize} /> : null}</div>
      </DialogContent>
    </Dialog>
  );
}
