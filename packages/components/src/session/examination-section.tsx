'use client';

import { useState } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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
import {
  GripVertical,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  DEFAULT_EXAMINATIONS,
  slugify,
  type ExamDefinition,
} from './types';

const examFormSchema = z.object({
  name: z.string().trim().min(1, 'Exam name is required'),
  slug: z
    .string()
    .trim()
    .min(1, 'Exam slug is required')
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

interface ExamDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValues?: { slug: string; name: string };
  existingSlugs: string[];
  onSubmit: (values: { slug: string; name: string }) => void;
}

function ExamDialog({
  open,
  onOpenChange,
  initialValues,
  existingSlugs,
  onSubmit,
}: ExamDialogProps) {
  const isEditing = Boolean(initialValues);
  const form = useForm({
    defaultValues: {
      name: initialValues?.name ?? '',
      slug: initialValues?.slug ?? '',
    },
    validators: {
      onSubmit: examFormSchema.refine(
        (val) => {
          if (isEditing && val.slug === initialValues?.slug) return true;
          return !existingSlugs.includes(val.slug);
        },
        {
          message: 'An examination with this slug already exists.',
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
            {isEditing ? 'Edit examination' : 'Add examination'}
          </DialogTitle>
          <DialogDescription>
            Enter the display name and unique identifier for this examination.
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
                <Label htmlFor="exam-name">Exam name</Label>
                <Input
                  id="exam-name"
                  placeholder="e.g. Mid-Term Examination"
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
                <Label htmlFor="exam-slug">Identifier (slug)</Label>
                <Input
                  id="exam-slug"
                  placeholder="e.g. mid_term_examination"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Unique key used for exam reports and database mapping.
                </p>
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
                  {isEditing ? 'Save changes' : 'Add examination'}
                </Button>
              </DialogFooter>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface SortableExamItemProps {
  id: string;
  exam: ExamDefinition;
  onEdit: () => void;
  onDelete: () => void;
}

function SortableExamItem({ id, exam, onEdit, onDelete }: SortableExamItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-xs"
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
          aria-label={`Reorder ${exam.name}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
        <Badge variant="secondary" className="font-mono text-[10px]">
          #{exam.order}
        </Badge>
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-foreground">{exam.name}</span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {id}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Edit ${exam.name}`}
          onClick={onEdit}
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete ${exam.name}`}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

export interface ExaminationSectionProps {
  examConfig: Record<string, ExamDefinition> | null | undefined;
  onChange: (nextConfig: Record<string, ExamDefinition>) => void;
}

export function ExaminationSection({
  examConfig,
  onChange,
}: ExaminationSectionProps) {
  const [dialogState, setDialogState] = useState<{
    open: boolean;
    editingSlug?: string;
  }>({ open: false });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const entries = Object.entries(examConfig ?? {}).sort(
    ([, a], [, b]) => a.order - b.order,
  );
  const isEmpty = entries.length === 0;
  const sortedKeys = entries.map(([slug]) => slug);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = sortedKeys.indexOf(String(active.id));
    const newIndex = sortedKeys.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    const reorderedKeys = arrayMove(sortedKeys, oldIndex, newIndex);
    const updated: Record<string, ExamDefinition> = {};
    reorderedKeys.forEach((key, index) => {
      const existing = examConfig?.[key];
      if (existing) {
        updated[key] = {
          name: existing.name,
          order: index + 1,
        };
      }
    });
    onChange(updated);
  }

  function handleAddOrEdit(values: { slug: string; name: string }) {
    const current = { ...(examConfig ?? {}) };
    if (dialogState.editingSlug && dialogState.editingSlug !== values.slug) {
      delete current[dialogState.editingSlug];
    }
    const order =
      dialogState.editingSlug && current[dialogState.editingSlug]
        ? current[dialogState.editingSlug]!.order
        : entries.length + 1;

    current[values.slug] = {
      name: values.name,
      order,
    };
    onChange(current);
  }

  function handleDelete(slug: string) {
    const current = { ...(examConfig ?? {}) };
    delete current[slug];
    // Normalize order after deletion
    const remaining = Object.entries(current).sort(
      ([, a], [, b]) => a.order - b.order,
    );
    const normalized: Record<string, ExamDefinition> = {};
    remaining.forEach(([key, val], index) => {
      normalized[key] = { name: val.name, order: index + 1 };
    });
    onChange(normalized);
  }

  function handleLoadDefaults() {
    const defaults: Record<string, ExamDefinition> = {};
    DEFAULT_EXAMINATIONS.forEach((item) => {
      defaults[item.slug] = { name: item.name, order: item.order };
    });
    onChange(defaults);
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            Examinations
          </h2>
          <p className="text-xs text-muted-foreground">
            Define all examinations in your school for this session. Drag to preserve examination order.
          </p>
        </div>
        <div className="flex items-center gap-2">
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
            Add exam
          </Button>
        </div>
      </div>

      {isEmpty ? (
        <Empty className="border border-dashed p-6">
          <EmptyHeader>
            <EmptyTitle>No examinations configured</EmptyTitle>
            <EmptyDescription>
              Add academic assessments for this session, or initialize with recommended terms.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleLoadDefaults}
            >
              <Sparkles className="size-3.5" />
              Load recommended
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setDialogState({ open: true })}
            >
              <Plus className="size-3.5" />
              Create examination
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <DndContext
          id="examination-sortable-context"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={sortedKeys}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col gap-2">
              {entries.map(([slug, exam]) => (
                <SortableExamItem
                  key={slug}
                  id={slug}
                  exam={exam}
                  onEdit={() =>
                    setDialogState({ open: true, editingSlug: slug })
                  }
                  onDelete={() => handleDelete(slug)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {dialogState.open && (
        <ExamDialog
          key={dialogState.editingSlug ?? 'new-exam'}
          open={dialogState.open}
          onOpenChange={(open) => setDialogState({ open })}
          initialValues={
            dialogState.editingSlug && examConfig?.[dialogState.editingSlug]
              ? {
                  slug: dialogState.editingSlug,
                  name: examConfig[dialogState.editingSlug]!.name,
                }
              : undefined
          }
          existingSlugs={sortedKeys}
          onSubmit={handleAddOrEdit}
        />
      )}
    </div>
  );
}
