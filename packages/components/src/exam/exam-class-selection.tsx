'use client';

import type { ReactNode } from 'react';
import { Button } from '@campuspilot/ui/components/button';
import {
  allSelectableClassIds,
  isClassSelectable,
  toggleClassSelection,
  toggleSubjectChoice,
  type SubjectChoice,
} from './exam-class-selection-model';
import { ExamPlanReviewTable, type ReviewClass, type ReviewSubjectSelection } from './exam-plan-review-table';

/**
 * The subjects chosen to get a plan, per class, owned by the caller (a form
 * field). `choosable` says whose subjects are chosen here (default: every
 * class); the others are listed without checkboxes.
 */
export type ExamSubjectChoice = {
  chosen: SubjectChoice;
  choosable?: (classId: string) => boolean;
  onChange: (subjects: SubjectChoice) => void;
};

/**
 * Chooses which classes take part in an examination: the plan review table
 * with a checkbox per class, Select all / Deselect all and the field error
 * beside them. Presentational: the caller owns the value (a form field) and
 * receives every change through `onChange`, in the review's class order.
 *
 * `baseline` is the classes taking part now when editing an existing plan;
 * rows then say whether saving adds or removes them, and a class already
 * taking part stays selectable even without subjects. `subjects` adds a
 * checkbox per subject choosing which subjects get a plan, and
 * `renderAddSubject` the caller's (permission-gated) Add subject control.
 * `actions` are the caller's (permission-gated) controls beside Select all,
 * such as Add classroom.
 */
export function ExamClassSelection({
  classes,
  selected,
  baseline,
  disabled = false,
  error,
  subjects,
  renderAddSubject,
  actions,
  onChange,
}: {
  classes: ReviewClass[];
  selected: readonly string[];
  baseline?: readonly string[];
  disabled?: boolean;
  error?: string;
  subjects?: ExamSubjectChoice;
  renderAddSubject?: (schoolClass: ReviewClass) => ReactNode;
  actions?: ReactNode;
  onChange: (classIds: string[]) => void;
}) {
  const all = allSelectableClassIds(classes, baseline);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <SelectionToolbar
        count={selected.length}
        total={all.length}
        disabled={disabled}
        actions={actions}
        onSelectAll={() => onChange(all)}
        onDeselectAll={() => onChange([])}
      />
      <ExamPlanReviewTable
        classes={classes}
        selection={{
          selected,
          baseline,
          disabled,
          selectable: (schoolClass) => isClassSelectable(schoolClass, baseline),
          onToggle: (classId, checked) =>
            onChange(toggleClassSelection(classes, selected, classId, checked)),
        }}
        subjectSelection={subjects && subjectSelection(classes, subjects, disabled)}
        renderAddSubject={renderAddSubject}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function subjectSelection(classes: readonly ReviewClass[], subjects: ExamSubjectChoice, disabled: boolean): ReviewSubjectSelection {
  return {
    chosen: (classId) => {
      if (!(subjects.choosable?.(classId) ?? true)) return undefined;
      return Object.hasOwn(subjects.chosen, classId) ? subjects.chosen[classId] : [];
    },
    disabled,
    onToggle: (classId, subjectSlug, checked) =>
      subjects.onChange(toggleSubjectChoice(classes, subjects.chosen, classId, subjectSlug, checked)),
  };
}

function SelectionToolbar({
  count,
  total,
  disabled,
  actions,
  onSelectAll,
  onDeselectAll,
}: {
  count: number;
  total: number;
  disabled: boolean;
  actions?: ReactNode;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {count} of {total} classes take part
      </p>
      <div className="flex flex-wrap gap-2">
        {actions}
        <Button type="button" variant="outline" disabled={disabled || count === total} onClick={onSelectAll}>
          Select all
        </Button>
        <Button type="button" variant="outline" disabled={disabled || count === 0} onClick={onDeselectAll}>
          Deselect all
        </Button>
      </div>
    </div>
  );
}
