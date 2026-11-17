'use client';

import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
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
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import { toast } from '@campuspilot/ui/lib/toast';
import { LoaderCircle } from 'lucide-react';
import { client, orpc } from '@/lib/orpc';
import {
  addCalendarMonths,
  defaultTrialEndDay,
  endOfIstDay,
  formatDaysUntil,
  formatIstDate,
  istDay,
  trialEndDayProblem,
} from '@/lib/trial-dates';
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

type ActiveTrial = NonNullable<SchoolPlanFlags['trial']>;

const TIER_OPTIONS: OptionSelectOption<SchoolTier>[] = SCHOOL_TIERS.map((tier) => ({
  value: tier,
  label: schoolTierCatalogue[tier].label,
}));

/** A trial's tier and the IST day it ends (a date input's `YYYY-MM-DD`). */
const trialFormSchema = z.object({
  tier: z.enum(SCHOOL_TIERS),
  endDay: z.string().superRefine((day, context) => {
    const problem = trialEndDayProblem(day);
    if (problem) context.addIssue({ code: 'custom', message: problem });
  }),
});

type TrialFormValues = z.infer<typeof trialFormSchema>;

/** The tier a new trial proposes: the one above the subscription, so the trial gives the school something. */
const SUGGESTED_TRIAL_TIER: Record<SchoolTier | 'none', SchoolTier> = {
  none: 'pro',
  plus: 'pro',
  pro: 'enterprise',
  enterprise: 'enterprise',
};

/** The plan tier the school would have on a trial of `tier` (null: no trial) next to its subscription. */
function planTierWithTrial(subscribedTier: SchoolTier | null, tier: SchoolTier | null): SchoolTier | null {
  return resolveSchoolPlan({ subscribedTier, activeTrial: tier === null ? null : { tier } }).tier;
}

function fieldErrorMessages(errors: unknown[]): string[] {
  return errors.flatMap((error) => (typeof error === 'object' && error !== null && 'message' in error ? [String(error.message)] : []));
}

function useTrialForm(defaultValues: TrialFormValues, save: (value: TrialFormValues) => Promise<void>, failure: string) {
  const form = useForm({
    defaultValues,
    validators: { onSubmit: trialFormSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      try {
        await save(value);
      } catch (error) {
        form.setErrorMap({ onSubmit: { form: saveErrorMessage(error, failure), fields: {} } });
      }
    },
  });
  return form;
}

type TrialForm = ReturnType<typeof useTrialForm>;

/** `autoFocus`: the field takes keyboard focus when it appears (the Change form opened from its button). */
function TrialTierField({ form, idPrefix, autoFocus = false }: { form: TrialForm; idPrefix: string; autoFocus?: boolean }) {
  return (
    <form.Field name="tier">
      {(field) => (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-tier`}>Trial tier</Label>
          <OptionSelect
            value={field.state.value}
            options={TIER_OPTIONS}
            onValueChange={(tier) => field.handleChange(tier)}
            triggerProps={{ id: `${idPrefix}-tier`, className: 'w-full sm:w-48', autoFocus }}
          />
        </div>
      )}
    </form.Field>
  );
}

/** The end day, with a quick "+1 month" that moves it one calendar month later. */
function TrialEndField({ form, idPrefix }: { form: TrialForm; idPrefix: string }) {
  return (
    <form.Field name="endDay">
      {(field) => (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-end`}>Ends on</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id={`${idPrefix}-end`}
              type="date"
              className="w-44"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              aria-invalid={field.state.meta.errors.length > 0}
              aria-describedby={field.state.meta.errors.length > 0 ? `${idPrefix}-end-error` : undefined}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => field.handleChange(addCalendarMonths(trialEndDayProblem(field.state.value) ? istDay(new Date()) : field.state.value, 1))}
            >
              +1 month
            </Button>
          </div>
          <div id={`${idPrefix}-end-error`} role="alert" className="flex flex-col gap-1 empty:hidden">
            {fieldErrorMessages(field.state.meta.errors).map((message) => (
              <p key={message} className="text-xs text-destructive">{message}</p>
            ))}
          </div>
        </div>
      )}
    </form.Field>
  );
}

function TrialFields({ form, idPrefix, autoFocus = false }: { form: TrialForm; idPrefix: string; autoFocus?: boolean }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <TrialTierField form={form} idPrefix={idPrefix} autoFocus={autoFocus} />
      <TrialEndField form={form} idPrefix={idPrefix} />
    </div>
  );
}

