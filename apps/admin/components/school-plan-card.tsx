'use client';

import { useForm } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import {
  resolveSchoolPlan,
  SCHOOL_TIERS,
  schoolTierCatalogue,
  type SchoolTier,
} from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import { ConfirmationDialog } from '@campuspilot/components/confirmation-dialog';
import { OptionSelect, type OptionSelectOption } from '@campuspilot/components/option-select';
import { Button } from '@campuspilot/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@campuspilot/ui/components/card';
import { Label } from '@campuspilot/ui/components/label';
import { Separator } from '@campuspilot/ui/components/separator';
import { toast } from '@campuspilot/ui/lib/toast';
import { LoaderCircle } from 'lucide-react';
import { client, orpc } from '@/lib/orpc';
import { formatIstDate } from '@/lib/trial-dates';
import { SchoolNoPlanBadge, SchoolPeriodBadge, SchoolSubscriptionBadge } from './school-badges';
import {
  formErrorText,
  LostFeatureWarnings,
  NO_PLAN_CONSEQUENCE,
  planChangeEffect,
  PlanChangeSummary,
  saveErrorMessage,
  type SchoolPlanFlags,
  useRefreshSchoolPlan,
} from './school-plan-effect';
import { SchoolPeriodSection } from './school-period-section';

type ActivePeriod = SchoolPlanFlags['period'];

/** The standing tier choice: a tier, or none. */
type SubscriptionChoice = SchoolTier | 'none';

const subscriptionFormSchema = z.object({ tier: z.enum([...SCHOOL_TIERS, 'none']) });

const SUBSCRIPTION_OPTIONS: OptionSelectOption<SubscriptionChoice>[] = [
  ...SCHOOL_TIERS.map((tier) => ({ value: tier, label: schoolTierCatalogue[tier].label })),
  { value: 'none', label: 'None (billed by period)' },
];

const subscribedTierOf = (choice: SubscriptionChoice): SchoolTier | null => (choice === 'none' ? null : choice);

/** The plan tier the school would have with this standing tier, next to its active period. */
function planTierWith(choice: SubscriptionChoice, period: ActivePeriod): SchoolTier | null {
  return resolveSchoolPlan({ subscribedTier: subscribedTierOf(choice), activePeriod: period }).tier;
}

/** Saves the standing tier and puts the server's answer (plan and every feature) into the flags query. */
function useSubscriptionForm(schoolId: string, subscribedTier: SchoolTier | null) {
  const queryClient = useQueryClient();
  const refresh = useRefreshSchoolPlan(schoolId);
  const saved: SubscriptionChoice = subscribedTier ?? 'none';
  const form = useForm({
    defaultValues: { tier: saved },
    validators: { onSubmit: subscriptionFormSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      try {
        const tier = subscribedTierOf(value.tier);
        const saved = await client.systemAdmin.updateSchoolTier({ id: schoolId, tier });
        queryClient.setQueryData(orpc.systemAdmin.getSchoolFeatureFlags.queryKey({ input: { id: schoolId } }), saved);
        refresh();
        toast.success(tier === null ? 'Standing tier removed.' : `Standing tier set to ${schoolTierCatalogue[tier].label}.`);
      } catch (error) {
        form.setErrorMap({ onSubmit: { form: saveErrorMessage(error, 'Unable to change the standing tier.'), fields: {} } });
      }
    },
  });
  return form;
}

type SubscriptionForm = ReturnType<typeof useSubscriptionForm>;

/** What the picked standing tier means: the tier's description, or what having none leaves. */
function subscriptionDescription(choice: SubscriptionChoice, period: ActivePeriod): string {
  if (choice !== 'none') return `${schoolTierCatalogue[choice].description} Never lapses and is not billed.`;
  if (period) return `The school has its ${schoolTierCatalogue[period.tier].label} period until ${formatIstDate(period.endsAt)}, then whatever period follows, or no plan.`;
  return 'Without a standing tier or a running period the school has no plan and is read-only.';
}

function SubscriptionField({ form, period }: { form: SubscriptionForm; period: ActivePeriod }) {
  return (
    <form.Field name="tier">
      {(field) => (
        <div className="flex flex-col gap-2">
          <Label htmlFor="school-subscription">Standing tier</Label>
          <OptionSelect
            value={field.state.value}
            options={SUBSCRIPTION_OPTIONS}
            onValueChange={(tier) => field.handleChange(tier)}
            triggerProps={{ id: 'school-subscription', className: 'w-full sm:w-64' }}
          />
          <p className="text-xs text-muted-foreground">{subscriptionDescription(field.state.value, period)}</p>
        </div>
      )}
    </form.Field>
  );
}

