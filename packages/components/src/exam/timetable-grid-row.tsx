'use client';
import type { z } from 'zod';
import { Plus, Trash2, X } from 'lucide-react';
import { ExamButton, ExamInput, ExamSelect, Issues } from './exam-controls';
import { TimetableTimingActions } from './timetable-timing-actions';
import {
  decodeTimetablePair,
  encodeTimetablePair,
  parseTimetableDate,
  timetablePairs,
  type TimetableConfig,
  type TimetableClass,
  type TimetableRow,
  type TimetablePair,
} from './timetable-builder-model';

type GridRowProps = {
  config: TimetableConfig;
  classes: TimetableClass[];
  row: TimetableRow;
  disabled: boolean;
  issues: z.ZodIssue[];
  onChange: (config: TimetableConfig) => void;
  onPatch: (id: string, changes: Partial<TimetableRow>) => void;
  onRemove: (id: string) => void;
};

export function TimetableGridRow(
  props: GridRowProps & { index: number; visibleColumns?: string[] },
) {
  const errors = props.issues.filter(
    (issue) => issue.path[0] === 'rows' && issue.path[1] === props.index,
  );
  return (
    <tr>
      <td className="sticky left-0 z-10 border-b border-r bg-muted/60 p-2 align-top">
        <SlotDate
          row={props.row}
          disabled={props.disabled}
          issues={errors}
          onPatch={(patch) => props.onPatch(props.row.id, patch)}
        />
      </td>
      <td className="border-b border-r bg-muted/30 p-2 align-top">
        <SlotTimes {...props} issues={errors} />
        <Issues errors={errors.filter((issue) => issue.path.length === 2)} />
      </td>
      {(props.visibleColumns ?? props.config.columns).map((id) => (
        <td key={id} className="border-b border-r p-2 align-top">
          <CellAssignments
            row={props.row}
            classId={id}
            schoolClass={props.classes.find((entry) => entry.id === id)}
            disabled={props.disabled}
            issues={errors.filter(
              (issue) => issue.path[2] === 'cells' && issue.path[3] === id,
            )}
            onPatch={(patch) => props.onPatch(props.row.id, patch)}
          />
        </td>
      ))}
      <td className="border-b p-2 align-top">
        <ExamButton
          type="button"
          variant="ghost"
          disabled={props.disabled}
          aria-label={`Delete slot ${props.index + 1}`}
          onClick={() => props.onRemove(props.row.id)}
        >
          <Trash2 aria-hidden className="size-4" />
        </ExamButton>
      </td>
    </tr>
  );
}
function SlotDate({
  row,
  disabled,
  issues,
  onPatch,
}: {
  row: TimetableRow;
  disabled: boolean;
  issues: z.ZodIssue[];
  onPatch: (changes: Partial<TimetableRow>) => void;
}) {
  const date = parseTimetableDate(row.date);
  return (
    <div className="flex flex-col gap-2">
      <ExamInput
        label="Date"
        type="date"
        disabled={disabled}
        field={{
          name: `${row.id}-date`,
          state: {
            value: row.date,
            meta: {
              errors: issues.filter((issue) => issue.path[2] === 'date'),
            },
          },
          handleBlur: () => {},
          handleChange: (value) => onPatch({ date: value }),
        }}
      />
      {date && !Number.isNaN(date.getTime()) && (
        <p className="text-sm text-muted-foreground">
          {date.toLocaleDateString(undefined, { weekday: 'long' })}
        </p>
      )}
    </div>
  );
}
function SlotTimes({
  row,
  config,
  disabled,
  issues,
  onPatch,
  onChange,
}: GridRowProps & { row: TimetableRow; issues: z.ZodIssue[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        {(['startTime', 'endTime'] as const).map((key) => (
          <ExamInput
            key={key}
            label={key === 'startTime' ? 'Start time' : 'End time'}
            type="time"
            disabled={disabled}
            field={{
              name: `${row.id}-${key}`,
              state: {
                value: row[key],
                meta: {
                  errors: issues.filter((issue) => issue.path[2] === key),
                },
              },
              handleBlur: () => {},
              handleChange: (value) => onPatch(row.id, { [key]: value }),
            }}
          />
        ))}
      </div>
      <TimetableTimingActions
        config={config}
        row={row}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  );
}
function CellAssignments({
  row,
  classId,
  schoolClass,
  disabled,
  issues,
  onPatch,
}: {
  row: TimetableRow;
  classId: string;
  schoolClass?: TimetableClass;
  disabled: boolean;
  issues: z.ZodIssue[];
  onPatch: (patch: Partial<TimetableRow>) => void;
}) {
  const pairs = timetablePairs(row.cells[classId]);
  const options = Object.entries(schoolClass?.subjects ?? {}).flatMap(
    ([subjectSlug, subject]) =>
      Object.entries(subject.examModes).map(([modeSlug, mode]) => ({
        value: encodeTimetablePair({ subjectSlug, modeSlug }),
        label: `${subject.name} — ${mode.name}`,
      })),
  );
  const set = (next: TimetablePair[]) =>
    onPatch({
      cells: {
        ...row.cells,
        [classId]:
          next.length === 0 ? null : next.length === 1 ? next[0]! : next,
      },
    });
  const choose = (index: number, value: string) => {
    const pair = decodeTimetablePair(value);
    set(
      pair
        ? [...pairs.slice(0, index), pair, ...pairs.slice(index + 1)]
        : pairs.filter((_, i) => i !== index),
    );
  };
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {(pairs.length ? pairs : [null]).map((pair, index) => (
        <div key={index} className="flex min-w-0 items-end gap-1">
          <div className="min-w-0 flex-1">
            <ExamSelect
              label={`${schoolClass?.label ?? classId} assessment${index > 0 ? ` ${index + 1}` : ''}`}
              value={pair ? encodeTimetablePair(pair) : ''}
              errors={issues
                .filter(
                  (issue) =>
                    typeof issue.path[4] !== 'number' ||
                    issue.path[4] === index,
                )
                .map((issue) =>
                  issue.code === 'too_small'
                    ? {
                        ...issue,
                        message:
                          'Choose a configured subject and assessment component for this class',
                      }
                    : issue,
                )}
              disabled={disabled}
              onChange={(value) => choose(index, value)}
              options={[
                {
                  value: '',
                  label: pair ? 'Choose assessment / clear' : 'No exam',
                },
                ...(pair &&
                  !options.some(
                    (option) => option.value === encodeTimetablePair(pair),
                  )
                  ? [
                      {
                        value: encodeTimetablePair(pair),
                        label: `${pair.subjectSlug || 'Choose subject'} · ${pair.modeSlug || 'Choose mode'}`,
                      },
                    ]
                  : []),
                ...options,
              ]}
            />
          </div>
          {pair && (
            <ExamButton
              type="button"
              variant="ghost"
              disabled={disabled}
              aria-label="Remove assessment"
              onClick={() => set(pairs.filter((_, i) => i !== index))}
            >
              <X aria-hidden className="size-4" />
            </ExamButton>
          )}
        </div>
      ))}
      {pairs.length > 0 && (
        <ExamButton
          type="button"
          variant="outline"
          disabled={disabled || options.length === 0}
          onClick={() => set([...pairs, { subjectSlug: '', modeSlug: '' }])}
        >
          <Plus aria-hidden className="size-4" /> Add assessment
        </ExamButton>
      )}
    </div>
  );
}