/** The summary, form errors and buttons of a trial form. */
function TrialFormFooter({
  form,
  plan,
  submitLabel,
  pendingLabel,
  unchanged,
  onCancel,
}: {
  form: TrialForm;
  plan: SchoolPlanFlags;
  submitLabel: string;
  pendingLabel: string;
  unchanged?: (values: TrialFormValues) => boolean;
  onCancel?: () => void;
}) {
  return (
    <form.Subscribe selector={(state) => ({ values: state.values, isSubmitting: state.isSubmitting, errors: state.errors })}>
      {({ values, isSubmitting, errors }) => (
        <div className="flex flex-col gap-3">
          <PlanChangeSummary features={plan.features} planTier={planTierWithTrial(plan.subscribedTier, values.tier)} />
          {errors.map((error) => (
            <p key={formErrorText(error)} role="alert" className="text-xs text-destructive">{formErrorText(error)}</p>
          ))}
          <div className="flex flex-wrap justify-end gap-2">
            {onCancel ? <Button type="button" variant="outline" disabled={isSubmitting} onClick={onCancel}>Cancel</Button> : null}
            <Button type="submit" disabled={isSubmitting || (unchanged?.(values) ?? false)}>
              {isSubmitting ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
              {isSubmitting ? pendingLabel : submitLabel}
            </Button>
          </div>
        </div>
      )}
    </form.Subscribe>
  );
}

/** Starting a trial now: a tier and the day it ends, one calendar month ahead by default. */
function StartTrialForm({ schoolId, plan }: { schoolId: string; plan: SchoolPlanFlags }) {
  const refresh = useRefreshSchoolPlan(schoolId);
  const form = useTrialForm(
    { tier: SUGGESTED_TRIAL_TIER[plan.subscribedTier ?? 'none'], endDay: defaultTrialEndDay() },
    async (value) => {
      await client.systemAdmin.startSchoolTrial({ id: schoolId, tier: value.tier, endsAt: endOfIstDay(value.endDay) });
      refresh();
      toast.success(`${schoolTierCatalogue[value.tier].label} trial started.`);
    },
    'Unable to start the trial.',
  );
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <p className="text-sm text-muted-foreground">No trial is running. A trial starts now and ends by itself on the day you choose.</p>
      <TrialFields form={form} idPrefix="start-trial" />
      <TrialFormFooter form={form} plan={plan} submitLabel="Start trial" pendingLabel="Starting…" />
    </form>
  );
}

/** Changing the active trial's tier or end. Only what changed is sent. */
function ChangeTrialForm({ schoolId, plan, trial, onDone }: { schoolId: string; plan: SchoolPlanFlags; trial: ActiveTrial; onDone: () => void }) {
  const refresh = useRefreshSchoolPlan(schoolId);
  const savedEndDay = istDay(trial.endsAt);
  const form = useTrialForm(
    { tier: trial.tier, endDay: savedEndDay },
    async (value) => {
      await client.systemAdmin.updateSchoolTrial({
        id: schoolId,
        trialId: trial.id,
        tier: value.tier === trial.tier ? undefined : value.tier,
        endsAt: value.endDay === savedEndDay ? undefined : endOfIstDay(value.endDay),
      });
      refresh();
      toast.success('Trial changed.');
      onDone();
    },
    'Unable to change the trial.',
  );
  return (
    <form
      className="flex flex-col gap-4 border-t pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      {/* Opened from Change: keyboard focus moves into the form. */}
      <TrialFields form={form} idPrefix="change-trial" autoFocus />
      <TrialFormFooter
        form={form}
        plan={plan}
        submitLabel="Save trial"
        pendingLabel="Saving…"
        unchanged={(values) => values.tier === trial.tier && values.endDay === savedEndDay}
        onCancel={onDone}
      />
    </form>
  );
}

/** What ending the trial leaves: the subscription, or no plan. */
function endTrialDescription(subscribedTier: SchoolTier | null): string {
  if (subscribedTier) return `The school goes back to its ${schoolTierCatalogue[subscribedTier].label} subscription at once.`;
  return `The school will have no plan at once. ${NO_PLAN_CONSEQUENCE}`;
}

/** Ending the active trial now, confirmed with what the school keeps and loses. */
function EndTrialButton({ schoolId, plan, trial }: { schoolId: string; plan: SchoolPlanFlags; trial: ActiveTrial }) {
  const refresh = useRefreshSchoolPlan(schoolId);
  const [confirming, setConfirming] = useState(false);
  const end = useMutation(
    orpc.systemAdmin.endSchoolTrial.mutationOptions({
      onSuccess: () => {
        refresh();
        toast.success('Trial ended.');
      },
      onError: (error) => toast.error(saveErrorMessage(error, 'Unable to end the trial.')),
      onSettled: () => setConfirming(false),
    }),
  );
  return (
    <>
      <Button type="button" variant="outline" disabled={end.isPending} onClick={() => setConfirming(true)}>
        End trial
      </Button>
      <ConfirmationDialog
        open={confirming}
        title={`End the ${schoolTierCatalogue[trial.tier].label} trial now?`}
        description={endTrialDescription(plan.subscribedTier)}
        confirmLabel={end.isPending ? 'Ending…' : 'End trial'}
        pending={end.isPending}
        onOpenChange={setConfirming}
        onConfirm={() => end.mutate({ id: schoolId, trialId: trial.id })}
      >
        <LostFeatureWarnings lost={planChangeEffect(plan.features, planTierWithTrial(plan.subscribedTier, null)).lost} />
      </ConfirmationDialog>
    </>
  );
}

