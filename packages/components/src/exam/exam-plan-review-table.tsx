'use client';

import { createContext, useCallback, useContext, useId, useMemo } from 'react';
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

/** Read by the cells, so the column definitions stay stable while the selection changes. */
const SelectionContext = createContext<ReviewSelection | null>(null);

/** Keeps each class's read-only breakdown next to its summary. Classes expand
 * independently so reviewing one never closes another or submits the plan form.
 * With `selection`, each class has a checkbox choosing whether it takes part.
 */
export function ExamPlanReviewTable({
  classes,
  selection,
}: {
  classes: ReviewClass[];
  selection?: ReviewSelection;
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
      cell: ({ row }) => row.original.subjects.length,
    },
    {
      id: 'modes',
      header: 'Modes',
      cell: ({ row }) => row.original.subjects.reduce(
        (sum, subject) => sum + subject.modes.length, 0,
      ),
    },
  ], [id, toggleClass, selectable]);
  return (
    <SelectionContext.Provider value={selection ?? null}>
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
  const selection = useContext(SelectionContext);
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
  const selection = useContext(SelectionContext);
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

function ClassSubjects({
  schoolClass, id,
}: { schoolClass: ReviewClass; id: string }) {
  return (
    <div id={id} role="region" aria-label={`${schoolClass.label} subjects`}>
      <DataTable
        ariaLabel={`${schoolClass.label} subjects and marks breakdown`}
        data={schoolClass.subjects}
        getRowId={(subject) => subject.subjectSlug}
        emptyMessage="No subjects configured · cannot take part"
        columns={[
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
