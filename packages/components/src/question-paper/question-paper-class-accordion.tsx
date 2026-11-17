import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@campuspilot/ui/components/accordion';
import {
  QuestionPaperClassTable,
  type QuestionPaperCellRef,
  type QuestionPaperClassView,
} from './question-paper-class-table';
import { paperClassSummary, paperClassSummaryLabel, type PaperClassEmptyReason } from './question-paper-model';

/** A class as the accordion shows it: its (filtered) rows and why it has none, if it has none. */
export type QuestionPaperAccordionClass = QuestionPaperClassView & { emptyReason: PaperClassEmptyReason };

/** The one row of an empty class, by why it is empty (`applyModeFilter`). */
const EMPTY_MESSAGE: Record<Exclude<PaperClassEmptyReason, null>, string> = {
  'no-subjects': 'This class has no subjects in the examination plan.',
  'no-matching-modes': 'No papers match the selected modes.',
};

type ClassAccordionProps = {
  classes: readonly QuestionPaperAccordionClass[];
  /** The open class, or null for none. An id that is not in `classes` opens nothing. */
  openClassId: string | null;
  /** Called with the class to open, or null when the open class is collapsed. */
  onOpenClassChange: (classId: string | null) => void;
  hrefOf: (cell: QuestionPaperCellRef) => string;
  onOpen: (cell: QuestionPaperCellRef) => void;
};

/**
 * The classes of an examination's Question paper tab, one open at a time.
 * The caller owns which class is open (the page keeps it in the address), so
 * a reload or a shared link opens the same class.
 *
 * A closed class's content is unmounted (Radix's default, no `forceMount`):
 * only the open class's paper links are in the document, so the voice
 * assistant's "open what I can see" finds the papers of the open class only.
 * That is deliberate; it matches what the person sees. The trigger's summary
 * is computed from the rows the class shows (after the mode filter), so it
 * describes what opening the class reveals.
 */
export function QuestionPaperClassAccordion({ classes, openClassId, onOpenClassChange, hrefOf, onOpen }: ClassAccordionProps) {
  return (
    <Accordion
      type="single"
      collapsible
      value={openClassId ?? ''}
      onValueChange={(value) => onOpenClassChange(value === '' ? null : value)}
    >
      {classes.map((classView) => (
        <AccordionItem key={classView.classId} value={classView.classId} className="data-open:bg-transparent">
          <AccordionTrigger className="items-center px-3 hover:no-underline">
            <ClassTriggerLabel classView={classView} />
          </AccordionTrigger>
          <AccordionContent className="px-1 [&_a]:no-underline">
            <QuestionPaperClassTable
              classView={classView}
              hrefOf={hrefOf}
              onOpen={onOpen}
              emptyMessage={classView.emptyReason ? EMPTY_MESSAGE[classView.emptyReason] : undefined}
            />
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

/** The class's name with what its shown rows hold ("3 of 8 ready · 1 generating"). */
function ClassTriggerLabel({ classView }: { classView: QuestionPaperAccordionClass }) {
  return (
    <span className="flex min-w-0 flex-col items-start gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
      <span className="text-sm font-semibold">{classView.className}</span>
      <span className="text-xs font-normal text-muted-foreground">{paperClassSummaryLabel(paperClassSummary(classView))}</span>
    </span>
  );
}
