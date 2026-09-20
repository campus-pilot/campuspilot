'use client';

import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
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
  DEFAULT_CO_SCHOLASTIC_AREAS,
  slugify,
  type CoScholasticArea,
} from './types';

const areaFormSchema = z.object({
  name: z.string().trim().min(1, 'Area name is required'),
  slug: z
    .string()
    .trim()
    .min(1, 'Slug is required')
    .regex(/^[a-z0-9_]+$/, 'Slug can only contain lowercase letters, numbers, and underscores'),
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

interface AreaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValues?: { slug: string; name: string };
  existingSlugs: string[];
  onSubmit: (values: { slug: string; name: string }) => void;
}

function AreaDialog({
  open,
  onOpenChange,
  initialValues,
  existingSlugs,
  onSubmit,
}: AreaDialogProps) {
  const isEditing = Boolean(initialValues);
  const form = useForm({
    defaultValues: {
      name: initialValues?.name ?? '',
      slug: initialValues?.slug ?? '',
    },
    validators: {
      onSubmit: areaFormSchema.refine(
        (val) => {
          if (isEditing && val.slug === initialValues?.slug) return true;
          return !existingSlugs.includes(val.slug);
        },
        {
          message: 'An area with this identifier already exists.',
          path: ['slug'],
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
          <DialogTitle>
            {isEditing ? 'Edit co-scholastic area' : 'Add co-scholastic area'}
          </DialogTitle>
          <DialogDescription>
            Enter the display name and identifier for this assessment area.
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
          <form.Field name="name">
            {(field) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="area-name">Area name</Label>
                <Input
                  id="area-name"
                  placeholder="e.g. Art Education"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    const nextName = event.target.value;
                    field.handleChange(nextName);
                    if (!isEditing) {
                      form.setFieldValue('slug', slugify(nextName));
                    }
                  }}
                />
                <FieldErrors errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>
          <form.Field name="slug">
            {(field) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="area-slug">Identifier (slug)</Label>
                <Input
                  id="area-slug"
                  placeholder="e.g. art_education"
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
                  {isEditing ? 'Save changes' : 'Add area'}
                </Button>
              </DialogFooter>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AreaItem({
  slug,
  area,
  onEdit,
  onDelete,
}: {
  slug: string;
  area: CoScholasticArea;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-xs">
      <div className="flex flex-col gap-0.5">
        <span className="font-medium text-foreground">{area.name}</span>
        <span className="font-mono text-[10px] text-muted-foreground">{slug}</span>
      </div>
      {onEdit && onDelete ? <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Edit ${area.name}`}
          onClick={onEdit}
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete ${area.name}`}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div> : null}
    </div>
  );
}

export interface CoScholasticSectionProps {
  areas: Record<string, CoScholasticArea> | null | undefined;
  onChange?: (nextAreas: Record<string, CoScholasticArea>) => void;
}

export function CoScholasticSection({
  areas,
  onChange,
}: CoScholasticSectionProps) {
  const [dialogState, setDialogState] = useState<{
    open: boolean;
    editingSlug?: string;
  }>({ open: false });

  const entries = Object.entries(areas ?? {});
  const isEmpty = entries.length === 0;
  const existingSlugs = entries.map(([slug]) => slug);

  function handleAddOrEdit(values: { slug: string; name: string }) {
    const current = { ...(areas ?? {}) };
    if (dialogState.editingSlug && dialogState.editingSlug !== values.slug) {
      delete current[dialogState.editingSlug];
    }
    current[values.slug] = { name: values.name };
    onChange?.(current);
  }

  function handleDelete(slug: string) {
    const current = { ...(areas ?? {}) };
    delete current[slug];
    onChange?.(current);
  }

  function handleLoadDefaults() {
    const defaults: Record<string, CoScholasticArea> = {};
    DEFAULT_CO_SCHOLASTIC_AREAS.forEach((item) => {
      defaults[item.slug] = { name: item.name };
    });
    onChange?.(defaults);
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            Co-Scholastics (ECA)
          </h2>
          <p className="text-xs text-muted-foreground">
            Configure extra-curricular assessment areas assessed alongside academics.
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
              Load defaults
            </Button>
          )}
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => setDialogState({ open: true })}
          >
            <Plus className="size-3.5" />
            Add area
          </Button>
        </div> : null}
      </div>

      {isEmpty ? (
        <Empty className="border border-dashed p-6">
          <EmptyHeader>
            <EmptyTitle>No co-scholastic areas</EmptyTitle>
            <EmptyDescription>
              Add assessment areas or generate recommended defaults (Discipline, Arts, Physical Ed).
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
              Generate defaults
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setDialogState({ open: true })}
            >
              <Plus className="size-3.5" />
              Create area
            </Button>
          </EmptyContent> : null}
        </Empty>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {entries.map(([slug, area]) => (
            <AreaItem
              key={slug}
              slug={slug}
              area={area}
              onEdit={onChange ? () => setDialogState({ open: true, editingSlug: slug }) : undefined}
              onDelete={onChange ? () => handleDelete(slug) : undefined}
            />
          ))}
        </div>
      )}

      {onChange && dialogState.open && (
        <AreaDialog
          key={dialogState.editingSlug ?? 'new-area'}
          open={dialogState.open}
          onOpenChange={(open) => setDialogState({ open })}
          initialValues={
            dialogState.editingSlug && areas?.[dialogState.editingSlug]
              ? {
                  slug: dialogState.editingSlug,
                  name: areas[dialogState.editingSlug]!.name,
                }
              : undefined
          }
          existingSlugs={existingSlugs}
          onSubmit={handleAddOrEdit}
        />
      )}
    </div>
  );
}
