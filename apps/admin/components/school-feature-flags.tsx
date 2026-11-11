'use client';

import { useForm } from '@tanstack/react-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import {
  schoolFeatureCatalogue,
  schoolFeatureEntries,
  type SchoolFeatureConfig,
  type SchoolFeatureEntry,
  type SchoolFeatureKey,
} from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import { ConfirmationDialog } from '@campuspilot/components/confirmation-dialog';
import { resolveQueryBoundary } from '@campuspilot/components/query-boundary';
import { Badge } from '@campuspilot/ui/components/badge';
import { Button } from '@campuspilot/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@campuspilot/ui/components/card';
import { Label } from '@campuspilot/ui/components/label';
import { Switch } from '@campuspilot/ui/components/switch';
import { toast } from '@campuspilot/ui/lib/toast';
import { LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { client, orpc } from '@/lib/orpc';

/** The features whose catalogue config is not `z.null()`, i.e. that have settings to edit. */
type FeaturesWithSettings = {
  [K in SchoolFeatureKey]: SchoolFeatureConfig<K> extends null ? never : K;
}[SchoolFeatureKey];

/**
 * Where each feature with settings is edited. Its settings and its on/off
 * switch belong together on that page (switching it on needs settings), so
 * this editor shows such a feature's state and links there instead of
 * offering a switch. Compile-time guard: the record is exhaustive over the
 * features with settings, so a catalogue entry that gains a config schema
 * does not compile until it names its settings page (or this editor grows a
 * config control for it; see docs/feature-flags.md).
 */
const SETTINGS_PAGES: Record<FeaturesWithSettings, { label: string; href: (schoolId: string) => string }> = {
  assistant: { label: 'Open AI settings', href: (schoolId) => `/school/${schoolId}/usage/ai` },
};

/** The settings page of a feature edited on its own page, or null for a switch-only feature. */
function settingsPageOf(feature: SchoolFeatureKey) {
  return feature in SETTINGS_PAGES ? SETTINGS_PAGES[feature as FeaturesWithSettings] : null;
}

/**
 * What switching a feature off does, shown before the change is saved (here,
 * or on the feature's own settings page). Exhaustive, so every new feature
 * states its consequence.
 */
export const DISABLE_WARNINGS: Record<SchoolFeatureKey, string> = {
  cadet:
    'Students of this school can no longer sign in or use the Cadet Portal, including connected AI apps. Staff can no longer issue portal passwords, release exam results to the portal, or save or publish a notice addressed to students. Logins, released results and notices are kept.',
  notices:
    'Staff of this school can no longer open, write or publish notices, or edit the Notice template. Students no longer see notices in the Cadet Portal, and notice notifications that have not gone out yet are not sent. Existing notices are kept.',
  assistant:
    'Staff of this school no longer see the AI assistant or their assistant conversations. A turn in progress is refused at its next model request; a turn waiting for approval stays paused until the assistant is enabled again. Conversations, usage and costs are kept and come back when the assistant is enabled again.',
};

const featureFormSchema = z.object({ enabled: z.boolean() });

function formError(error: unknown): string {
  return typeof error === 'object' && error !== null && 'form' in error
    ? String(error.form)
    : String(error);
}

function FeatureStatusBadge({ enabled }: { enabled: boolean }) {
  return (
    <Badge variant={enabled ? 'default' : 'outline'}>
      {enabled ? 'Enabled' : 'Disabled'}
    </Badge>
  );
}

/**
 * Saves one switch-only feature. The form holds `enabled`; the stored config
 * is sent back unchanged, because enabling or disabling never clears it.
 * Features with settings are edited on their own page (`SETTINGS_PAGES`).
 *
 * `entry` is the feature's key and its own stored state as one discriminated
 * value (`SchoolFeatureEntry`), so the update is built by spreading it and no
 * cast can pair one feature's config with another feature's key.
 */
function useFeatureFlagForm(schoolId: string, entry: SchoolFeatureEntry) {
  const { feature } = entry;
  const queryClient = useQueryClient();
  const form = useForm({
    defaultValues: { enabled: entry.enabled },
    validators: { onSubmit: featureFormSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      try {
        const saved = await client.systemAdmin.updateSchoolFeatureFlag({
          id: schoolId,
          ...entry,
          enabled: value.enabled,
        });
        queryClient.setQueryData(
          orpc.systemAdmin.getSchoolFeatureFlags.queryKey({ input: { id: schoolId } }),
          saved,
        );
        const label = schoolFeatureCatalogue[feature].label;
        toast.success(`${label} ${value.enabled ? 'enabled' : 'disabled'}.`);
      } catch (error) {
        form.setErrorMap({
          onSubmit: {
            form: error instanceof Error ? error.message : 'Unable to save the feature.',
            fields: {},
          },
        });
      }
    },
  });
  return form;
}

type FeatureFlagFormProps = {
  schoolId: string;
  entry: SchoolFeatureEntry;
};

/**
 * `configInvalid`: the stored settings are unusable, so saving is offered
 * even when the switch was not moved; the save stores the entry's (valid)
 * settings in their place.
 *
 * Switching a live feature **off** is confirmed in an app dialog that
 * repeats what stops ({@link DISABLE_WARNINGS}); enabling saves at once.
 * The dialog's open flag is UI state, not form state.
 */
function FeatureFlagForm({ schoolId, entry, configInvalid }: FeatureFlagFormProps & { configInvalid: boolean }) {
  const { feature } = entry;
  const { label } = schoolFeatureCatalogue[feature];
  const form = useFeatureFlagForm(schoolId, entry);
  const [confirmingDisable, setConfirmingDisable] = useState(false);
  const switchId = `feature-${feature}-enabled`;
  const warningId = `feature-${feature}-disable-warning`;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (entry.enabled && !form.state.values.enabled) setConfirmingDisable(true);
        else void form.handleSubmit();
      }}
    >
      <form.Field name="enabled">
        {(field) => (
          <div className="flex items-center justify-between gap-4">
            {/* The feature's name is part of the switch's accessible name, so two cards' switches differ. */}
            <Label htmlFor={switchId}>
              <span className="sr-only">{label}: </span>Enabled for this school
            </Label>
            <Switch
              id={switchId}
              checked={field.state.value}
              aria-describedby={entry.enabled && !field.state.value ? warningId : undefined}
              onCheckedChange={(checked) => field.handleChange(checked)}
            />
          </div>
        )}
      </form.Field>
      <form.Subscribe
        selector={(formState) => ({
          enabled: formState.values.enabled,
          isDirty: formState.isDirty,
          isSubmitting: formState.isSubmitting,
          errors: formState.errors,
        })}
      >
        {({ enabled, isDirty, isSubmitting, errors }) => (
          <div className="flex flex-col gap-3">
            {entry.enabled && !enabled ? (
              <p id={warningId} className="text-xs text-destructive" role="alert">
                {DISABLE_WARNINGS[feature]}
              </p>
            ) : null}
            {errors.map((error) => (
              <p key={formError(error)} className="text-xs text-destructive">
                {formError(error)}
              </p>
            ))}
            <div className="flex justify-end">
              <Button type="submit" disabled={(!isDirty && !configInvalid) || isSubmitting}>
                {isSubmitting ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                {isSubmitting ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
            <ConfirmationDialog
              open={confirmingDisable}
              title={`Disable ${label} for this school?`}
              description={DISABLE_WARNINGS[feature]}
              confirmLabel={isSubmitting ? 'Disabling…' : `Disable ${label}`}
              pending={isSubmitting}
              onOpenChange={setConfirmingDisable}
              onConfirm={() => {
                // A failed save is shown on the card under the switch, so the dialog closes either way.
                void form.handleSubmit().finally(() => setConfirmingDisable(false));
              }}
            />
          </div>
        )}
      </form.Subscribe>
    </form>
  );
}

