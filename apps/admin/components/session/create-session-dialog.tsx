'use client';

import { useForm } from '@tanstack/react-form';
import { Button } from '@campuspilot/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@campuspilot/ui/components/dialog';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import { LoaderCircle, Plus } from 'lucide-react';
import { z } from 'zod';

const newSessionSchema = z
  .object({
    sessionStartYear: z
      .number({ message: 'Start year is required' })
      .int()
      .min(2000, 'Start year must be at least 2000')
      .max(2100, 'Start year cannot exceed 2100'),
    sessionEndYear: z
      .number({ message: 'End year is required' })
      .int()
      .min(2000, 'End year must be at least 2000')
      .max(2100, 'End year cannot exceed 2100'),
  })
  .refine((data) => data.sessionEndYear > data.sessionStartYear, {
    message: 'End year must be after start year',
    path: ['sessionEndYear'],
  });

function FieldErrors({ errors }: { errors: unknown[] }) {
  return errors.map((error, index) => {
    const message =
      typeof error === 'object' && error !== null && 'message' in error
        ? String(error.message)
        : undefined;
    return message ? (
      <p key={`${message}-${index}`} className="text-xs text-destructive">
        {message}
      </p>
    ) : null;
  });
}

export interface CreateSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: {
    sessionStartYear: number;
    sessionEndYear: number;
  }) => Promise<void>;
  isSubmitting: boolean;
}

export function CreateSessionDialog({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting,
}: CreateSessionDialogProps) {
  const currentYear = new Date().getFullYear();
  const form = useForm({
    defaultValues: {
      sessionStartYear: currentYear,
      sessionEndYear: currentYear + 1,
    },
    validators: { onSubmit: newSessionSchema },
    onSubmit: async ({ value }) => {
      await onSubmit(value);
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New academic session</DialogTitle>
          <DialogDescription>
            Specify the academic year boundaries for the new session.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <form.Field name="sessionStartYear">
              {(field) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="start-year">Start year</Label>
                  <Input
                    id="start-year"
                    type="number"
                    min={2000}
                    max={2100}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      const start = Number(event.target.value);
                      field.handleChange(start);
                      form.setFieldValue('sessionEndYear', start + 1);
                    }}
                  />
                  <FieldErrors errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>

            <form.Field name="sessionEndYear">
              {(field) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="end-year">End year</Label>
                  <Input
                    id="end-year"
                    type="number"
                    min={2000}
                    max={2100}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) =>
                      field.handleChange(Number(event.target.value))
                    }
                  />
                  <FieldErrors errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>
          </div>

          <form.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
            })}
          >
            {({ canSubmit }) => (
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <Plus className="size-3.5" />
                  )}
                  Create session
                </Button>
              </DialogFooter>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>
    </Dialog>
  );
}
