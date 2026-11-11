'use client';

import {
  schoolFeatureCatalogue,
  type SchoolFeatureConfig,
} from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import { roleEnum, type Role } from '@campuspilot/api/routers/school/member/member.dto';
import { ConfirmationDialog } from '@campuspilot/components/confirmation-dialog';
import { Button } from '@campuspilot/ui/components/button';
import { Checkbox } from '@campuspilot/ui/components/checkbox';
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from '@campuspilot/ui/components/field';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import { Switch } from '@campuspilot/ui/components/switch';
import { toast } from '@campuspilot/ui/lib/toast';
import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';

import { DISABLE_WARNINGS } from '@/components/school-feature-flags';
import { client, orpc } from '@/lib/orpc';

type AssistantConfig = SchoolFeatureConfig<'assistant'>;

const ROLE_LABELS: Record<Role, string> = {
  principal: 'Principal',
  manager: 'Manager',
  teacher: 'Teacher',
  accountant: 'Accountant',
  exam_coordinator: 'Exam coordinator',
};

/** A limit in whole dollars and cents, or empty for none. */
const LIMIT_PATTERN = /^\d{1,7}(\.\d{1,2})?$/;

const limitIsValid = (value: string) =>
  value.trim() === '' || (LIMIT_PATTERN.test(value.trim()) && Number(value) > 0 && Number(value) <= 1_000_000);

/**
 * Enabling needs valid settings (a limit or none, and at least one role).
 * Switching off never does: invalid or incomplete settings are then not
 * saved and the stored ones are kept (see `configToSave`).
 */
const settingsSchema = z
  .object({ enabled: z.boolean(), monthlyLimitUsd: z.string(), eligibleRoles: z.array(roleEnum) })
  .superRefine((value, context) => {
    if (!value.enabled) return;
    if (!limitIsValid(value.monthlyLimitUsd)) {
      context.addIssue({
        code: 'custom',
        path: ['monthlyLimitUsd'],
        message: 'Enter a positive amount in USD (at most two decimals), or leave it empty for no limit.',
      });
    }
    if (value.eligibleRoles.length === 0) {
      context.addIssue({ code: 'custom', path: ['eligibleRoles'], message: 'Choose at least one role.' });
    }
  });

type SettingsValues = z.infer<typeof settingsSchema>;

/**
 * The settings sent with a save: the form's when they are valid; when
 * switching off with settings that are not, the stored ones (possibly none),
 * so the switch never fails on them and nothing valid is lost.
 */
function configToSave(value: SettingsValues, stored: AssistantConfig | null): AssistantConfig | null {
  const limit = value.monthlyLimitUsd.trim();
  if (limitIsValid(limit) && value.eligibleRoles.length > 0) {
    return { monthlyLimitUsd: limit === '' ? null : Number(limit), eligibleRoles: value.eligibleRoles };
  }
  return stored;
}

const errorText = (error: unknown) => (typeof error === 'string' ? error : (error as { message?: string } | undefined)?.message);

/**
 * The school's `assistant` feature flag: on or off, its monthly USD limit
 * (IST calendar month) and the roles the school may open the assistant to.
 * Saved as one flag update; switching it off asks first and keeps the
 * settings. Which eligible roles actually use it is the school's choice, in
 * its own settings.
 */
function useAssistantSettingsForm(schoolId: string, stored: { enabled: boolean; config: AssistantConfig | null }) {
  const queryClient = useQueryClient();
  const form = useForm({
    defaultValues: {
      enabled: stored.enabled,
      monthlyLimitUsd: stored.config?.monthlyLimitUsd == null ? '' : String(stored.config.monthlyLimitUsd),
      eligibleRoles: stored.config?.eligibleRoles ?? [],
    } as SettingsValues,
    validators: { onSubmit: settingsSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      try {
        const saved = await client.systemAdmin.updateSchoolFeatureFlag({
          id: schoolId,
          feature: 'assistant',
          enabled: value.enabled,
          config: configToSave(value, stored.config),
        });
        queryClient.setQueryData(orpc.systemAdmin.getSchoolFeatureFlags.queryKey({ input: { id: schoolId } }), saved);
        toast.success('AI assistant settings saved.');
      } catch (error) {
        form.setErrorMap({
          onSubmit: { form: error instanceof Error ? error.message : 'Unable to save the settings.', fields: {} },
        });
      }
    },
  });
  return form;
}

type SettingsForm = ReturnType<typeof useAssistantSettingsForm>;

function EnabledField({ form }: { form: SettingsForm }) {
  return (
    <form.Field name="enabled">
      {(field) => (
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="assistant-enabled">Enabled for this school</Label>
          <Switch id="assistant-enabled" checked={field.state.value} onCheckedChange={(checked) => field.handleChange(checked)} />
        </div>
      )}
    </form.Field>
  );
}

