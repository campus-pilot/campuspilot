'use client';
import type { z } from 'zod';
import { ExamButton, ExamInput, ExamSelect, Issues } from './exam-controls';

export type TimetableClass = {
  id: string;
  label: string;
  subjects: Record<
    string,
    {
      name: string;
      examModes: Record<string, { name: string; percentage: number }>;
    }
  >;
};
type Pair = { subjectSlug: string; modeSlug: string };
export type TimetableRow = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  cells: Record<string, Pair | Pair[] | null>;
};
type Row = TimetableRow;
const asPairs = (cell: Row['cells'][string]): Pair[] =>
  cell == null ? [] : Array.isArray(cell) ? cell : [cell];

export function SlotEditor({
  row,
  disabled,
  classId,
  context,
  onPatch,
  onRemove,
  onMove,
  errors,
}: {
  row: Row;
  disabled: boolean;
  classId: string;
  context: { classes: TimetableClass[] };
  onPatch: (patch: Partial<Row>) => void;
  onRemove: () => void;
  onMove?: () => void;
  errors: z.ZodIssue[];
}) {
  const subjects =
    context.classes.find((item) => item.id === classId)?.subjects ?? {};
  const pairs = asPairs(row.cells[classId] ?? null);
  /** Replaces only the selected class cell; an empty selection is stored as null. */
  const setPairs = (next: Pair[]) =>
    onPatch({
      cells: {
        ...row.cells,
        [classId]:
          next.length === 0 ? null : next.length === 1 ? next[0]! : next,
      },
    });
  return (
    <section className="flex flex-col gap-3 rounded-lg border p-3">
      <h3 className="font-medium">
        Shared slot {row.date || '(date required)'}
      </h3>
      <div className="grid gap-3 sm:grid-cols-3">
        {(['date', 'startTime', 'endTime'] as const).map((key) => (
          <ExamInput
            key={key}
            label={
              key === 'date'
                ? 'Date'
                : key === 'startTime'
                  ? 'Start time'
                  : 'End time'
            }
            disabled={disabled}
            type={key === 'date' ? 'date' : 'time'}
            field={{
              name: `${row.id}-${key}`,
              state: {
                value: row[key],
                meta: {
                  errors: errors.filter((issue) => issue.path[2] === key),
                },
              },
              handleBlur: () => {},
              handleChange: (value) => onPatch({ [key]: value }),
            }}
          />
        ))}
      </div>
      {classId && (
        <>
          <p className="text-sm font-medium">
            {context.classes.find((item) => item.id === classId)?.label ??
              classId}{' '}
            assignments
          </p>
          {pairs.map((pair, index) => (
            <CellEditor
              key={index}
              pair={pair}
              disabled={disabled}
              subjects={subjects}
              errors={errors.filter(
                (issue) =>
                  issue.path[2] === 'cells' && issue.path[3] === classId,
              )}
              onChange={(pair) =>
                setPairs(pairs.map((item, i) => (i === index ? pair : item)))
              }
              onRemove={() => setPairs(pairs.filter((_, i) => i !== index))}
            />
          ))}
          <ExamButton
            type="button"
            variant="outline"
            onClick={() => {
              const [slug, subject] =
                Object.entries(subjects).find(
                  ([, subject]) => Object.keys(subject.examModes).length,
                ) ?? [];
              if (slug && subject)
                setPairs([
                  ...pairs,
                  {
                    subjectSlug: slug,
                    modeSlug: Object.keys(subject.examModes)[0]!,
                  },
                ]);
            }}
            disabled={
              disabled ||
              !Object.values(subjects).some(
                (subject) => Object.keys(subject.examModes).length,
              )
            }
          >
            Add assessment to this class
          </ExamButton>
        </>
      )}
      <Issues errors={errors} />
      <div className="flex flex-wrap gap-3">
        {onMove && (
          <ExamButton
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={onMove}
          >
            Move slot earlier
          </ExamButton>
        )}
        <ExamButton
          type="button"
          variant="destructive"
          disabled={disabled}
          onClick={onRemove}
        >
          Delete shared slot
        </ExamButton>
      </div>
    </section>
  );
}
function CellEditor({
  pair,
  disabled,
  subjects,
  errors,
  onChange,
  onRemove,
}: {
  pair: Pair;
  disabled: boolean;
  subjects: TimetableClass['subjects'];
  errors: z.ZodIssue[];
  onChange: (pair: Pair) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-muted/30 p-3">
      <ExamSelect
        label="Subject"
        errors={errors}
        disabled={disabled}
        value={pair.subjectSlug}
        onChange={(subjectSlug) =>
          onChange({
            subjectSlug,
            modeSlug:
              Object.keys(subjects[subjectSlug]?.examModes ?? {})[0] ?? '',
          })
        }
      >
        {!subjects[pair.subjectSlug] && (
          <option value={pair.subjectSlug}>{pair.subjectSlug}</option>
        )}
        {Object.entries(subjects).map(([slug, subject]) => (
          <option key={slug} value={slug}>
            {subject.name}
          </option>
        ))}
      </ExamSelect>
      <ExamSelect
        label="Assessment component"
        errors={errors}
        disabled={disabled}
        value={pair.modeSlug}
        onChange={(modeSlug) => onChange({ ...pair, modeSlug })}
      >
        {!subjects[pair.subjectSlug]?.examModes[pair.modeSlug] && (
          <option value={pair.modeSlug}>
            {pair.modeSlug || 'Choose a component'}
          </option>
        )}
        {Object.entries(subjects[pair.subjectSlug]?.examModes ?? {}).map(
          ([slug, mode]) => (
            <option key={slug} value={slug}>
              {mode.name}
            </option>
          ),
        )}
      </ExamSelect>
      <ExamButton
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={onRemove}
      >
        Remove assessment
      </ExamButton>
    </div>
  );
}
