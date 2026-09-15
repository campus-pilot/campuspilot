'use client';

import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Badge } from '@campuspilot/ui/components/badge';
import { Button } from '@campuspilot/ui/components/button';
import { Checkbox } from '@campuspilot/ui/components/checkbox';
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
  NativeSelect,
  NativeSelectOption,
} from '@campuspilot/ui/components/native-select';
import {
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  DEFAULT_FINANCE_CONFIG,
  EXAMPLE_ELEMENTS,
  REQUIRED_LEVEL_LABELS,
  SCOPE_OPTIONS,
  slugify,
  type FinanceElement,
  type FinanceRecurring,
  type FinanceRequiredLevel,
  type FinanceSchemaConfig,
  type FinanceScope,
} from './types';

const elementFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Element name is required'),
    slug: z
      .string()
      .trim()
      .min(1, 'Element slug is required')
      .regex(/^[a-z0-9_]+$/, 'Slug can only contain lowercase letters, numbers, and underscores'),
    scopes: z
      .array(z.enum(['school', 'class', 'student']))
      .min(1, 'Select at least one scope'),
    requiredAtLevel: z.enum([
      'school',
      'class',
      'student',
      'bill_generation',
      'none',
    ]),
    defaultValue: z.number().min(0).optional(),
  })
  .refine(
    (data) =>
      data.defaultValue === undefined ||
      (data.requiredAtLevel !== 'none' && data.requiredAtLevel != null),
    {
      message: 'Default value can only be set when a required level is chosen',
      path: ['defaultValue'],
    },
  );

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

function scopeBadgeVariant(scope: FinanceScope) {
  switch (scope) {
    case 'school':
      return 'secondary';
    case 'class':
      return 'outline';
    case 'student':
      return 'default';
  }
}

interface FeeElementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValues?: { slug: string; element: FinanceElement };
  existingSlugs: string[];
  onSubmit: (values: { slug: string; element: FinanceElement }) => void;
}