function LimitField({ form }: { form: SettingsForm }) {
  return (
    <form.Field name="monthlyLimitUsd">
      {(field) => (
        <Field>
          <FieldLabel htmlFor="assistant-limit">Monthly limit (USD)</FieldLabel>
          <Input
            id="assistant-limit"
            inputMode="decimal"
            placeholder="No limit"
            className="max-w-48"
            value={field.state.value}
            onChange={(event) => field.handleChange(event.target.value)}
            aria-invalid={field.state.meta.errors.length > 0}
          />
          <FieldDescription>
            Per calendar month in IST. Once the school’s spend reaches it, nobody in the school can use the assistant until the 1st.
            Checked against spend up to 10 minutes old.
          </FieldDescription>
          <FieldError errors={field.state.meta.errors.map((error) => ({ message: errorText(error) }))} />
        </Field>
      )}
    </form.Field>
  );
}

function RolesField({ form }: { form: SettingsForm }) {
  return (
    <form.Field name="eligibleRoles">
      {(field) => (
        <FieldSet>
          <FieldLegend variant="label">Eligible roles</FieldLegend>
          <FieldDescription>The roles the school may switch the assistant on for, in its own settings.</FieldDescription>
          <div className="flex flex-wrap gap-4">
            {roleEnum.options.map((role) => (
              <Label key={role} className="flex items-center gap-2 font-normal">
                <Checkbox
                  checked={field.state.value.includes(role)}
                  onCheckedChange={(checked) =>
                    field.handleChange(
                      checked === true ? [...field.state.value, role] : field.state.value.filter((value) => value !== role),
                    )
                  }
                />
                {ROLE_LABELS[role]}
              </Label>
            ))}
          </div>
          <FieldError errors={field.state.meta.errors.map((error) => ({ message: errorText(error) }))} />
        </FieldSet>
      )}
    </form.Field>
  );
}

/**
 * Saving, by the button or by Enter in a field: switching a live assistant
 * off asks first (the confirmation dialog), anything else saves at once.
 * The dialog's open flag is UI state, not form state.
 */
function useSaveRequest(form: SettingsForm, wasEnabled: boolean) {
  const [confirmingDisable, setConfirmingDisable] = useState(false);
  const requestSave = () => {
    if (wasEnabled && !form.state.values.enabled) setConfirmingDisable(true);
    else void form.handleSubmit();
  };
  return { confirmingDisable, setConfirmingDisable, requestSave };
}

type SaveRequest = ReturnType<typeof useSaveRequest>;

function SaveRow({ form, wasEnabled, save }: { form: SettingsForm; wasEnabled: boolean; save: SaveRequest }) {
  const { confirmingDisable, setConfirmingDisable, requestSave } = save;
  const label = schoolFeatureCatalogue.assistant.label;
  return (
    <form.Subscribe
      selector={(state) => ({ enabled: state.values.enabled, isDirty: state.isDirty, isSubmitting: state.isSubmitting, errors: state.errors })}
    >
      {({ enabled, isDirty, isSubmitting, errors }) => (
        <div className="flex flex-col gap-3">
          {wasEnabled && !enabled ? (
            <p className="text-xs text-destructive" role="alert">
              {DISABLE_WARNINGS.assistant}
            </p>
          ) : null}
          {errors.map((error) => (
            <p key={String(errorText(error) ?? error)} className="text-xs text-destructive">
              {String(typeof error === 'object' && error && 'form' in error ? error.form : (errorText(error) ?? error))}
            </p>
          ))}
          <div className="flex justify-end">
            <Button
              type="button"
              disabled={!isDirty || isSubmitting}
              onClick={requestSave}
            >
              {isSubmitting ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
              {isSubmitting ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
          <ConfirmationDialog
            open={confirmingDisable}
            title={`Disable ${label} for this school?`}
            description={DISABLE_WARNINGS.assistant}
            confirmLabel={isSubmitting ? 'Disabling…' : `Disable ${label}`}
            pending={isSubmitting}
            onOpenChange={setConfirmingDisable}
            onConfirm={() => {
              void form.handleSubmit().finally(() => setConfirmingDisable(false));
            }}
          />
        </div>
      )}
    </form.Subscribe>
  );
}

/** The settings form, keyed by the caller on the stored state so it restarts from what was saved. */
export function AssistantSettingsForm({
  schoolId,
  stored,
}: {
  schoolId: string;
  stored: { enabled: boolean; config: AssistantConfig | null };
}) {
  const form = useAssistantSettingsForm(schoolId, stored);
  const save = useSaveRequest(form, stored.enabled);
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        save.requestSave();
      }}
    >
      <EnabledField form={form} />
      <LimitField form={form} />
      <RolesField form={form} />
      <SaveRow form={form} wasEnabled={stored.enabled} save={save} />
    </form>
  );
}
