'use client';

import { createContext, useCallback, useContext, useId, useMemo, type ReactNode } from 'react';
import { useForm } from '@tanstack/react-form';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@campuspilot/ui/components/button';
import { Checkbox } from '@campuspilot/ui/components/checkbox';
import { DataTable, type DataTableColumnDef } from '../data-grid';

type ReviewMode = {
  slug: string;
  name: string;
  percentage: number;
  maxMarks: number;
};
type ReviewSubject = {
  subjectSlug: string;
  name: string;
  issue: string | null;
  modes: ReviewMode[];
};
export type ReviewClass = {
  classId: string;
  label: string;
  studentCount: number;
  subjects: ReviewSubject[];
};

/**
 * Which classes are chosen to take part. `selectable` decides whether a
 * class's checkbox can change; `baseline` (when editing an existing plan) is
 * the classes taking part now, so each row can say whether saving adds or
 * removes it.
 */
export type ReviewSelection = {
  selected: readonly string[];
  baseline?: readonly string[];
  disabled?: boolean;
  selectable: (schoolClass: ReviewClass) => boolean;
  onToggle: (classId: string, checked: boolean) => void;
};

/**
 * Which subjects of each class get a plan. `chosen(classId)` is the class's
 * chosen subject slugs, or `undefined` when that class's subjects are not
 * chosen here (they are then listed without checkboxes, for example a class
 * already taking part when editing the classes of an existing plan).
 */
export type ReviewSubjectSelection = {
  chosen: (classId: string) => readonly string[] | undefined;
  disabled?: boolean;
  onToggle: (classId: string, subjectSlug: string, checked: boolean) => void;
};

/**
 * What the cells read, so the column definitions stay stable while the
 * selection changes. `renderAddSubject` is the caller's gated Add subject
 * control for a class (this package makes no API calls); without it no such
 * control is shown.
 */
type ReviewContextValue = {
  selection: ReviewSelection | null;
  subjects: ReviewSubjectSelection | null;
  renderAddSubject: ((schoolClass: ReviewClass) => ReactNode) | null;
};
const SelectionContext = createContext<ReviewContextValue>({ selection: null, subjects: null, renderAddSubject: null });

/** Keeps each class's breakdown next to its summary. Classes expand
 * independently so reviewing one never closes another or submits the plan form.
 * With `selection`, each class has a checkbox choosing whether it takes part;
 * with `subjectSelection`, each subject in a breakdown has one choosing
 * whether it gets a plan. `renderAddSubject` adds the caller's Add subject
 * control to the row of a class without subjects and to every breakdown.
 */
export function ExamPlanReviewTable({
  classes,
  selection,
  subjectSelection,
  renderAddSubject,
}: {
  classes: ReviewClass[];
  selection?: ReviewSelection;
  subjectSelection?: ReviewSubjectSelection;
  renderAddSubject?: (schoolClass: ReviewClass) => ReactNode;
}) {
  const id = useId();
  const form = useForm({
    defaultValues: { expanded: {} as Record<string, boolean> },
    validators: {
      onChange: z.object({ expanded: z.record(z.string(), z.boolean()) }),
    },
  });
  const toggleClass = useCallback((classId: string) => {
    form.setFieldValue('expanded', (expanded) => ({
      ...expanded,
      [classId]: !expanded[classId],
    }));
  }, [form]);
  const selectable = selection !== undefined;
  // Stable cell components preserve keyboard focus when expansion changes.
  const columns = useMemo<DataTableColumnDef<ReviewClass>[]>(() => [
    ...(selectable
      ? [{
          id: 'select',
          header: () => <span className="sr-only">Takes part</span>,
          cell: ({ row }) => <ClassCheckbox schoolClass={row.original} />,
        } satisfies DataTableColumnDef<ReviewClass>]
      : []),
    {
      id: 'class',
      header: 'Class',
      cell: ({ row }) => (
        <Button
          type="button"
          variant="ghost"
          className="-ml-2"
          aria-expanded={row.getIsExpanded()}
          aria-controls={row.getIsExpanded() ? `${id}-${row.id}` : undefined}
          onClick={() => toggleClass(row.id)}
        >
          {row.getIsExpanded() ? (
            <ChevronDown aria-hidden />
          ) : (
            <ChevronRight aria-hidden />
          )}
          {row.original.label}
          <ClassChange classId={row.original.classId} />
        </Button>
      ),
    },
    {
      id: 'students',
      header: 'Students',
      cell: ({ row }) => row.original.studentCount,
    },
    {
      id: 'subjects',
      header: 'Subjects',
      cell: ({ row }) => <SubjectCount schoolClass={row.original} />,
    },
    {
      id: 'modes',
      header: 'Modes',
      cell: ({ row }) => <ModeCount schoolClass={row.original} />,
    },
  ], [id, toggleClass, selectable]);
  const context = useMemo<ReviewContextValue>(
    () => ({ selection: selection ?? null, subjects: subjectSelection ?? null, renderAddSubject: renderAddSubject ?? null }),
    [selection, subjectSelection, renderAddSubject],
  );
  return (
    <SelectionContext.Provider value={context}>
      <form.Subscribe selector={(state) => state.values.expanded}>
        {(expanded) => (
          <DataTable
            ariaLabel="Exam plan review"
            data={classes}
            getRowId={(schoolClass) => schoolClass.classId}
            state={{ expanded }}
            getRowCanExpand={() => true}
            onRowClick={(schoolClass) => toggleClass(schoolClass.classId)}
            renderExpandedRow={(row) => (
              <ClassSubjects schoolClass={row.original} id={`${id}-${row.id}`} />
            )}
            columns={columns}
          />
        )}
      </form.Subscribe>
    </SelectionContext.Provider>
  );
}