function FeeElementDialog({
  open,
  onOpenChange,
  initialValues,
  existingSlugs,
  onSubmit,
}: FeeElementDialogProps) {
  const isEditing = Boolean(initialValues);
  const form = useForm({
    defaultValues: {
      name: initialValues?.element.name ?? '',
      slug: initialValues?.slug ?? '',
      scopes: initialValues?.element.scopes ?? (['class'] as FinanceScope[]),
      requiredAtLevel: (initialValues?.element.requiredAtLevel ??
        'none') as 'school' | 'class' | 'student' | 'bill_generation' | 'none',
      defaultValue: initialValues?.element.defaultValue,
    } as {
      name: string;
      slug: string;
      scopes: FinanceScope[];
      requiredAtLevel: 'school' | 'class' | 'student' | 'bill_generation' | 'none';
      defaultValue?: number;
    },
    validators: {
      onSubmit: elementFormSchema.refine(
        (val) => {
          if (isEditing && val.slug === initialValues?.slug) return true;
          return !existingSlugs.includes(val.slug);
        },
        {
          message: 'A fee element with this identifier already exists.',
          path: ['slug'],
        },
      ),
    },
    onSubmit: ({ value }) => {
      const requiredAtLevel =
        value.requiredAtLevel === 'none'
          ? undefined
          : (value.requiredAtLevel as FinanceRequiredLevel);

      const element: FinanceElement = {
        name: value.name,
        scopes: value.scopes,
        requiredAtLevel,
        defaultValue:
          value.defaultValue !== undefined && !Number.isNaN(value.defaultValue)
            ? value.defaultValue
            : undefined,
      };

      onSubmit({ slug: value.slug, element });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit fee element' : 'Add fee element'}
          </DialogTitle>
          <DialogDescription>
            Configure where this fee is assigned and whether a default amount applies.
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
          <div className="grid gap-3 sm:grid-cols-2">
            <form.Field name="name">
              {(field) => (
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <Label htmlFor="element-name">Fee name</Label>
                  <Input
                    id="element-name"
                    placeholder="e.g. Tuition Fee"
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
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <Label htmlFor="element-slug">Identifier (slug)</Label>
                  <Input
                    id="element-slug"
                    placeholder="e.g. tuition_fee"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  <FieldErrors errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>

            <form.Field name="scopes">
              {(field) => (
                <div className="flex flex-col gap-2 sm:col-span-2">
                  <Label>Assignable scopes</Label>
                  <div className="flex flex-wrap gap-4">
                    {SCOPE_OPTIONS.map((opt) => {
                      const isChecked = field.state.value.includes(opt.value);
                      return (
                        <label
                          key={opt.value}
                          className="flex cursor-pointer items-center gap-2 text-xs font-normal"
                        >
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                field.handleChange([...field.state.value, opt.value]);
                              } else {
                                field.handleChange(
                                  field.state.value.filter((s: FinanceScope) => s !== opt.value),
                                );
                              }
                            }}
                          />
                          <span>{opt.label}</span>
                        </label>
                      );
                    })}
                  </div>
                  <FieldErrors errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>

            <form.Field name="requiredAtLevel">
              {(field) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="required-level">Required level</Label>
                  <NativeSelect
                    id="required-level"
                    value={field.state.value}
                    onChange={(event) =>
                      field.handleChange(
                        event.target.value as
                          | 'school'
                          | 'class'
                          | 'student'
                          | 'bill_generation'
                          | 'none',
                      )
                    }
                  >
                    <NativeSelectOption value="none">Optional / None</NativeSelectOption>
                    <NativeSelectOption value="school">School</NativeSelectOption>
                    <NativeSelectOption value="class">Class</NativeSelectOption>
                    <NativeSelectOption value="student">Student</NativeSelectOption>
                    <NativeSelectOption value="bill_generation">
                      While Bill Generation
                    </NativeSelectOption>
                  </NativeSelect>
                  <FieldErrors errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>

            <form.Field name="defaultValue">
              {(field) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="element-default-value">
                    Default amount (optional)
                  </Label>
                  <Input
                    id="element-default-value"
                    type="number"
                    min={0}
                    placeholder="0"
                    value={field.state.value ?? ''}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      const val = event.target.value;
                      field.handleChange(val === '' ? undefined : Number(val));
                    }}
                  />
                  <FieldErrors errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>
          </div>

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
                  {isEditing ? 'Save element' : 'Add element'}
                </Button>
              </DialogFooter>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export interface FinanceSectionProps {
  financeConfig: FinanceSchemaConfig | null | undefined;
  onChange: (nextConfig: FinanceSchemaConfig | null) => void;
}

export function FinanceSection({
  financeConfig,
  onChange,
}: FinanceSectionProps) {
  const [dialogState, setDialogState] = useState<{
    open: boolean;
    editingSlug?: string;
  }>({ open: false });

  const elements: Record<string, FinanceElement> =
    financeConfig?.elements ?? {};
  const entries: [string, FinanceElement][] = Object.entries(elements);
  const existingSlugs = entries.map(([slug]) => slug);

  function handleCreateDefault() {
    onChange({ ...DEFAULT_FINANCE_CONFIG });
  }

  function handleCreateWithExamples() {
    const exampleMap: Record<string, FinanceElement> = {};
    EXAMPLE_ELEMENTS.forEach((item) => {
      exampleMap[item.slug] = {
        name: item.name,
        scopes: item.scopes,
        requiredAtLevel: item.requiredAtLevel,
        defaultValue: item.defaultValue,
      };
    });
    onChange({
      recurring: 'monthly',
      currency: 'INR',
      elements: exampleMap,
    });
  }

  function handleRecurringChange(recurring: FinanceRecurring) {
    if (!financeConfig) return;
    onChange({ ...financeConfig, recurring });
  }

  function handleCurrencyChange(currency: string) {
    if (!financeConfig) return;
    onChange({ ...financeConfig, currency: currency.toUpperCase() });
  }

  function handleAddOrEditElement(values: {
    slug: string;
    element: FinanceElement;
  }) {
    if (!financeConfig) return;
    const currentElements = { ...financeConfig.elements };
    if (dialogState.editingSlug && dialogState.editingSlug !== values.slug) {
      delete currentElements[dialogState.editingSlug];
    }
    currentElements[values.slug] = values.element;
    onChange({ ...financeConfig, elements: currentElements });
  }

  function handleDeleteElement(slug: string) {
    if (!financeConfig) return;
    const currentElements = { ...financeConfig.elements };
    delete currentElements[slug];
    onChange({ ...financeConfig, elements: currentElements });
  }

  function handleQuickAddExample(item: (typeof EXAMPLE_ELEMENTS)[0]) {
    if (!financeConfig) return;
    const currentElements = { ...financeConfig.elements };
    currentElements[item.slug] = {
      name: item.name,
      scopes: item.scopes,
      requiredAtLevel: item.requiredAtLevel,
      defaultValue: item.defaultValue,
    };
    onChange({ ...financeConfig, elements: currentElements });
  }

  if (!financeConfig) {
    return (
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            Finance
          </h2>
          <p className="text-xs text-muted-foreground">
            Fee structure, billing schedule, and hierarchical overrides.
          </p>
        </div>
        <Empty className="border border-dashed p-6">
          <EmptyHeader>
            <EmptyTitle>No finance schema configured</EmptyTitle>
            <EmptyDescription>
              Set up fee elements and recurring billing frequency, or start with standard school fee blueprints.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCreateWithExamples}
            >
              <Sparkles className="size-3.5" />
              Load example fees
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleCreateDefault}
            >
              <Plus className="size-3.5" />
              Create finance schema
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            Finance
          </h2>
          <p className="text-xs text-muted-foreground">
            Define fee elements, scopes, and recurring intervals for student billing.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange(null)}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            Clear schema
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => setDialogState({ open: true })}
          >
            <Plus className="size-3.5" />
            Add fee element
          </Button>
        </div>
      </div>

      <div className="grid gap-3 rounded-lg border border-border bg-background p-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="finance-recurring">Billing frequency</Label>
          <NativeSelect
            id="finance-recurring"
            value={financeConfig.recurring}
            onChange={(event) =>
              handleRecurringChange(event.target.value as FinanceRecurring)
            }
          >
            <NativeSelectOption value="monthly">Monthly</NativeSelectOption>
            <NativeSelectOption value="quarterly">Quarterly</NativeSelectOption>
            <NativeSelectOption value="yearly">Yearly</NativeSelectOption>
          </NativeSelect>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="finance-currency">Currency (ISO 4217)</Label>
          <Input
            id="finance-currency"
            value={financeConfig.currency ?? 'INR'}
            maxLength={3}
            className="font-mono uppercase"
            onChange={(event) => handleCurrencyChange(event.target.value)}
          />
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="flex flex-col gap-3 rounded-lg border border-dashed p-4 text-center">
          <p className="text-xs text-muted-foreground">
            No fee elements added yet. Add a custom element or pick from common school fee types:
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {EXAMPLE_ELEMENTS.map((item) => (
              <Button
                key={item.slug}
                type="button"
                variant="outline"
                size="xs"
                onClick={() => handleQuickAddExample(item)}
              >
                <Plus className="size-2.5" />
                {item.name}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_auto] items-center bg-muted/40 px-3 py-2 text-[11px] font-medium text-muted-foreground">
            <span>Fee element</span>
            <span>Assignable to</span>
            <span>Required at</span>
            <span>Default</span>
            <span className="text-right">Actions</span>
          </div>
          <div className="divide-y divide-border bg-background">
            {entries.map(([slug, element]) => (
              <div
                key={slug}
                className="grid grid-cols-[1.5fr_1fr_1fr_1fr_auto] items-center px-3 py-2 text-xs"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-foreground">{element.name}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {slug}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {element.scopes.map((s) => (
                    <Badge
                      key={s}
                      variant={scopeBadgeVariant(s)}
                      className="text-[10px] capitalize"
                    >
                      {s}
                    </Badge>
                  ))}
                </div>
                <div>
                  {element.requiredAtLevel ? (
                    <Badge variant="outline" className="text-[10px]">
                      {REQUIRED_LEVEL_LABELS[element.requiredAtLevel] ??
                        element.requiredAtLevel}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">&mdash;</span>
                  )}
                </div>
                <span className="font-mono text-xs text-foreground">
                  {element.defaultValue !== undefined
                    ? `${element.defaultValue} ${financeConfig.currency}`
                    : '&mdash;'}
                </span>
                <div className="flex items-center justify-end gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Edit ${element.name}`}
                    onClick={() =>
                      setDialogState({ open: true, editingSlug: slug })
                    }
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${element.name}`}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => handleDeleteElement(slug)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {dialogState.open && (
        <FeeElementDialog
          key={dialogState.editingSlug ?? 'new-element'}
          open={dialogState.open}
          onOpenChange={(open) => setDialogState({ open })}
          initialValues={
            dialogState.editingSlug && elements[dialogState.editingSlug]
              ? {
                  slug: dialogState.editingSlug,
                  element: elements[dialogState.editingSlug]!,
                }
              : undefined
          }
          existingSlugs={existingSlugs}
          onSubmit={handleAddOrEditElement}
        />
      )}
    </div>
  );
}
