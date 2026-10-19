'use client';
import { useForm } from '@tanstack/react-form';
import { Copy, History, type LucideIcon } from 'lucide-react';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@campuspilot/ui/components/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@campuspilot/ui/components/tooltip';
import { ExamButton, ExamSelect, Issues } from './exam-controls';
import {
  copyTimetableTiming,
  type TimetableConfig,
} from './timetable-builder-model';
import type { TimetableRow } from './timetable-builder-model';

const timingActionSchema = z
  .object({
    action: z.enum(['', 'reuse', 'copy']),
    sourceId: z.string(),
    targetIds: z.array(z.string()),
  })
  .superRefine((value, ctx) => {
    if (value.action === 'reuse' && !value.sourceId)
      ctx.addIssue({
        code: 'custom',
        path: ['sourceId'],
        message: 'Choose a time to reuse.',
      });
    if (value.action === 'copy' && !value.targetIds.length)
      ctx.addIssue({
        code: 'custom',
        path: ['targetIds'],
        message: 'Choose at least one destination slot.',
      });
  });

/** Timing tools change only local start/end fields; dates and assessments stay intact. */
export function TimetableTimingActions({
  config,
  row,
  disabled,
  onChange,
}: {
  config: TimetableConfig;
  row: TimetableRow;
  disabled: boolean;
  onChange: (config: TimetableConfig) => void;
}) {
  const otherRows = config.rows.filter((entry) => entry.id !== row.id);
  const timings = [
    ...new Map(
      otherRows
        .filter(
          (entry) =>
            entry.startTime && entry.endTime && entry.startTime < entry.endTime,
        )
        .map((entry) => [`${entry.startTime}-${entry.endTime}`, entry]),
    ).values(),
  ];
  const form = useForm({
    defaultValues: {
      action: '' as '' | 'reuse' | 'copy',
      sourceId: '',
      targetIds: [] as string[],
    },
    validators: { onSubmit: timingActionSchema },
    onSubmit: ({ value }) => {
      if (disabled) return;
      const source =
        value.action === 'reuse'
          ? timings.find((entry) => entry.id === value.sourceId)
          : row;
      if (!source) return;
      const targets = value.action === 'reuse' ? [row.id] : value.targetIds;
      onChange({
        ...config,
        rows: targets.reduce(
          (rows, id) => copyTimetableTiming(rows, source.id, id),
          config.rows,
        ),
      });
      form.reset();
    },
  });
  /** Opening is a user edit. Resetting to different default values would mark
   * the dialog pristine, allowing useForm's declared defaults to close it again.
   */
  const open = (action: 'reuse' | 'copy') => {
    form.reset();
    form.setFieldValue('action', action);
  };
  return (
    <form.Subscribe
      selector={(state) => ({
        ...state.values,
        canSubmit: state.canSubmit,
        pending: state.isSubmitting,
      })}
    >
      {({ action, canSubmit, pending }) => (
        <>
          <TooltipProvider>
            <div className="flex gap-1">
              <TimingIcon
                label="Reuse time"
                icon={History}
                disabled={disabled || !timings.length}
                onClick={() => open('reuse')}
              />
              <TimingIcon
                label="Copy time"
                icon={Copy}
                disabled={
                  disabled ||
                  !otherRows.length ||
                  !row.startTime ||
                  row.startTime >= row.endTime
                }
                onClick={() => open('copy')}
              />
            </div>
          </TooltipProvider>
          <Dialog
            open={action !== ''}
            onOpenChange={(open) => {
              if (!open) form.reset();
            }}
          >
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>
                  {action === 'reuse' ? 'Reuse time' : 'Copy time'}
                </DialogTitle>
                <DialogDescription>
                  {action === 'reuse'
                    ? 'Choose existing hours for this slot.'
                    : `Copy ${row.startTime}–${row.endTime} to selected slots. Dates and assessments stay unchanged.`}
                </DialogDescription>
              </DialogHeader>
              {action === 'reuse' ? (
                <form.Field name="sourceId">
                  {(field) => (
                    <ExamSelect
                      label="Time to reuse"
                      value={field.state.value}
                      errors={field.state.meta.errors}
                      onChange={field.handleChange}
                      options={[
                        { value: '', label: 'Choose a time' },
                        ...timings.map((entry) => ({
                          value: entry.id,
                          label: `${entry.startTime}–${entry.endTime}`,
                        })),
                      ]}
                    />
                  )}
                </form.Field>
              ) : (
                <form.Field name="targetIds">
                  {(field) => (
                    <fieldset className="flex max-h-64 flex-col gap-2 overflow-auto">
                      <legend className="mb-2 text-sm font-medium">
                        Destination slots
                      </legend>
                      {otherRows.map((entry) => (
                        <label
                          key={entry.id}
                          className="flex items-center gap-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={field.state.value.includes(entry.id)}
                            onChange={(event) =>
                              field.handleChange(
                                event.target.checked
                                  ? [...field.state.value, entry.id]
                                  : field.state.value.filter(
                                      (id) => id !== entry.id,
                                    ),
                              )
                            }
                          />
                          {entry.date || 'No date'} · Slot{' '}
                          {config.rows.indexOf(entry) + 1}
                        </label>
                      ))}
                      <Issues errors={field.state.meta.errors} />
                    </fieldset>
                  )}
                </form.Field>
              )}
              <DialogFooter>
                <ExamButton variant="outline" onClick={() => form.reset()}>
                  Cancel
                </ExamButton>
                <ExamButton
                  disabled={disabled || !canSubmit || pending}
                  onClick={() => void form.handleSubmit()}
                >
                  Apply
                </ExamButton>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </form.Subscribe>
  );
}

function TimingIcon({
  label,
  icon: Icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ExamButton
          variant="ghost"
          size="icon"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          <Icon aria-hidden />
        </ExamButton>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