function ClassCheckbox({ schoolClass }: { schoolClass: ReviewClass }) {
  const { selection } = useContext(SelectionContext);
  if (!selection) return null;
  return (
    <Checkbox
      aria-label={`${schoolClass.label} takes part`}
      checked={selection.selected.includes(schoolClass.classId)}
      disabled={selection.disabled || !selection.selectable(schoolClass)}
      onCheckedChange={(checked) =>
        selection.onToggle(schoolClass.classId, checked === true)
      }
    />
  );
}

/** "Added" / "Removed" beside a class whose participation saving would change. */
function ClassChange({ classId }: { classId: string }) {
  const { selection } = useContext(SelectionContext);
  if (!selection?.baseline) return null;
  const before = selection.baseline.includes(classId);
  const after = selection.selected.includes(classId);
  if (before === after) return null;
  return (
    <span className="text-muted-foreground">
      · {after ? 'Added' : 'Removed'}
    </span>
  );
}

/** The subjects of the class that get a plan: those chosen, or all when they are not chosen here. */
function useChosenSubjects(schoolClass: ReviewClass): ReviewSubject[] {
  const { subjects } = useContext(SelectionContext);
  const chosen = subjects?.chosen(schoolClass.classId);
  return chosen ? schoolClass.subjects.filter((subject) => chosen.includes(subject.subjectSlug)) : schoolClass.subjects;
}

/** "2 of 3" while subjects are chosen; a class without subjects shows the Add subject control instead. */
function SubjectCount({ schoolClass }: { schoolClass: ReviewClass }) {
  const { subjects, renderAddSubject } = useContext(SelectionContext);
  const chosen = useChosenSubjects(schoolClass);
  if (!schoolClass.subjects.length && renderAddSubject) return renderAddSubject(schoolClass);
  return subjects?.chosen(schoolClass.classId)
    ? `${chosen.length} of ${schoolClass.subjects.length}`
    : schoolClass.subjects.length;
}

function ModeCount({ schoolClass }: { schoolClass: ReviewClass }) {
  return useChosenSubjects(schoolClass).reduce((sum, subject) => sum + subject.modes.length, 0);
}

function SubjectCheckbox({ classId, subject }: { classId: string; subject: ReviewSubject }) {
  const { subjects } = useContext(SelectionContext);
  const chosen = subjects?.chosen(classId);
  if (!subjects || !chosen) return null;
  return (
    <Checkbox
      aria-label={`Plan ${subject.name}`}
      checked={chosen.includes(subject.subjectSlug)}
      disabled={subjects.disabled}
      onCheckedChange={(checked) => subjects.onToggle(classId, subject.subjectSlug, checked === true)}
    />
  );
}

function ClassSubjects({
  schoolClass, id,
}: { schoolClass: ReviewClass; id: string }) {
  const { subjects, renderAddSubject } = useContext(SelectionContext);
  const choosing = subjects?.chosen(schoolClass.classId) !== undefined;
  const add = renderAddSubject?.(schoolClass);
  return (
    <div id={id} role="region" aria-label={`${schoolClass.label} subjects`} className="flex flex-col gap-2">
      <DataTable
        ariaLabel={`${schoolClass.label} subjects and marks breakdown`}
        data={schoolClass.subjects}
        getRowId={(subject) => subject.subjectSlug}
        emptyMessage="No subjects configured · cannot take part"
        emptyAction={add}
        columns={[
          ...(choosing
            ? [{
                id: 'plan',
                header: () => <span className="sr-only">Gets a plan</span>,
                cell: ({ row }) => <SubjectCheckbox classId={schoolClass.classId} subject={row.original} />,
              } satisfies DataTableColumnDef<ReviewSubject>]
            : []),
          {
            id: 'subject',
            header: 'Subject',
            cell: ({ row }) => row.original.name,
          },
          {
            id: 'modes',
            header: 'Assessment modes',
            cell: ({ row }) => <SubjectModes subject={row.original} />,
          },
        ]}
      />
      {schoolClass.subjects.length > 0 && add && <div className="flex">{add}</div>}
    </div>
  );
}

function SubjectModes({ subject }: { subject: ReviewSubject }) {
  return (
    <div className="flex flex-col gap-1 whitespace-normal">
      {subject.modes.map((mode) => (
        <span key={mode.slug}>
          {mode.name} · {mode.percentage}% · {mode.maxMarks} marks
        </span>
      ))}
      {subject.issue && (
        <p role="alert" className="text-destructive">{subject.issue}</p>
      )}
    </div>
  );
}
