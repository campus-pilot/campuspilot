'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { DocumentPreview } from '@campuspilot/components/documents/document-controls';
import { Button } from '@campuspilot/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@campuspilot/ui/components/dialog';
import { Skeleton } from '@campuspilot/ui/components/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@campuspilot/ui/components/toggle-group';
import { ReadError } from '@/components/exam/exam-common';
import { orpc } from '@/lib/orpc';
import { questionPaperOriginalUrl, questionPaperThumbUrl } from '@/lib/question-paper-pages';
import { earlierPaperTitle } from './earlier-paper-dialog';
import type { QuestionPaperScope } from './question-paper-model';
import type { EarlierPaper } from './question-paper-start-model';

type PageView = { id: string; position: number; originalName: string; derivativeStatus: 'ready' | 'unsupported' };

/**
 * One photographed page large enough to read, so the user can check it is the
 * right page, the right way up and complete before a paper is made from it.
 * It shows the uploaded photo itself; a photo this browser cannot draw (a
 * HEIC original) falls back to the server's smaller copy, and a page with no
 * copy at all says so. Previous and next move through the paper's pages.
 */
export function PagePreviewDialog({
  scope,
  pages,
  pageId,
  onPageChange,
  onRemove,
}: {
  scope: QuestionPaperScope;
  pages: readonly PageView[];
  /** The page shown; null closes the dialog. */
  pageId: string | null;
  onPageChange: (pageId: string | null) => void;
  /** Asks to remove the page shown (the caller confirms first); absent while pages cannot be changed. */
  onRemove?: (pageId: string) => void;
}) {
  const index = pages.findIndex((page) => page.id === pageId);
  const page = pages[index];
  const go = (step: number) => onPageChange(pages[index + step]?.id ?? null);
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
        {page ? (
          <div className="grid min-h-0 flex-1 place-items-center overflow-auto rounded-lg border bg-muted/40">
            {/* Keyed by page so a failed load on one page never hides the next. */}
            <img
              key={page.id}
              src={questionPaperOriginalUrl(scope, page.id)}
              alt={`Page ${page.position}`}
              className="max-h-[68dvh] w-auto max-w-full object-contain"
              onError={(event) => {
                const thumb = questionPaperThumbUrl(scope, page.id);
                // The smaller copy exists only for a photo the server could decode; try it once.
                if (page.derivativeStatus === 'ready' && event.currentTarget.src !== thumb) event.currentTarget.src = thumb;
                else event.currentTarget.alt = 'This photo cannot be shown here. The AI can still read it.';
              }}
            />
          </div>
        ) : null}
        {/* Previous and Next keep the row to themselves on a phone; removing is quiet, apart from them, and still asks first. */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {page && onRemove ? (
            <Button type="button" variant="ghost" size="sm" className="text-muted-foreground max-sm:order-last max-sm:-ms-2" onClick={() => onRemove(page.id)}>
              <Trash2 aria-hidden />
              Remove page
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2 max-sm:w-full max-sm:justify-between">
            <Button type="button" variant="outline" size="sm" className="max-sm:h-11 max-sm:px-4" disabled={index <= 0} onClick={() => go(-1)}>
              <ChevronLeft aria-hidden />
              Previous
            </Button>
            <Button type="button" variant="outline" size="sm" className="max-sm:h-11 max-sm:px-4" disabled={index < 0 || index >= pages.length - 1} onClick={() => go(1)}>
              Next
              <ChevronRight aria-hidden />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
        {/* One control with two states, so which one is on is plain: the whole page, or its text at real size. */}
        <ToggleGroup
          type="single"
          variant="outline"
          spacing={0}
          aria-label="Page size"
          className="w-full sm:hidden"
          value={actualSize ? 'actual' : 'fit'}
          onValueChange={(value) => {
            // Pressing the chosen side again leaves it chosen (a single toggle group would otherwise clear).
            if (value) setActualSize(value === 'actual');
          }}
        >
          <ToggleGroupItem value="fit" className="h-9 flex-1 text-muted-foreground data-[state=on]:bg-secondary data-[state=on]:font-semibold data-[state=on]:text-foreground">
            Whole page
          </ToggleGroupItem>
          <ToggleGroupItem value="actual" className="h-9 flex-1 text-muted-foreground data-[state=on]:bg-secondary data-[state=on]:font-semibold data-[state=on]:text-foreground">
            Larger text
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="min-h-0 flex-1">{open ? <EarlierPaperPreview earlier={earlier} actualSize={actualSize} /> : null}</div>
      </DialogContent>
    </Dialog>
  );
}
