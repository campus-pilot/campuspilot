'use client';

import { useCallback, useId, useMemo } from 'react';
import { useForm } from '@tanstack/react-form';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@campuspilot/ui/components/button';
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
type ReviewClass = {
  classId: string;
  label: string;
  studentCount: number;
  subjects: ReviewSubject[];
};

/** Keeps each class's read-only breakdown next to its summary. Classes expand
 * independently so reviewing one never closes another or submits the plan form.
 */
export function ExamPlanReviewTable({ classes }: { classes: ReviewClass[] }) {
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
  // Stable cell components preserve keyboard focus when expansion changes.
  const columns = useMemo<DataTableColumnDef<ReviewClass>[]>(() => [
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
  ], [id, toggleClass]);
  return (
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
        emptyMessage="No subjects configured · skipped"
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
