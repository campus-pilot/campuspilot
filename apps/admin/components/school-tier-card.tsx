'use client';

import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import {
  resolveSchoolFeatureActivity,
  resolveSchoolFeatureSwitches,
  SCHOOL_FEATURE_KEYS,
  SCHOOL_TIERS,
  schoolFeatureCatalogue,
  schoolTierCatalogue,
  type SchoolFeatureFlags,
  type SchoolFeatureKey,
  type SchoolTier,
} from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import { ConfirmationDialog } from '@campuspilot/components/confirmation-dialog';
import { OptionSelect, type OptionSelectOption } from '@campuspilot/components/option-select';
import { Button } from '@campuspilot/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@campuspilot/ui/components/card';
import { Label } from '@campuspilot/ui/components/label';
import { toast } from '@campuspilot/ui/lib/toast';
import { LoaderCircle } from 'lucide-react';
import { client, orpc } from '@/lib/orpc';
import { SchoolTierBadge } from './school-badges';
import { DISABLE_WARNINGS } from './school-feature-warnings';

/** Empty only for a school without a tier until the administrator picks one; it cannot be saved. */
const tierFormSchema = z.object({
  tier: z.union([z.enum(SCHOOL_TIERS), z.literal('')]).refine((tier) => tier !== '', { message: 'Choose a tier.' }),
});

const TIER_OPTIONS: OptionSelectOption<SchoolTier | ''>[] = SCHOOL_TIERS.map((tier) => ({
  value: tier,
  label: schoolTierCatalogue[tier].label,
}));

/** Offered only to a school without a tier: there is no way back to having none. */
const NO_TIER_OPTIONS: OptionSelectOption<SchoolTier | ''>[] = [
  { value: '', label: 'Choose a tier', disabled: true },
  ...TIER_OPTIONS,
];

/**
 * What moving the school to `tier` would do to the features it has: the
 * ones it would lose and the ones it would gain. Decided with the catalogue's
 * own rules (the school's adjustments are kept across a tier change, and a
 * feature also needs the features it requires), so this says exactly what
 * the server will do.
 */
export function tierChangeEffect(features: SchoolFeatureFlags, tier: SchoolTier) {
  const adjustments = Object.fromEntries(
    SCHOOL_FEATURE_KEYS.map((key) => [key, features[key].adjustment]),
  ) as Record<SchoolFeatureKey, boolean | null>;
  const next = resolveSchoolFeatureActivity(resolveSchoolFeatureSwitches(tier, adjustments));
  return {
    lost: SCHOOL_FEATURE_KEYS.filter((key) => features[key].active && !next[key]),
    gained: SCHOOL_FEATURE_KEYS.filter((key) => !features[key].active && next[key]),
  };
}

const featureNames = (keys: SchoolFeatureKey[]) => keys.map((key) => schoolFeatureCatalogue[key].label).join(', ');

/** Saves the school's tier and puts the server's answer (tier and every feature) into the flags query. */
function useTierForm(schoolId: string, tier: SchoolTier | null) {
  const queryClient = useQueryClient();
  const picked: SchoolTier | '' = tier ?? '';
  const form = useForm({
    defaultValues: { tier: picked },
    validators: { onSubmit: tierFormSchema },
    onSubmit: async ({ value }) => {
      // The submit validator refuses an empty tier; this narrows the type.
      if (value.tier === '') return;
      form.setErrorMap({});
      try {
        const saved = await client.systemAdmin.updateSchoolTier({ id: schoolId, tier: value.tier });
        queryClient.setQueryData(orpc.systemAdmin.getSchoolFeatureFlags.queryKey({ input: { id: schoolId } }), saved);
        // The school's tier is also on the school itself (badges, lists).
        void queryClient.invalidateQueries({ queryKey: orpc.systemAdmin.getSchool.queryKey({ input: { id: schoolId } }) });
        void queryClient.invalidateQueries({ queryKey: orpc.systemAdmin.listSchools.key() });
        toast.success(`Moved to ${schoolTierCatalogue[value.tier].label}.`);
      } catch (error) {
        form.setErrorMap({
          onSubmit: { form: error instanceof Error ? error.message : 'Unable to change the tier.', fields: {} },
        });
      }
    },
  });
  return form;
}

type TierForm = ReturnType<typeof useTierForm>;

/** Said under the select while another tier is picked: what the school gains and loses. */
function TierChangeSummary({ features, tier }: { features: SchoolFeatureFlags; tier: SchoolTier }) {
  const { lost, gained } = tierChangeEffect(features, tier);
  if (lost.length === 0 && gained.length === 0) {
    return <p className="text-xs text-muted-foreground">The school keeps exactly the features it has now.</p>;
  }
  return (
    <div className="flex flex-col gap-1 text-xs">
      {gained.length > 0 ? <p className="text-muted-foreground">Adds: {featureNames(gained)}.</p> : null}
      {lost.length > 0 ? <p className="text-destructive">Switches off: {featureNames(lost)}.</p> : null}
    </div>
  );
}

