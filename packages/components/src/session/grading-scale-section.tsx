'use client';

import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Badge } from '@campuspilot/ui/components/badge';
import { Button } from '@campuspilot/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@campuspilot/ui/components/dialog';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@campuspilot/ui/components/empty';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import { Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import {
  DEFAULT_GRADES,
  slugify,
  type GradeDefinition,
} from './types';

const gradeFormSchema = z.object({
  label: z.string().trim().min(1, 'Grade label is required'),
  minScore: z
    .number()
    .int()
    .min(0, 'Minimum score cannot be negative')
    .max(100, 'Score cannot exceed 100'),
  key: z
    .string()
    .trim()
    .min(1, 'Grade key is required')
    .regex(/^[a-z0-9_]+$/, 'Key can only contain lowercase letters, numbers, and underscores'),
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

interface GradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValues?: { key: string; label: string; minScore: number };
  existingKeys: string[];
  onSubmit: (values: { key: string; label: string; minScore: number }) => void;
}

function GradeDialog({
  open,
  onOpenChange,
  initialValues,
  existingKeys,
  onSubmit,
}: GradeDialogProps) {
  const isEditing = Boolean(initialValues);
  const form = useForm({
    defaultValues: {
      label: initialValues?.label ?? '',
      minScore: initialValues?.minScore ?? 0,
      key: initialValues?.key ?? '',
    },
    validators: {
      onSubmit: gradeFormSchema.refine(
        (val) => {
          if (isEditing && val.key === initialValues?.key) return true;
          return !existingKeys.includes(val.key);
        },
        {
          message: 'A grade with this key already exists.',
          path: ['key'],
        },
      ),
    },
    onSubmit: ({ value }) => {
      onSubmit(value);
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit grade' : 'Add grade'}</DialogTitle>
          <DialogDescription>
            Configure the grade symbol and minimum qualifying score percentage.
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
          <form.Field name="label">
            {(field) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="grade-label">Grade label</Label>
                <Input
                  id="grade-label"
                  placeholder="e.g. A1 or A+"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    const nextVal = event.target.value;
                    field.handleChange(nextVal);
                    if (!isEditing) {
                      form.setFieldValue('key', slugify(nextVal));
                    }
                  }}
                />
                <FieldErrors errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>
          <form.Field name="minScore">
            {(field) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="grade-min-score">Minimum score (%)</Label>
                <Input
                  id="grade-min-score"
                  type="number"
                  min={0}
                  max={100}
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
          <form.Field name="key">
            {(field) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="grade-key">Key (slug)</Label>
                <Input
                  id="grade-key"
                  placeholder="e.g. a1"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                <FieldErrors errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>
          <form.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              isSubmitting: state.isSubmitting,
            })}
          >
            {({ canSubmit, isSubmitting }) => (
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={!canSubmit || isSubmitting}>
                  {isEditing ? 'Save changes' : 'Add grade'}
                </Button>
              </DialogFooter>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export interface GradingScaleSectionProps {
  gradingScale: Record<string, GradeDefinition> | null | undefined;
  onChange?: (nextScale: Record<string, GradeDefinition>) => void;
}

export function GradingScaleSection({
  gradingScale,
  onChange,
}: GradingScaleSectionProps) {
  const [dialogState, setDialogState] = useState<{
    open: boolean;
    editingKey?: string;
  }>({ open: false });

  // Order strictly descending by minScore as required by the schema and business rules
  const sortedEntries = Object.entries(gradingScale ?? {}).sort(
    ([, a], [, b]) => b.minScore - a.minScore,
  );
  const isEmpty = sortedEntries.length === 0;
  const existingKeys = sortedEntries.map(([key]) => key);

  function handleAddOrEdit(values: {
    key: string;
    label: string;
    minScore: number;
  }) {
    const current = { ...(gradingScale ?? {}) };
    if (dialogState.editingKey && dialogState.editingKey !== values.key) {
      delete current[dialogState.editingKey];
    }
    current[values.key] = {
      label: values.label,
      minScore: values.minScore,
    };
    onChange?.(current);
  }

  function handleDelete(key: string) {
    const current = { ...(gradingScale ?? {}) };
    delete current[key];
    onChange?.(current);
  }

  function handleLoadDefaults() {
    const defaults: Record<string, GradeDefinition> = {};
    DEFAULT_GRADES.forEach((item) => {
      defaults[item.key] = item.value;
    });
    onChange?.(defaults);
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            Grading Scale
          </h2>
          <p className="text-xs text-muted-foreground">
            Convert student marks into letter grades. Ordered automatically by minimum score threshold descending.
          </p>
        </div>
        {onChange ? <div className="flex items-center gap-2">
          {isEmpty && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleLoadDefaults}
            >
              <Sparkles className="size-3.5" />
              Load default scale
            </Button>
          )}
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => setDialogState({ open: true })}
          >
            <Plus className="size-3.5" />
            Add grade
          </Button>
        </div> : null}
      </div>

      {isEmpty ? (
        <Empty className="border border-dashed p-6">
          <EmptyHeader>
            <EmptyTitle>No grading scale defined</EmptyTitle>
            <EmptyDescription>
              Add grades with percentage thresholds (e.g. A1 &ge; 91%), or load standard 8-point grading.
            </EmptyDescription>
          </EmptyHeader>
          {onChange ? <EmptyContent className="flex-row gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleLoadDefaults}
            >
              <Sparkles className="size-3.5" />
              Load standard 8-point scale
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setDialogState({ open: true })}
            >
              <Plus className="size-3.5" />
              Create grade
            </Button>
          </EmptyContent> : null}
        </Empty>
      ) : (
        <div className="flex flex-col overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-center bg-muted/40 px-3 py-2 text-[11px] font-medium text-muted-foreground">
            <span>Grade label</span>
            <span>Minimum score</span>
            <span>Key</span>
            {onChange ? <span className="text-right">Actions</span> : null}
          </div>
          <div className="divide-y divide-border bg-background">
            {sortedEntries.map(([key, grade]) => (
              <div
                key={key}
                className="grid grid-cols-[1fr_1fr_1fr_auto] items-center px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-semibold">
                    {grade.label}
                  </Badge>
                </div>
                <span className="font-mono text-xs text-foreground">
                  &ge; {grade.minScore}%
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {key}
                </span>
                {onChange ? <div className="flex items-center justify-end gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Edit ${grade.label}`}
                    onClick={() =>
                      setDialogState({ open: true, editingKey: key })
                    }
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${grade.label}`}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => handleDelete(key)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div> : null}
              </div>
            ))}
          </div>
        </div>
      )}

      {onChange && dialogState.open && (
        <GradeDialog
          key={dialogState.editingKey ?? 'new-grade'}
          open={dialogState.open}
          onOpenChange={(open) => setDialogState({ open })}
          initialValues={
            dialogState.editingKey && gradingScale?.[dialogState.editingKey]
              ? {
                  key: dialogState.editingKey,
                  label: gradingScale[dialogState.editingKey]!.label,
                  minScore: gradingScale[dialogState.editingKey]!.minScore,
                }
              : undefined
          }
          existingKeys={existingKeys}
          onSubmit={handleAddOrEdit}
        />
      )}
    </div>
  );
}
