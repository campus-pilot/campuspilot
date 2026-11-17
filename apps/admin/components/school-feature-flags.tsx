'use client';

import { useForm } from '@tanstack/react-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import {
  missingSchoolFeatureRequirements,
  schoolFeatureCatalogue,
  schoolFeatureEntries,
  schoolTierCatalogue,
  type SchoolFeatureConfig,
  type SchoolFeatureEntry,
  type SchoolFeatureKey,
  type SchoolTier,
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
import { RadioGroup, RadioGroupItem } from '@campuspilot/ui/components/radio-group';
import { toast } from '@campuspilot/ui/lib/toast';
import { LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { client, orpc } from '@/lib/orpc';
import { DISABLE_WARNINGS } from './school-feature-warnings';
import { SchoolPlanCard } from './school-plan-card';

/** The features whose catalogue config is not `z.null()`, i.e. that have settings to edit. */
type FeaturesWithSettings = {
  [K in SchoolFeatureKey]: SchoolFeatureConfig<K> extends null ? never : K;
}[SchoolFeatureKey];

/**
 * Where each feature with settings is edited. Its settings and its on/off
 * switch belong together on that page (switching it on needs settings), so
 * this editor shows such a feature's state and links there instead of
 * offering a choice. Compile-time guard: the record is exhaustive over the
 * features with settings, so a catalogue entry that gains a config schema
 * does not compile until it names its settings page (or this editor grows a
 * config control for it; see docs/feature-flags.md).
 */
const SETTINGS_PAGES: Record<FeaturesWithSettings, { label: string; href: (schoolId: string) => string }> = {
  assistant: { label: 'Open AI settings', href: (schoolId) => `/school/${schoolId}/usage/ai` },
};

/** The settings page of a feature edited on its own page, or null for a feature without settings. */
function settingsPageOf(feature: SchoolFeatureKey) {
  return feature in SETTINGS_PAGES ? SETTINGS_PAGES[feature as FeaturesWithSettings] : null;
}

/**
 * The three things an administrator can say about one feature of one
 * school, and the adjustment each one stores (`enabled` of the update):
 * follow the school's tier (null), on whatever the tier (true), off
 * whatever the tier (false).
 */
const ADJUSTMENT_CHOICES = ['tier', 'on', 'off'] as const;
type AdjustmentChoice = (typeof ADJUSTMENT_CHOICES)[number];

const ADJUSTMENT_OF: Record<AdjustmentChoice, boolean | null> = { tier: null, on: true, off: false };

const choiceOf = (adjustment: boolean | null): AdjustmentChoice =>
  adjustment === null ? 'tier' : adjustment ? 'on' : 'off';

/** The feature's switch a choice results in: the adjustment, or what the tier includes without one. */
const switchOf = (choice: AdjustmentChoice, included: boolean) => ADJUSTMENT_OF[choice] ?? included;

const featureFormSchema = z.object({ choice: z.enum(ADJUSTMENT_CHOICES) });

function formError(error: unknown): string {
  return typeof error === 'object' && error !== null && 'form' in error
    ? String(error.form)
    : String(error);
}

/** The facts of one feature's state the editor reads (see `SchoolFeatureState`). */
type FeatureFacts = { included: boolean; adjustment: boolean | null; enabled: boolean };

/**
 * What the feature is for this school, as separate badges: whether the
 * school has its switch on, what its tier says, and whether an administrator
 * adjusted it. A feature in no tier (the assistant) is an add-on.
 */
function FeatureBadges({ feature, tier, state }: { feature: SchoolFeatureKey; tier: SchoolTier | null; state: FeatureFacts }) {
  const addOn = schoolFeatureCatalogue[feature].tiers.length === 0;
  return (
    <>
      <Badge variant={state.enabled ? 'default' : 'outline'}>{state.enabled ? 'Enabled' : 'Disabled'}</Badge>
      {addOn ? (
        <Badge variant="outline">Add-on on every tier</Badge>
      ) : (
        <Badge variant={state.included ? 'secondary' : 'outline'}>
          {tier === null
            ? 'No plan'
            : state.included
              ? `Included in ${schoolTierCatalogue[tier].label}`
              : `Not in ${schoolTierCatalogue[tier].label}`}
        </Badge>
      )}
      {!addOn && state.adjustment !== null ? <Badge variant="outline">Adjusted for this school</Badge> : null}
    </>
  );
}

const SAVED_MESSAGE: Record<AdjustmentChoice, (label: string) => string> = {
  tier: (label) => `${label} follows the tier.`,
  on: (label) => `${label} is always on for this school.`,
  off: (label) => `${label} is always off for this school.`,
};

/**
 * Saves one feature's adjustment. The form holds the choice; the stored
 * config is sent back unchanged, because an adjustment never clears it.
 * Features with settings are edited on their own page (`SETTINGS_PAGES`).
 *
 * `entry` is the feature's key and what is stored for it (its adjustment
 * and config) as one discriminated value (`SchoolFeatureEntry`), so the
 * update is built by spreading it and no cast can pair one feature's config
 * with another feature's key.
 */
function useFeatureFlagForm(schoolId: string, entry: SchoolFeatureEntry) {
  const { feature } = entry;
  const queryClient = useQueryClient();
  const form = useForm({
    defaultValues: { choice: choiceOf(entry.enabled) as AdjustmentChoice },
    validators: { onSubmit: featureFormSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      try {
        const saved = await client.systemAdmin.updateSchoolFeatureFlag({
          id: schoolId,
          ...entry,
          enabled: ADJUSTMENT_OF[value.choice],
        });
        queryClient.setQueryData(
          orpc.systemAdmin.getSchoolFeatureFlags.queryKey({ input: { id: schoolId } }),
          saved,
        );
        toast.success(SAVED_MESSAGE[value.choice](schoolFeatureCatalogue[feature].label));
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

type FeatureFlagFormApi = ReturnType<typeof useFeatureFlagForm>;

type FeatureFlagFormProps = {
  schoolId: string;
  entry: SchoolFeatureEntry;
  state: FeatureFacts;
};

/** What each choice is called; following the tier says what the tier gives. */
function choiceLabel(choice: AdjustmentChoice, included: boolean) {
  if (choice === 'tier') return `Follow tier (${included ? 'On' : 'Off'})`;
  return choice === 'on' ? 'Always on' : 'Always off';
}

/** The three-way choice. The feature's name is the group's accessible name, so two cards' groups differ. */
function AdjustmentField({ form, feature, included }: { form: FeatureFlagFormApi; feature: SchoolFeatureKey; included: boolean }) {
  return (
    <form.Field name="choice">
      {(field) => (
        <RadioGroup
          aria-label={`${schoolFeatureCatalogue[feature].label} for this school`}
          className="flex flex-wrap gap-x-6 gap-y-2"
          value={field.state.value}
          onValueChange={(choice) => field.handleChange(choice as AdjustmentChoice)}
        >
          {ADJUSTMENT_CHOICES.map((choice) => (
            <Label key={choice} className="flex cursor-pointer items-center gap-2 font-normal">
              <RadioGroupItem value={choice} />
              {choiceLabel(choice, included)}
            </Label>
          ))}
        </RadioGroup>
      )}
    </form.Field>
  );
}

/**
 * `configInvalid`: the stored settings are unusable, so saving is offered
 * even when the choice was not moved; the save stores the entry's (valid)
 * settings in their place.
 *
 * A save that turns a feature the school has switched on **off** (by
 * "Always off", or by following a tier that does not include it) is
 * confirmed in an app dialog that repeats what stops
 * ({@link DISABLE_WARNINGS}); anything else saves at once. The dialog's open
 * flag is UI state, not form state.
 */
function FeatureFlagForm({ schoolId, entry, state, configInvalid }: FeatureFlagFormProps & { configInvalid: boolean }) {
  const { feature } = entry;
  const { label } = schoolFeatureCatalogue[feature];
  const form = useFeatureFlagForm(schoolId, entry);
  const [confirmingDisable, setConfirmingDisable] = useState(false);
  const turnsOff = (choice: AdjustmentChoice) => state.enabled && !switchOf(choice, state.included);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (turnsOff(form.state.values.choice)) setConfirmingDisable(true);
        else void form.handleSubmit();
      }}
    >
      <AdjustmentField form={form} feature={feature} included={state.included} />
      <form.Subscribe
        selector={(formState) => ({
          choice: formState.values.choice,
          isDirty: formState.isDirty,
          isSubmitting: formState.isSubmitting,
          errors: formState.errors,
        })}
      >
        {({ choice, isDirty, isSubmitting, errors }) => (
          <div className="flex flex-col gap-3">
            {turnsOff(choice) ? (
              <p className="text-xs text-destructive" role="alert">
                {DISABLE_WARNINGS[feature]}
              </p>
            ) : null}
            {errors.map((error) => (
              <p key={formError(error)} role="alert" className="text-xs text-destructive">
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
                // A failed save is shown on the card under the choice, so the dialog closes either way.
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
 * still the fact shown on the card; only what reads the settings is
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

/**
 * A feature edited on its own settings page: why it is not chosen here, and
 * a link there. Such a feature is an add-on: no tier switches it on, and it
 * is switched on per school together with its settings.
 */
function FeatureSettingsLink({ schoolId, settings }: { schoolId: string; settings: { label: string; href: (schoolId: string) => string } }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        An add-on available on every tier. It is switched on for a school together with its settings.
      </p>
      <Button asChild variant="outline">
        <Link href={settings.href(schoolId)}>{settings.label}</Link>
      </Button>
    </div>
  );
}

/**
 * Shown on a feature whose own switch is on while a feature it requires is
 * off: the school does not have it until that one is switched on again. The
 * switch (from the tier or an adjustment) stays as it is.
 */
function MissingRequirementsNote({ feature, missing }: { feature: SchoolFeatureKey; missing: SchoolFeatureKey[] }) {
  const names = missing.map((key) => schoolFeatureCatalogue[key].label).join(' and ');
  return (
    <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
      {schoolFeatureCatalogue[feature].label} is switched on, but the school does not have it while {names}{' '}
      {missing.length === 1 ? 'is' : 'are'} off. It comes back when {missing.length === 1 ? 'that is' : 'they are'} enabled again.
    </p>
  );
}

type FeatureFlagCardProps = FeatureFlagFormProps & { tier: SchoolTier | null; configInvalid: boolean; missing: SchoolFeatureKey[] };

function FeatureFlagCard({ schoolId, tier, entry, state, configInvalid, missing }: FeatureFlagCardProps) {
  const { label, description } = schoolFeatureCatalogue[entry.feature];
  const settings = settingsPageOf(entry.feature);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {label}
          <FeatureBadges feature={entry.feature} tier={tier} state={state} />
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {configInvalid ? <InvalidConfigWarning /> : null}
        {state.enabled && missing.length > 0 ? <MissingRequirementsNote feature={entry.feature} missing={missing} /> : null}
        {settings ? (
          <FeatureSettingsLink schoolId={schoolId} settings={settings} />
        ) : (
          // Keyed by what is stored and by what the tier gives (which decides
          // what following it means), so the form restarts from the saved state.
          <FeatureFlagForm
            key={JSON.stringify([entry, state.included, state.enabled, configInvalid])}
            schoolId={schoolId}
            entry={entry}
            state={state}
            configInvalid={configInvalid}
          />
        )}
      </CardContent>
    </Card>
  );
}

function FeatureFlagsHeading() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">Plan and features</h1>
      <p className="text-sm text-muted-foreground">
        The school&apos;s plan (its subscription, or a higher trial) decides which CampusPilot features it has.
        Below, a feature can be adjusted for this school alone: always on, always off, or following the tier.
        Changes apply at once; the school&apos;s staff cannot change them.
      </p>
    </div>
  );
}

/** One school's plan: its subscription and trial, then a card per catalogue feature with what the plan's tier gives and the school's adjustment. */
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
          <CardTitle>Unable to load the plan and features</CardTitle>
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

  const { tier, features, invalidConfigs } = state.data;
  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <FeatureFlagsHeading />
      <SchoolPlanCard schoolId={schoolId} plan={state.data} />
      {schoolFeatureEntries(features).map((entry) => (
        <FeatureFlagCard
          key={entry.feature}
          schoolId={schoolId}
          tier={tier}
          entry={entry}
          state={features[entry.feature]}
          configInvalid={invalidConfigs.includes(entry.feature)}
          missing={missingSchoolFeatureRequirements(entry.feature, features)}
        />
      ))}
    </section>
  );
}
