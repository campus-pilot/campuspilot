import { useForm } from '@tanstack/react-form';
import { z } from 'zod';

import { TableFilterBar } from '../data-grid/table-filter-bar';
import { QuestionPaperClassAccordion } from './question-paper-class-accordion';
import type { QuestionPaperCellRef, QuestionPaperClassView } from './question-paper-class-table';
import {
  applyModeFilter,
  mergeModeSelection,
  modeFilterSchema,
  modeSelectionSchema,
  paperModeOptions,
  visibleModeSelection,
  type PaperModeOption,
} from './question-paper-model';

type FilteredClassesProps = {
  classes: readonly QuestionPaperClassView[];
  /**
   * The stored mode filter (every stored slug, including those of other
   * examinations). It seeds the form once: the caller keys this component
   * so that it remounts when the stored entry changes from elsewhere.
   */
  storedModes: readonly string[];
  /** Called with the whole selection to store after every change of the filter. */
  onStoredModesChange: (slugs: string[]) => void;
  /** The open class (the caller keeps it in the address), or null for none. */
  openClassId: string | null;
  onOpenClassChange: (classId: string | null) => void;
  hrefOf: (cell: QuestionPaperCellRef) => string;
  onOpen: (cell: QuestionPaperCellRef) => void;
};

/**
 * The mode filter's form: seeded from the stored entry and handing every
 * valid change to `onStoredModesChange` through the form's listener, so the
 * caller's store stays the source of truth across reloads without an effect.
 *
 * The form validates with the unbounded `modeSelectionSchema`, never the
 * storage bounds, so a person's change is always applied on screen. What is
 * stored is checked against `modeFilterSchema` in the listener; the merged
 * selection is already capped (`mergeModeSelection`), so only a mode slug
 * longer than storage allows (never one the app creates) is left unstored,
 * and the filter still applies for this visit.
 *
 * Re-rendering with the selection just stored does not reset the form: the
 * new default equals the form's value, and TanStack Form keeps a touched
 * form's values anyway. A change made elsewhere (another tab) is picked up
 * by the caller remounting this component, not by resetting the form, so a
 * filter popover open here is never closed by this tab's own writes.
 */
function useModeFilterForm(storedModes: readonly string[], onStoredModesChange: (slugs: string[]) => void) {
  return useForm({
    defaultValues: { modes: [...storedModes] },
    validators: { onChange: z.object({ modes: modeSelectionSchema }) },
    listeners: {
      onChange: ({ formApi }) => {
        const parsed = modeFilterSchema.safeParse(formApi.state.values.modes);
        if (parsed.success) onStoredModesChange(parsed.data);
      },
    },
  });
}

/**
 * An examination's classes with the Question paper tab's mode filter above
 * them. The filter works on the loaded rows only (no request). It shows the
 * stored slugs this examination has (`visibleModeSelection`); a change keeps
 * the most recent stored slugs of other examinations (`mergeModeSelection`). The filter
 * is left out when the examination has no modes to choose from.
 */
export function QuestionPaperFilteredClasses({
  classes,
  storedModes,
  onStoredModesChange,
  openClassId,
  onOpenClassChange,
  hrefOf,
  onOpen,
}: FilteredClassesProps) {
  const form = useModeFilterForm(storedModes, onStoredModesChange);
  const options = paperModeOptions(classes);
  return (
    <form.Field name="modes">
      {(field) => {
        const visible = visibleModeSelection(field.state.value, options);
        return (
          <div className="flex min-w-0 flex-col gap-3">
            {options.length > 0 ? (
              <ModeFilter
                options={options}
                visible={visible}
                errors={field.state.meta.errors}
                onChange={(next) => field.handleChange(mergeModeSelection(field.state.value, options, next))}
              />
            ) : null}
            <QuestionPaperClassAccordion
              classes={applyModeFilter(classes, visible)}
              openClassId={openClassId}
              onOpenClassChange={onOpenClassChange}
              hrefOf={hrefOf}
              onOpen={onOpen}
            />
          </div>
        );
      }}
    </form.Field>
  );
}

/** The multi-select mode filter, as on the admission tables; nothing selected shows every mode. */
function ModeFilter({
  options,
  visible,
  errors,
  onChange,
}: {
  options: PaperModeOption[];
  visible: string[];
  errors: unknown[];
  onChange: (next: string[]) => void;
}) {
  const message = errors
    .map((error) => (typeof error === 'string' ? error : (error as { message?: string } | undefined)?.message))
    .filter(Boolean)
    .join(', ');
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <TableFilterBar<{ modes: string[] | undefined }>
        filters={[
          {
            id: 'modes',
            label: 'Mode',
            type: 'multiple',
            options: options.map((option) => ({ label: option.name, value: option.slug })),
          },
        ]}
        values={{ modes: visible.length > 0 ? visible : undefined }}
        onValuesChange={(values) => onChange(values.modes ?? [])}
      />
      {message ? (
        <p role="alert" className="text-xs text-destructive">
          {message}
        </p>
      ) : null}
    </div>
  );
}
