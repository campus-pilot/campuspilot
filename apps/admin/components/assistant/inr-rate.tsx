'use client';

import { INR_RATE_PATTERN } from '@campuspilot/components/assistant-usage';
import { Button } from '@campuspilot/ui/components/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@campuspilot/ui/components/field';
import { Input } from '@campuspilot/ui/components/input';
import { useForm } from '@tanstack/react-form';
import { useSyncExternalStore } from 'react';
import { z } from 'zod';

/**
 * The viewer's rupees-per-dollar rate for showing USD spend in INR. It is a
 * display preference of this browser only: kept in localStorage, never sent
 * to the API, and every amount stays USD in the data. Storage can be
 * unavailable (private windows, blocked site data), so every access is
 * guarded and the pages work without it (USD only).
 */
const STORAGE_KEY = 'campuspilot.admin.inrPerUsd';
const listeners = new Set<() => void>();

function readStoredRate(): string | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value && INR_RATE_PATTERN.test(value) && Number(value) > 0 ? value : null;
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

function storeRate(rate: string | null) {
  try {
    if (rate) window.localStorage.setItem(STORAGE_KEY, rate);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Not kept: the rate applies until the page is left.
  }
  for (const listener of listeners) listener();
}

/**
 * The stored rate, or null. Read through `useSyncExternalStore`, so the
 * prerendered page (no storage) and every open view agree without an effect.
 */
export function useInrRate(): string | null {
  return useSyncExternalStore(subscribe, readStoredRate, () => null);
}

const rateFormSchema = z.object({
  rate: z
    .string()
    .trim()
    .refine((value) => value === '' || (INR_RATE_PATTERN.test(value) && Number(value) > 0), 'Enter rupees per dollar, for example 84.25.'),
});

function useRateForm(stored: string | null) {
  return useForm({
    defaultValues: { rate: stored ?? '' },
    validators: { onSubmit: rateFormSchema },
    onSubmit: ({ value }) => storeRate(value.rate.trim() || null),
  });
}

/** The rate input; keyed by the stored rate so it restarts from what is saved. */
function RateForm({ stored }: { stored: string | null }) {
  const form = useRateForm(stored);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="rate">
        {(field) => (
          <Field className="w-44">
            <FieldLabel htmlFor="inr-per-usd">INR per USD</FieldLabel>
            <Input
              id="inr-per-usd"
              inputMode="decimal"
              placeholder="84.25"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              aria-invalid={field.state.meta.errors.length > 0}
            />
            <FieldError errors={field.state.meta.errors.map((error) => ({ message: typeof error === 'string' ? error : error?.message }))} />
          </Field>
        )}
      </form.Field>
      <form.Subscribe selector={(state) => state.isDirty}>
        {(isDirty) => (
          <Button type="submit" variant="outline" disabled={!isDirty}>
            Apply
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}

/** Lets the viewer show amounts in rupees too; stays in this browser. */
export function InrRateControl() {
  const stored = useInrRate();
  return (
    <div className="flex flex-col gap-1">
      <RateForm key={stored ?? 'none'} stored={stored} />
      <FieldDescription>Only for display in this browser; leave empty to show USD only.</FieldDescription>
    </div>
  );
}
