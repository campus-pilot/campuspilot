'use client';

import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@campuspilot/ui/components/dialog';
import { Skeleton } from '@campuspilot/ui/components/skeleton';
import { ReadError } from '@/components/exam/exam-common';
import { orpc } from '@/lib/orpc';
import type { QuestionPaperScope } from './question-paper-model';
import type { EarlierPaper } from './question-paper-start-model';

const savedOn = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** What an earlier paper is called: its examination and its mode, the two things that tell it from the paper being made. */
export const earlierPaperTitle = (paper: EarlierPaper) => `${paper.examName} · ${paper.modeName}`;

/** One line that places an earlier paper: its session, its version, the marks it was written for and when it was saved. */
export const earlierPaperDetail = (paper: EarlierPaper) =>
  [paper.sessionLabel, `Version ${paper.versionNo}`, paper.planMaxMarks === null ? null : `${paper.planMaxMarks} marks`, `Saved ${savedOn.format(paper.savedAt)}`]
    .filter((part): part is string => part !== null)
    // Each part stays whole when the line wraps (never "Saved 10" / "Nov 2026"): the spaces inside a part do not break.
    .map((part) => part.replaceAll(' ', '\u00a0'))
    .join(' · ');

/** The school's saved papers of this class and subject, one row each; choosing a row is the whole interaction. */
function EarlierPaperList({ scope, emptyText, onChoose }: { scope: QuestionPaperScope; emptyText: string; onChoose: (paper: EarlierPaper) => void }) {
  const sources = useQuery(orpc.school.listQuestionPaperCopySources.queryOptions({ input: scope }));
  // Held data wins over a failed refetch, so the list never blanks under the user.
  if (sources.data === undefined) {
    return sources.isPending ? <Skeleton className="h-28 w-full rounded-lg" /> : <ReadError error={sources.error} retry={sources.refetch} />;
  }
  if (sources.data.sources.length === 0) {
    return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }
  return (
    <ul className="flex max-h-[55dvh] flex-col divide-y overflow-y-auto rounded-lg border">
      {sources.data.sources.map((source) => {
        const paper: EarlierPaper = {
          key: source.key,
          versionNo: source.latestVersionNo,
          examName: source.examName,
          sessionLabel: source.sessionLabel,
          modeName: source.modeName,
          savedAt: source.savedAt,
          planMaxMarks: source.planMaxMarks,
        };
        return (
          <li key={`${source.key.sessionId}/${source.key.examSlug}/${source.key.modeSlug}`}>
            <button
              type="button"
              onClick={() => onChoose(paper)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium">{earlierPaperTitle(paper)}</span>
                <span className="text-xs text-muted-foreground">{earlierPaperDetail(paper)}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Chooses an earlier paper to start from: the papers the school already saved
 * for this class and subject (any exam, session and mode). Choosing one only
 * puts it in the card; the copy is made when the paper is created, and the
 * earlier paper is never changed.
 */
export function EarlierPaperDialog({
  scope,
  className,
  subjectName,
  open,
  onOpenChange,
  onChoose,
}: {
  scope: QuestionPaperScope;
  className: string;
  subjectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: (paper: EarlierPaper) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Nothing is pre-focused: a ring on the close button would look like a selection. */}
      <DialogContent
        className="sm:max-w-lg"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement).focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Copy an earlier paper</DialogTitle>
          <DialogDescription>
            Papers saved for {className} {subjectName}. A copy is made; the old paper stays as it is.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so the list is read when it is asked for and is fresh each time. */}
        {open ? <EarlierPaperList scope={scope} emptyText={`No earlier paper is saved for ${className} ${subjectName} yet.`} onChoose={onChoose} /> : null}
      </DialogContent>
    </Dialog>
  );
}