/** Said when the trial is not above the subscription: it runs, but gives the school nothing more. */
function TrialBelowSubscriptionNote({ trial, subscribedTier }: { trial: ActiveTrial; subscribedTier: SchoolTier | null }) {
  if (subscribedTier === null || resolveSchoolPlan({ subscribedTier, activeTrial: trial }).source === 'trial') return null;
  return (
    <p className="text-xs text-muted-foreground">
      The school subscribes to {schoolTierCatalogue[subscribedTier].label}, so this trial changes nothing while it runs.
    </p>
  );
}

/** The active trial: its tier and end, with Change and End trial. Editing is UI state, not form state. */
function ActiveTrialPanel({ schoolId, plan, trial }: { schoolId: string; plan: SchoolPlanFlags; trial: ActiveTrial }) {
  const [editing, setEditing] = useState(false);
  // Closing the form unmounts what had focus (Cancel, Save): focus goes back to Change, not to the top of the page.
  const changeButton = useRef<HTMLButtonElement>(null);
  const closeForm = () => {
    setEditing(false);
    changeButton.current?.focus();
  };
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-medium">{schoolTierCatalogue[trial.tier].label} trial</p>
          <p className="text-sm text-muted-foreground">
            Ends {formatIstDate(trial.endsAt)} ({formatDaysUntil(trial.endsAt)}). Started {formatIstDate(trial.startsAt)}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Not disabled while the form is open: a focused button that becomes disabled drops keyboard focus. */}
          <Button ref={changeButton} type="button" variant="outline" aria-expanded={editing} onClick={() => setEditing(true)}>
            Change
          </Button>
          <EndTrialButton schoolId={schoolId} plan={plan} trial={trial} />
        </div>
      </div>
      <TrialBelowSubscriptionNote trial={trial} subscribedTier={plan.subscribedTier} />
      {editing ? <ChangeTrialForm schoolId={schoolId} plan={plan} trial={trial} onDone={closeForm} /> : null}
    </div>
  );
}

/** One past trial: its tier, its dates and whether an administrator ended it early. */
function pastTrialLine(trial: { tier: SchoolTier; startsAt: Date; endsAt: Date; endedAt: Date | null }): string {
  const label = schoolTierCatalogue[trial.tier].label;
  if (trial.endedAt) return `${label}: ${formatIstDate(trial.startsAt)} to ${formatIstDate(trial.endedAt)}, ended early (was to end ${formatIstDate(trial.endsAt)})`;
  return `${label}: ${formatIstDate(trial.startsAt)} to ${formatIstDate(trial.endsAt)}`;
}

const HISTORY_LENGTH = 5;

/** The school's past trials, newest first; the active one is shown above. */
function TrialHistory({ schoolId }: { schoolId: string }) {
  const trialsQuery = useQuery(orpc.systemAdmin.listSchoolTrials.queryOptions({ input: { id: schoolId } }));
  const past = (trialsQuery.data ?? []).filter((trial) => !trial.active);
  if (past.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">Earlier trials</p>
      <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
        {past.slice(0, HISTORY_LENGTH).map((trial) => (
          <li key={trial.id}>{pastTrialLine(trial)}</li>
        ))}
      </ul>
      {past.length > HISTORY_LENGTH ? <p className="text-xs text-muted-foreground">And {past.length - HISTORY_LENGTH} more.</p> : null}
    </div>
  );
}

/**
 * The trial half of the Plan card (docs/school-trials.md): the active trial
 * with Change and End trial, or a form to start one, then earlier trials.
 * A trial never takes away what the school subscribes to: the school has
 * the higher of the two. Each form is keyed by what is stored, so it
 * restarts from the saved state after every change.
 */
export function SchoolTrialSection({ schoolId, plan }: { schoolId: string; plan: SchoolPlanFlags }) {
  const trial = plan.trial;
  return (
    <section className="flex flex-col gap-4" aria-labelledby="school-trial-heading">
      <div className="flex flex-col gap-1">
        <h3 id="school-trial-heading" className="text-sm font-medium">Trial</h3>
        <p className="text-xs text-muted-foreground">
          Lets the school use a higher tier for a while. It ends by itself; you can change or end it at any time.
        </p>
      </div>
      {trial ? (
        <ActiveTrialPanel key={`${trial.id}:${trial.tier}:${trial.endsAt.getTime()}`} schoolId={schoolId} plan={plan} trial={trial} />
      ) : (
        <StartTrialForm key={`start:${plan.subscribedTier ?? 'none'}`} schoolId={schoolId} plan={plan} />
      )}
      <TrialHistory schoolId={schoolId} />
    </section>
  );
}