/** The features a tier change takes away, each with everything that stops with it. */
function LostFeatureWarnings({ lost }: { lost: SchoolFeatureKey[] }) {
  return (
    <ul className="flex max-h-72 flex-col gap-3 overflow-y-auto text-xs">
      {lost.map((feature) => (
        <li key={feature} className="flex flex-col gap-1">
          <span className="font-medium">{schoolFeatureCatalogue[feature].label}</span>
          <span className="text-muted-foreground">{DISABLE_WARNINGS[feature]}</span>
        </li>
      ))}
    </ul>
  );
}

function TierField({ form, tier }: { form: TierForm; tier: SchoolTier | null }) {
  return (
    <form.Field name="tier">
      {(field) => (
        <div className="flex flex-col gap-2">
          <Label htmlFor="school-tier">Tier</Label>
          <OptionSelect
            value={field.state.value}
            options={tier === null ? NO_TIER_OPTIONS : TIER_OPTIONS}
            onValueChange={(tier) => field.handleChange(tier)}
            triggerProps={{ id: 'school-tier', className: 'w-full sm:w-64' }}
          />
          <p className="text-xs text-muted-foreground">
            {field.state.value === ''
              ? 'This school has no plan, so no tier gives it any feature.'
              : schoolTierCatalogue[field.state.value].description}
          </p>
        </div>
      )}
    </form.Field>
  );
}

function formError(error: unknown): string {
  return typeof error === 'object' && error !== null && 'form' in error ? String(error.form) : String(error);
}

/**
 * The tier form. A change that takes a feature away from the school is
 * confirmed in an app dialog that names each feature and what stops with it;
 * any other change saves at once. The dialog's open flag is UI state, not
 * form state.
 */
function TierForm({ schoolId, tier, features }: { schoolId: string; tier: SchoolTier | null; features: SchoolFeatureFlags }) {
  const form = useTierForm(schoolId, tier);
  const [confirming, setConfirming] = useState(false);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const picked = form.state.values.tier;
        if (picked !== '' && tierChangeEffect(features, picked).lost.length > 0) setConfirming(true);
        else void form.handleSubmit();
      }}
    >
      <TierField form={form} tier={tier} />
      <form.Subscribe
        selector={(state) => ({ picked: state.values.tier, isSubmitting: state.isSubmitting, errors: state.errors })}
      >
        {({ picked, isSubmitting, errors }) => (
          <div className="flex flex-col gap-3">
            {picked !== '' && picked !== tier ? <TierChangeSummary features={features} tier={picked} /> : null}
            {errors.map((error) => (
              <p key={formError(error)} className="text-xs text-destructive">
                {formError(error)}
              </p>
            ))}
            <div className="flex justify-end">
              <Button type="submit" disabled={picked === '' || picked === tier || isSubmitting}>
                {isSubmitting ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                {isSubmitting ? 'Saving…' : tier === null ? 'Set tier' : 'Change tier'}
              </Button>
            </div>
            {picked === '' ? null : (
              <ConfirmationDialog
                open={confirming}
                title={`Move this school to ${schoolTierCatalogue[picked].label}?`}
                description="The school loses these features at once. Their records are kept and come back if the feature returns."
                confirmLabel={isSubmitting ? 'Moving…' : `Move to ${schoolTierCatalogue[picked].label}`}
                pending={isSubmitting}
                onOpenChange={setConfirming}
                onConfirm={() => {
                  // A failed save is shown on the card, so the dialog closes either way.
                  void form.handleSubmit().finally(() => setConfirming(false));
                }}
              >
                <LostFeatureWarnings lost={tierChangeEffect(features, picked).lost} />
              </ConfirmationDialog>
            )}
          </div>
        )}
      </form.Subscribe>
    </form>
  );
}

/**
 * The school's subscription tier. It decides which features the school has;
 * what an administrator adjusted for this one school (the cards below) is
 * kept when the tier changes.
 */
export function SchoolTierCard({ schoolId, tier, features }: { schoolId: string; tier: SchoolTier | null; features: SchoolFeatureFlags }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Plan
          <SchoolTierBadge tier={tier} />
        </CardTitle>
        <CardDescription>
          The tier decides which features this school has. Features you adjusted for this school below stay as adjusted
          when the tier changes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Keyed by the saved tier so the form restarts from what was stored. */}
        <TierForm key={tier ?? 'none'} schoolId={schoolId} tier={tier} features={features} />
      </CardContent>
    </Card>
  );
}
