import type { MouseEvent } from 'react';
import { Badge } from '@campuspilot/ui/components/badge';
import { Button } from '@campuspilot/ui/components/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@campuspilot/ui/components/table';
import { cellStatus, type CellStatus, type CellStatusKind, type PaperCellInput } from './question-paper-model';

export type QuestionPaperModeView = {
  modeSlug: string;
  modeName: string;
  maxMarks: number;
  paper: PaperCellInput;
};
export type QuestionPaperSubjectView = {
  subjectSlug: string;
  subjectName: string;
  modes: QuestionPaperModeView[];
};
export type QuestionPaperClassView = {
  classId: string;
  className: string;
  canManage: boolean;
  subjects: QuestionPaperSubjectView[];
};
export type QuestionPaperCellRef = { classId: string; subjectSlug: string; modeSlug: string };

const STATUS_BADGE: Record<CellStatusKind, 'outline' | 'secondary' | 'default' | 'destructive'> = {
  empty: 'outline',
  pages: 'secondary',
  generating: 'default',
  failed: 'destructive',
  ready: 'secondary',
  warning: 'outline',
};

/** One status badge with its optional second line (the safe failure message). */
export function QuestionPaperCellStatus({ status }: { status: CellStatus }) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <Badge variant={STATUS_BADGE[status.kind]}>{status.label}</Badge>
      {status.detail ? <span className="max-w-64 text-xs text-muted-foreground">{status.detail}</span> : null}
    </div>
  );
}

/** Whether a click on a link opens it somewhere else (a new tab or window) and is left to the browser. */
const opensElsewhere = (event: MouseEvent<HTMLAnchorElement>) =>
  event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;

function ModeRow({
  classView,
  subject,
  mode,
  hrefOf,
  onOpen,
}: {
  classView: QuestionPaperClassView;
  subject: QuestionPaperSubjectView;
  mode: QuestionPaperModeView;
  hrefOf: (cell: QuestionPaperCellRef) => string;
  onOpen: (cell: QuestionPaperCellRef) => void;
}) {
  const cell = { classId: classView.classId, subjectSlug: subject.subjectSlug, modeSlug: mode.modeSlug };
  return (
    <TableRow>
      <TableCell className="sticky left-0 z-10 bg-background font-medium">{subject.subjectName}</TableCell>
      <TableCell>{mode.modeName}</TableCell>
      <TableCell className="tabular-nums">{mode.maxMarks}</TableCell>
      <TableCell>
        <QuestionPaperCellStatus status={cellStatus(mode.paper)} />
      </TableCell>
      <TableCell className="text-right">
        {/*
          A real link, not a button: it opens in a new tab like any link, and
          the voice assistant's "open what I can see" follows links only (a
          button may do something). Its accessible name says which paper it
          is, so "open English written for Nursery" finds this one.
        */}
        <Button asChild size="sm" variant="outline">
          <a
            href={hrefOf(cell)}
            aria-label={`Open ${subject.subjectName} ${mode.modeName} for ${classView.className}`}
            onClick={(event) => {
              if (opensElsewhere(event)) return;
              event.preventDefault();
              onOpen(cell);
            }}
          >
            {classView.canManage ? 'Open' : 'View'}
          </a>
        </Button>
      </TableCell>
    </TableRow>
  );
}

/**
 * The subjects and assessment modes of one class with the state of each paper.
 * The first column stays in view while the table scrolls sideways on a phone.
 */
export function QuestionPaperClassTable({
  classView,
  hrefOf,
  onOpen,
}: {
  classView: QuestionPaperClassView;
  /** Where a paper's workspace is. */
  hrefOf: (cell: QuestionPaperCellRef) => string;
  /** Goes to a paper without reloading the page, for a plain click on its link. */
  onOpen: (cell: QuestionPaperCellRef) => void;
}) {
  const rows = classView.subjects.flatMap((subject) => subject.modes.map((mode) => ({ subject, mode })));
  return (
    <section className="flex min-w-0 flex-col gap-2" aria-label={`${classView.className} question papers`}>
      <h2 className="text-sm font-semibold">{classView.className}</h2>
      <div className="min-w-0 rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 z-10 bg-background">Subject</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Max marks</TableHead>
              <TableHead>Paper</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ subject, mode }) => (
              <ModeRow
                key={`${subject.subjectSlug}/${mode.modeSlug}`}
                classView={classView}
                subject={subject}
                mode={mode}
                hrefOf={hrefOf}
                onOpen={onOpen}
              />
            ))}
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  This class has no subjects in the examination plan.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