/** The confirmation's description: what removing the standing tier or losing features leaves. */
function confirmationDescription(choice: SubscriptionChoice, period: ActivePeriod): string {
  if (choice !== 'none') return 'The school loses these features at once. Their records are kept and come back if the feature returns.';
  if (period) {
    return `The school keeps its ${schoolTierCatalogue[period.tier].label} period until ${formatIstDate(period.endsAt)}. After its periods run out it has no plan. ${NO_PLAN_CONSEQUENCE}`;
  }
  return `The school will have no plan at once. ${NO_PLAN_CONSEQUENCE}`;
}

/**
 * The subscription form. Removing the subscription, or a change that takes
 * a feature away, is confirmed in an app dialog that says what follows;
 * any other change saves at once. The dialog's open flag is UI state, not
 * form state.
 */
function SubscriptionForm({ schoolId, plan }: { schoolId: string; plan: SchoolPlanFlags }) {
  const form = useSubscriptionForm(schoolId, plan.subscribedTier);
  const [confirming, setConfirming] = useState(false);
  const current: SubscriptionChoice = plan.subscribedTier ?? 'none';
  const needsConfirmation = (choice: SubscriptionChoice) =>
    choice === 'none' || planChangeEffect(plan.features, planTierWith(choice, plan.period)).lost.length > 0;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (needsConfirmation(form.state.values.tier)) setConfirming(true);
        else void form.handleSubmit();
      }}
    >
      <SubscriptionField form={form} period={plan.period} />
      <form.Subscribe selector={(state) => ({ picked: state.values.tier, isSubmitting: state.isSubmitting, errors: state.errors })}>
        {({ picked, isSubmitting, errors }) => (
          <div className="flex flex-col gap-3">
            {picked !== current ? <PlanChangeSummary features={plan.features} planTier={planTierWith(picked, plan.period)} /> : null}
            {errors.map((error) => (
              <p key={formErrorText(error)} role="alert" className="text-xs text-destructive">
                {formErrorText(error)}
              </p>
            ))}
            <div className="flex justify-end">
              <Button type="submit" variant={picked === 'none' ? 'destructive' : 'default'} disabled={picked === current || isSubmitting}>
                {isSubmitting ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                {isSubmitting ? 'Saving…' : picked === 'none' ? 'Remove standing tier' : 'Save standing tier'}
              </Button>
            </div>
            <ConfirmationDialog
              open={confirming}
              title={picked === 'none' ? 'Remove the standing tier?' : `Set the standing tier to ${schoolTierCatalogue[picked].label}?`}
              description={confirmationDescription(picked, plan.period)}
              confirmLabel={picked === 'none' ? 'Remove standing tier' : `Set ${schoolTierCatalogue[picked].label}`}
              pending={isSubmitting}
              onOpenChange={setConfirming}
              onConfirm={() => {
                // A failed save is shown on the card, so the dialog closes either way.
                void form.handleSubmit().finally(() => setConfirming(false));
              }}
            >
              <LostFeatureWarnings lost={planChangeEffect(plan.features, planTierWith(picked, plan.period)).lost} />
            </ConfirmationDialog>
          </div>
        )}
      </form.Subscribe>
    </form>
  );
}

/** The card's badges: the plan as the school lists show it. */
function PlanBadges({ plan }: { plan: SchoolPlanFlags }) {
  return (
    <>
      <SchoolSubscriptionBadge subscribedTier={plan.subscribedTier} />
      <SchoolPeriodBadge period={plan.period} />
      <SchoolNoPlanBadge planTier={plan.tier} />
    </>
  );
}

/**
 * The school's plan (docs/school-billing.md): its standing tier (unbilled,
 * never lapses: contracts and demos) and its current billing period. The
 * school has the features of the higher of the two; without either it has
 * no plan and is read-only. What an administrator adjusted for this one
 * school (the cards below) is kept when the plan changes.
 */
export function SchoolPlanCard({ schoolId, plan }: { schoolId: string; plan: SchoolPlanFlags }) {
  return (
    <Card className={plan.tier === null ? 'ring-warning/50' : undefined}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Plan
          <PlanBadges plan={plan} />
        </CardTitle>
        <CardDescription>
          The school has the features of the higher of its standing tier and its current period. Without either it
          has no plan: it is blocked: nothing can be changed and the features of a plan are off. Features you adjusted
          below stay as adjusted.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {/* Keyed by the saved standing tier so the form restarts from what was stored. */}
        <SubscriptionForm key={plan.subscribedTier ?? 'none'} schoolId={schoolId} plan={plan} />
        <Separator />
        <SchoolPeriodSection schoolId={schoolId} plan={plan} />
      </CardContent>
    </Card>
  );
}
