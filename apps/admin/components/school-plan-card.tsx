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
import { SchoolNoPlanBadge, SchoolSubscriptionBadge, SchoolTrialBadge } from './school-badges';
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
import { SchoolTrialSection } from './school-trial-section';

type ActiveTrial = SchoolPlanFlags['trial'];

/** The subscription choice: a tier, or none. */
type SubscriptionChoice = SchoolTier | 'none';

const subscriptionFormSchema = z.object({ tier: z.enum([...SCHOOL_TIERS, 'none']) });

const SUBSCRIPTION_OPTIONS: OptionSelectOption<SubscriptionChoice>[] = [
  ...SCHOOL_TIERS.map((tier) => ({ value: tier, label: schoolTierCatalogue[tier].label })),
  { value: 'none', label: 'No subscription' },
];

const subscribedTierOf = (choice: SubscriptionChoice): SchoolTier | null => (choice === 'none' ? null : choice);

/** The plan tier the school would have with this subscription, next to its active trial. */
function planTierWith(choice: SubscriptionChoice, trial: ActiveTrial): SchoolTier | null {
  return resolveSchoolPlan({ subscribedTier: subscribedTierOf(choice), activeTrial: trial }).tier;
}

/** Saves the subscription and puts the server's answer (plan and every feature) into the flags query. */
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
        toast.success(tier === null ? 'Subscription removed.' : `Subscribed to ${schoolTierCatalogue[tier].label}.`);
      } catch (error) {
        form.setErrorMap({ onSubmit: { form: saveErrorMessage(error, 'Unable to change the subscription.'), fields: {} } });
      }
    },
  });
  return form;
}

type SubscriptionForm = ReturnType<typeof useSubscriptionForm>;

/** What the picked subscription means: the tier's description, or what having none leaves. */
function subscriptionDescription(choice: SubscriptionChoice, trial: ActiveTrial): string {
  if (choice !== 'none') return schoolTierCatalogue[choice].description;
  if (trial) return `The school has its ${schoolTierCatalogue[trial.tier].label} trial until ${formatIstDate(trial.endsAt)}, then no plan.`;
  return 'Without a subscription or a trial the school has no plan and is read-only.';
}

function SubscriptionField({ form, trial }: { form: SubscriptionForm; trial: ActiveTrial }) {
  return (
    <form.Field name="tier">
      {(field) => (
        <div className="flex flex-col gap-2">
          <Label htmlFor="school-subscription">Subscription</Label>
          <OptionSelect
            value={field.state.value}
            options={SUBSCRIPTION_OPTIONS}
            onValueChange={(tier) => field.handleChange(tier)}
            triggerProps={{ id: 'school-subscription', className: 'w-full sm:w-64' }}
          />
          <p className="text-xs text-muted-foreground">{subscriptionDescription(field.state.value, trial)}</p>
        </div>
      )}
    </form.Field>
  );
}

/** The confirmation's description: what removing the subscription or losing features leaves. */
function confirmationDescription(choice: SubscriptionChoice, trial: ActiveTrial): string {
  if (choice !== 'none') return 'The school loses these features at once. Their records are kept and come back if the feature returns.';
  if (trial) {
    return `The school keeps its ${schoolTierCatalogue[trial.tier].label} trial until ${formatIstDate(trial.endsAt)}. After that it has no plan. ${NO_PLAN_CONSEQUENCE}`;
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
    choice === 'none' || planChangeEffect(plan.features, planTierWith(choice, plan.trial)).lost.length > 0;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (needsConfirmation(form.state.values.tier)) setConfirming(true);
        else void form.handleSubmit();
      }}
    >
      <SubscriptionField form={form} trial={plan.trial} />
      <form.Subscribe selector={(state) => ({ picked: state.values.tier, isSubmitting: state.isSubmitting, errors: state.errors })}>
        {({ picked, isSubmitting, errors }) => (
          <div className="flex flex-col gap-3">
            {picked !== current ? <PlanChangeSummary features={plan.features} planTier={planTierWith(picked, plan.trial)} /> : null}
            {errors.map((error) => (
              <p key={formErrorText(error)} role="alert" className="text-xs text-destructive">
                {formErrorText(error)}
              </p>
            ))}
            <div className="flex justify-end">
              <Button type="submit" variant={picked === 'none' ? 'destructive' : 'default'} disabled={picked === current || isSubmitting}>
                {isSubmitting ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                {isSubmitting ? 'Saving…' : picked === 'none' ? 'Remove subscription' : 'Save subscription'}
              </Button>
            </div>
            <ConfirmationDialog
              open={confirming}
              title={picked === 'none' ? 'Remove the subscription?' : `Subscribe to ${schoolTierCatalogue[picked].label}?`}
              description={confirmationDescription(picked, plan.trial)}
              confirmLabel={picked === 'none' ? 'Remove subscription' : `Subscribe to ${schoolTierCatalogue[picked].label}`}
              pending={isSubmitting}
              onOpenChange={setConfirming}
              onConfirm={() => {
                // A failed save is shown on the card, so the dialog closes either way.
                void form.handleSubmit().finally(() => setConfirming(false));
              }}
            >
              <LostFeatureWarnings lost={planChangeEffect(plan.features, planTierWith(picked, plan.trial)).lost} />
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
      <SchoolTrialBadge trial={plan.trial} />
      <SchoolNoPlanBadge planTier={plan.tier} />
    </>
  );
}

/**
 * The school's plan (docs/school-trials.md): its subscription and its
 * trial. The school has the features of the higher of the two; without
 * either it has no plan and is read-only. What an administrator adjusted
 * for this one school (the cards below) is kept when the plan changes.
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
          The school has the features of the higher of its subscription and its trial. Without either it has no plan:
          it is blocked: nothing can be changed and the features of a plan are off. Features you adjusted below stay as adjusted.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {/* Keyed by the saved subscription so the form restarts from what was stored. */}
        <SubscriptionForm key={plan.subscribedTier ?? 'none'} schoolId={schoolId} plan={plan} />
        <Separator />
        <SchoolTrialSection schoolId={schoolId} plan={plan} />
      </CardContent>
    </Card>
  );
}
