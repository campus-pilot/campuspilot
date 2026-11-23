'use client';

import { Label } from '@campuspilot/ui/components/label';
import type { ReactNode } from 'react';

/** The first error of a field, as TanStack Form keeps it (a string or a Standard Schema issue). */
export function firstError(errors: unknown[]): string | null {
  const error = errors[0];
  if (!error) return null;
  if (typeof error === 'string') return error;
  return (error as { message?: string }).message ?? null;
}

export function FieldError({ errors }: { errors: unknown[] }) {
  const message = firstError(errors);
  return message ? <p className="text-xs text-destructive">{message}</p> : null;
}

/** A label, its control, an optional hint and the field's first error, stacked. */
export function FieldRow({ id, label, hint, errors, children }: { id?: string; label: string; hint?: ReactNode; errors?: unknown[]; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {errors ? <FieldError errors={errors} /> : null}
    </div>
  );
}

/** A step's heading and what it decides. */
export function StepIntro({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