/**
 * Said on a feature whose stored settings no longer match their schema (the
 * server lists it in `invalidConfigs`). Whether the feature is enabled is
 * still the stored fact shown on the card; only what reads the settings is
 * unavailable. Saving the card stores valid settings again.
 */
function InvalidConfigWarning() {
  return (
    <p className="text-xs text-destructive" role="alert">
      The stored settings of this feature are not valid, so whatever reads them is unavailable for this school. Its
      on/off state still applies. Save this feature to store valid settings again.
    </p>
  );
}

/** A feature edited on its own settings page: its state and a link there. */
function FeatureSettingsLink({ schoolId, settings }: { schoolId: string; settings: { label: string; href: (schoolId: string) => string } }) {
  return (
    <div className="flex justify-end">
      <Button asChild variant="outline">
        <Link href={settings.href(schoolId)}>{settings.label}</Link>
      </Button>
    </div>
  );
}

function FeatureFlagCard({ schoolId, entry, configInvalid }: FeatureFlagFormProps & { configInvalid: boolean }) {
  const { label, description } = schoolFeatureCatalogue[entry.feature];
  const settings = settingsPageOf(entry.feature);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {label}
          <FeatureStatusBadge enabled={entry.enabled} />
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {configInvalid ? <InvalidConfigWarning /> : null}
        {settings ? (
          <FeatureSettingsLink schoolId={schoolId} settings={settings} />
        ) : (
          // Keyed by the saved state so the form restarts from what was stored.
          <FeatureFlagForm key={JSON.stringify([entry, configInvalid])} schoolId={schoolId} entry={entry} configInvalid={configInvalid} />
        )}
      </CardContent>
    </Card>
  );
}

function FeatureFlagsHeading() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">Feature flags</h1>
      <p className="text-sm text-muted-foreground">
        Choose which CampusPilot features this school has. Changes apply at once; the school&apos;s staff cannot
        change them.
      </p>
    </div>
  );
}

/** Platform feature flags of one school: a card per catalogue feature. */
export function SchoolFeatureFlags({ schoolId }: { schoolId: string }) {
  const flagsQuery = useQuery(
    orpc.systemAdmin.getSchoolFeatureFlags.queryOptions({ input: { id: schoolId } }),
  );

  // Flags already shown (and a switch the administrator has just moved) stay
  // when a background refetch fails; see `resolveQueryBoundary`.
  const state = resolveQueryBoundary(flagsQuery);

  if (state.kind === 'pending') {
    return (
      <section className="mx-auto flex w-full max-w-4xl animate-pulse flex-col gap-5">
        <div className="h-14 w-52 rounded-lg bg-muted" />
        <div className="h-36 rounded-lg bg-muted" />
        <div className="h-36 rounded-lg bg-muted" />
      </section>
    );
  }

  if (state.kind === 'failed') {
    return (
      <Card className="mx-auto w-full max-w-4xl">
        <CardHeader>
          <CardTitle>Unable to load feature flags</CardTitle>
          <CardDescription>
            {state.error instanceof Error ? state.error.message : 'Try refreshing the page.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" onClick={() => void flagsQuery.refetch()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { features, invalidConfigs } = state.data;
  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <FeatureFlagsHeading />
      {schoolFeatureEntries(features).map((entry) => (
        <FeatureFlagCard
          key={entry.feature}
          schoolId={schoolId}
          entry={entry}
          configInvalid={invalidConfigs.includes(entry.feature)}
        />
      ))}
    </section>
  );
}
