'use client';

import { useForm } from '@tanstack/react-form';
import { Button } from '@campuspilot/ui/components/button';
import { LoaderCircle, Save, Undo2 } from 'lucide-react';
import { z } from 'zod';
import {
  financeClassOverridesSchema,
  financeSchemaConfigSchema,
  persistedFinanceSchemaConfigSchema,
} from '@campuspilot/db/schema/jsonb/finance-config';
import { ClassFinanceOverridesSection } from './class-finance-overrides-section';
import { FinanceSection } from './finance-section';
import type {
  FinanceClassOverrides,
  FinanceSchemaConfig,
  PersistedFinanceSchemaConfig,
  SchoolSessionFinanceDto,
} from './types';

const financeFormSchema = z.object({
  financeConfig: persistedFinanceSchemaConfigSchema.nullable(),
  classOverrides: financeClassOverridesSchema,
});

export interface SessionFinanceViewProps {
  finance: SchoolSessionFinanceDto;
  isSaving?: boolean;
  onSave?: (updates: {
    financeConfig?: FinanceSchemaConfig | null;
    classOverrides: FinanceClassOverrides;
  }) => Promise<void> | void;
  onDirtyChange?: (isDirty: boolean) => void;
}

function areFinanceValuesEqual(
  finance: SchoolSessionFinanceDto,
  financeConfig: PersistedFinanceSchemaConfig | null,
  classOverrides: FinanceClassOverrides,
) {
  return (
    JSON.stringify(finance.financeConfig) === JSON.stringify(financeConfig) &&
    JSON.stringify(finance.classOverrides) === JSON.stringify(classOverrides)
  );
}

/**
 * Drops overrides whose element no longer supports class scope. This keeps a
 * schema edit and its dependent overrides consistent in the same save.
 */
function retainValidClassOverrides(
  financeConfig: PersistedFinanceSchemaConfig | null,
  classOverrides: FinanceClassOverrides,
) {
  if (!financeConfig) return {};

  const classElementSlugs = new Set(
    Object.entries(financeConfig.elements)
      .filter(([, element]) => element.scopes.includes('class'))
      .map(([slug]) => slug),
  );
  const nextOverrides: FinanceClassOverrides = {};

  for (const [classSlug, values] of Object.entries(classOverrides)) {
    const nextValues = Object.fromEntries(
      Object.entries(values).filter(([elementSlug]) =>
        classElementSlugs.has(elementSlug),
      ),
    );
    if (Object.keys(nextValues).length > 0) nextOverrides[classSlug] = nextValues;
  }

  return nextOverrides;
}

export function SessionFinanceView({
  finance,
  isSaving,
  onSave,
  onDirtyChange,
}: SessionFinanceViewProps) {
  const isEditable = onSave !== undefined;
  const form = useForm({
    defaultValues: {
      financeConfig: finance.financeConfig,
      classOverrides: finance.classOverrides,
    },
    validators: { onSubmit: financeFormSchema },
    onSubmit: async ({ value }) => {
      if (!onSave) return;
      try {
        const parsed = financeFormSchema.parse(value);
        const configChanged =
          JSON.stringify(parsed.financeConfig) !==
          JSON.stringify(finance.financeConfig);
        await onSave({
          ...(configChanged
            ? { financeConfig: financeSchemaConfigSchema.nullable().parse(parsed.financeConfig) }
            : {}),
          classOverrides: parsed.classOverrides,
        });
        form.reset(parsed);
        onDirtyChange?.(false);
      } catch (error) {
        form.setErrorMap({
          onSubmit: {
            form:
              error instanceof Error
                ? error.message
                : 'Unable to save the finance configuration.',
            fields: {},
          },
        });
      }
    },
  });

  function notifyDirty(
    financeConfig: PersistedFinanceSchemaConfig | null,
    classOverrides: FinanceClassOverrides,
  ) {
    onDirtyChange?.(
      !areFinanceValuesEqual(finance, financeConfig, classOverrides),
    );
  }

  function handleFinanceChange(
    financeConfig: PersistedFinanceSchemaConfig | null,
  ) {
    const classOverrides = retainValidClassOverrides(
      financeConfig,
      form.state.values.classOverrides,
    );
    form.setFieldValue('financeConfig', financeConfig);
    form.setFieldValue('classOverrides', classOverrides);
    notifyDirty(financeConfig, classOverrides);
  }

  function handleClassOverridesChange(classOverrides: FinanceClassOverrides) {
    form.setFieldValue('classOverrides', classOverrides);
    notifyDirty(form.state.values.financeConfig, classOverrides);
  }

  function handleReset() {
    form.reset({
      financeConfig: finance.financeConfig,
      classOverrides: finance.classOverrides,
    });
    onDirtyChange?.(false);
  }

  return (
    <form.Subscribe
      selector={(state) => ({
        values: state.values,
        isDirty: state.isDirty,
        errors: state.errors,
      })}
    >
      {({ values, isDirty, errors }) => (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">Financial configuration</h2>
              <p className="text-xs text-muted-foreground">
                Restricted to school finance administrators.
              </p>
            </div>
            {isEditable ? (
              <div className="flex items-center gap-2 self-end sm:self-auto">
                {isDirty ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isSaving}
                    onClick={handleReset}
                  >
                    <Undo2 />
                    Discard
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant={isDirty ? 'default' : 'secondary'}
                  disabled={!isDirty || isSaving}
                  onClick={() => void form.handleSubmit()}
                >
                  {isSaving ? <LoaderCircle className="animate-spin" /> : <Save />}
                  {isSaving ? 'Saving…' : isDirty ? 'Save finance' : 'Saved'}
                </Button>
              </div>
            ) : null}
          </div>

          {!finance.configurationReadiness.readyForBilling &&
          finance.configurationReadiness.status !== 'not_configured' ? (
            <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              Billing remains unavailable until these explicit settings are
              supplied: {finance.configurationReadiness.missingFields.join(', ')}.
            </p>
          ) : null}

          {errors.map((error, index) => {
            const message =
              typeof error === 'object' && error !== null && 'message' in error
                ? String(error.message)
                : typeof error === 'string'
                  ? error
                  : undefined;
            return message ? (
              <p key={`${message}-${index}`} className="text-sm text-destructive">
                {message}
              </p>
            ) : null;
          })}

          <FinanceSection
            financeConfig={values.financeConfig}
            onChange={isEditable ? handleFinanceChange : undefined}
          />
          <ClassFinanceOverridesSection
            financeConfig={values.financeConfig}
            classOverrides={values.classOverrides}
            classes={finance.classes}
            onChange={isEditable ? handleClassOverridesChange : undefined}
          />
        </div>
      )}
    </form.Subscribe>
  );
}
