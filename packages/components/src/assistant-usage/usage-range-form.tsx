'use client';

import { Field, FieldError, FieldLabel } from '@campuspilot/ui/components/field';
import { Input } from '@campuspilot/ui/components/input';
import { ToggleGroup, ToggleGroupItem } from '@campuspilot/ui/components/toggle-group';
import { useForm, useStore } from '@tanstack/react-form';
import { z } from 'zod';

import {
  rangeForPreset,
  USAGE_RANGE_PRESET_LABELS,
  USAGE_RANGE_PRESETS,
  type UsageGrouping,
  type UsageRangePreset,
} from './usage-model';

/** The longest range the usage procedures answer, in days (the API's limit). */
export const MAX_USAGE_RANGE_DAYS = 400;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.');

const usageRangeFormSchema = z
  .object({
    preset: z.enum(USAGE_RANGE_PRESETS),
    from: z.string(),
    to: z.string(),
    grouping: z.enum(['day', 'month']),
  })
  .superRefine((value, context) => {
    if (value.preset !== 'custom') return;
    for (const key of ['from', 'to'] as const) {
      if (!isoDate.safeParse(value[key]).success) context.addIssue({ code: 'custom', path: [key], message: 'Pick a date.' });
    }
    if (value.from && value.to && value.from > value.to) {
      context.addIssue({ code: 'custom', path: ['to'], message: 'The range must not end before it starts.' });
    }
    const days = (Date.parse(value.to) - Date.parse(value.from)) / 86_400_000 + 1;
    if (days > MAX_USAGE_RANGE_DAYS) {
      context.addIssue({ code: 'custom', path: ['from'], message: `Pick at most ${MAX_USAGE_RANGE_DAYS} days.` });
    }
  });

export type UsageRangeFormValues = z.infer<typeof usageRangeFormSchema>;

/** The range and grouping the viewer chose, or null while a custom range is incomplete or invalid. */
export type UsageSelection = { from: string; to: string; grouping: UsageGrouping };

/** What the values ask for: a preset's range on `now`, or the custom dates once they are valid. */
export function resolveUsageSelection(values: UsageRangeFormValues, now: Date): UsageSelection | null {
  if (!usageRangeFormSchema.safeParse(values).success) return null;
  const range = rangeForPreset(values.preset, now) ?? { from: values.from, to: values.to };
  return { ...range, grouping: values.grouping };
}

/**
 * The usage range picker's form: last 7 days by default, this month, last
 * month or custom dates (IST), grouped per day or per month. Validated with
 * Zod on every change; the selection is derived from the form's values
 * (`useUsageSelection`), so the views refetch as soon as a valid range is
 * picked and nothing else holds a copy of it.
 */
export function useUsageRangeForm() {
  return useForm({
    defaultValues: { preset: 'last7', from: '', to: '', grouping: 'day' } as UsageRangeFormValues,
    validators: { onChange: usageRangeFormSchema },
  });
}

export type UsageRangeFormApi = ReturnType<typeof useUsageRangeForm>;

/** The current valid selection of a usage range form (see `resolveUsageSelection`). */
export function useUsageSelection(form: UsageRangeFormApi, now: Date): UsageSelection | null {
  const values = useStore(form.store, (state) => state.values);
  return resolveUsageSelection(values, now);
}

function PresetField({ form }: { form: UsageRangeFormApi }) {
  return (
    <form.Field name="preset">
      {(field) => (
        <ToggleGroup
          type="single"
          variant="outline"
          aria-label="Date range"
          value={field.state.value}
          onValueChange={(value) => {
            if (value) field.handleChange(value as UsageRangePreset);
          }}
        >
          {USAGE_RANGE_PRESETS.map((preset) => (
            <ToggleGroupItem key={preset} value={preset}>
              {USAGE_RANGE_PRESET_LABELS[preset]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
    </form.Field>
  );
}

function GroupingField({ form }: { form: UsageRangeFormApi }) {
  return (
    <form.Field name="grouping">
      {(field) => (
        <ToggleGroup
          type="single"
          variant="outline"
          aria-label="Group by"
          value={field.state.value}
          onValueChange={(value) => {
            if (value) field.handleChange(value as UsageGrouping);
          }}
        >
          <ToggleGroupItem value="day">Daily</ToggleGroupItem>
          <ToggleGroupItem value="month">Monthly</ToggleGroupItem>
        </ToggleGroup>
      )}
    </form.Field>
  );
}

function DateField({ form, name, label }: { form: UsageRangeFormApi; name: 'from' | 'to'; label: string }) {
  return (
    <form.Field name={name}>
      {(field) => (
        <Field className="w-auto">
          <FieldLabel htmlFor={`usage-range-${name}`}>{label}</FieldLabel>
          <Input
            id={`usage-range-${name}`}
            type="date"
            value={field.state.value}
            onChange={(event) => field.handleChange(event.target.value)}
            aria-invalid={field.state.meta.errors.length > 0}
          />
          <FieldError errors={field.state.meta.errors.map((error) => ({ message: typeof error === 'string' ? error : error?.message }))} />
        </Field>
      )}
    </form.Field>
  );
}

/**
 * The range and grouping controls. Dates are IST calendar days, the days
 * the API groups spend by.
 */
export function UsageRangeControls({ form }: { form: UsageRangeFormApi }) {
  const preset = useStore(form.store, (state) => state.values.preset);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <PresetField form={form} />
        <GroupingField form={form} />
      </div>
      {preset === 'custom' ? (
        <div className="flex flex-wrap items-start gap-3">
          <DateField form={form} name="from" label="From" />
          <DateField form={form} name="to" label="To" />
        </div>
      ) : null}
    </div>
  );
}
