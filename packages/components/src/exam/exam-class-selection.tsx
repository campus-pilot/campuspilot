'use client';

import { Button } from '@campuspilot/ui/components/button';
import {
  allSelectableClassIds,
  isClassSelectable,
  toggleClassSelection,
} from './exam-class-selection-model';
import { ExamPlanReviewTable, type ReviewClass } from './exam-plan-review-table';

/**
 * Chooses which classes take part in an examination: the plan review table
 * with a checkbox per class, Select all / Deselect all and the field error
 * beside them. Presentational: the caller owns the value (a form field) and
 * receives every change through `onChange`, in the review's class order.
 *
 * `baseline` is the classes taking part now when editing an existing plan;
 * rows then say whether saving adds or removes them, and a class already
 * taking part stays selectable even without subjects.
 */
export function ExamClassSelection({
  classes,
  selected,
  baseline,
  disabled = false,
  error,
  onChange,
}: {
  classes: ReviewClass[];
  selected: readonly string[];
  baseline?: readonly string[];
  disabled?: boolean;
  error?: string;
  onChange: (classIds: string[]) => void;
}) {
  const all = allSelectableClassIds(classes, baseline);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {selected.length} of {all.length} classes take part
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={disabled || selected.length === all.length}
            onClick={() => onChange(all)}
          >
            Select all
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || selected.length === 0}
            onClick={() => onChange([])}
          >
            Deselect all
          </Button>
        </div>
      </div>
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
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
