'use client';

import { useForm } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
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
import { BILLING_PERIOD_DAYS } from '@campuspilot/api/billing/billing.contract';
import {
  addDays,
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

type ActivePeriod = NonNullable<SchoolPlanFlags['period']>;

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

/** The tier a new trial proposes: the one above the standing tier, so the trial gives the school something. */
const SUGGESTED_TRIAL_TIER: Record<SchoolTier | 'none', SchoolTier> = {
  none: 'pro',
  plus: 'pro',
  pro: 'enterprise',
  enterprise: 'enterprise',
};

/** The plan tier the school would have on a trial of `tier` (null: no period) next to its standing tier. */
function planTierWithTrial(subscribedTier: SchoolTier | null, tier: SchoolTier | null): SchoolTier | null {
  return resolveSchoolPlan({ subscribedTier, activePeriod: tier === null ? null : { tier, kind: 'trial' } }).tier;
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

/** The end day, with a quick "+28 days" that moves it one billing period later. */
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
              onClick={() => field.handleChange(addDays(trialEndDayProblem(field.state.value) ? istDay(new Date()) : field.state.value, BILLING_PERIOD_DAYS))}
            >
              +28 days
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

/** Starting a trial now: a tier and the day it ends, one 28-day period ahead by default. */
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
      <p className="text-sm text-muted-foreground">No billing period is running. Start a free trial (it ends by itself on the day you choose), or add paid periods below.</p>
      <TrialFields form={form} idPrefix="start-trial" />
      <TrialFormFooter form={form} plan={plan} submitLabel="Start trial" pendingLabel="Starting…" />
    </form>
  );
}

/** Changing the active trial's tier or end. Only what changed is sent. */
function ChangeTrialForm({ schoolId, plan, trial, onDone }: { schoolId: string; plan: SchoolPlanFlags; trial: ActivePeriod; onDone: () => void }) {
  const refresh = useRefreshSchoolPlan(schoolId);
  const savedEndDay = istDay(trial.endsAt);
  const form = useTrialForm(
    { tier: trial.tier, endDay: savedEndDay },
    async (value) => {
      await client.systemAdmin.updateSchoolTrial({
        id: schoolId,
        periodId: trial.id,
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

/** What each kind of period is called. */
const PERIOD_KIND_LABELS = { trial: 'trial', paid: 'paid period', complimentary: 'free period' } as const;

/** What ending the period leaves: the standing tier, or no plan (a period lined up next would follow later). */
function endPeriodDescription(subscribedTier: SchoolTier | null): string {
  if (subscribedTier) return `The school goes back to its ${schoolTierCatalogue[subscribedTier].label} standing tier at once.`;
  return `The school will have no plan at once, unless another period starts right away. ${NO_PLAN_CONSEQUENCE} Its invoice stays as it is; void it to record a refund.`;
}

/** Ending the active period now, confirmed with what the school keeps and loses. */
function EndPeriodButton({ schoolId, plan, period }: { schoolId: string; plan: SchoolPlanFlags; period: ActivePeriod }) {
  const refresh = useRefreshSchoolPlan(schoolId);
  const [confirming, setConfirming] = useState(false);
  const label = PERIOD_KIND_LABELS[period.kind];
  const end = useMutation(
    orpc.systemAdmin.endSchoolBillingPeriod.mutationOptions({
      onSuccess: () => {
        refresh();
        toast.success(`The ${label} ended.`);
      },
      onError: (error) => toast.error(saveErrorMessage(error, `Unable to end the ${label}.`)),
      onSettled: () => setConfirming(false),
    }),
  );
  return (
    <>
      <Button type="button" variant="outline" disabled={end.isPending} onClick={() => setConfirming(true)}>
        End {label}
      </Button>
      <ConfirmationDialog
        open={confirming}
        title={`End the ${schoolTierCatalogue[period.tier].label} ${label} now?`}
        description={endPeriodDescription(plan.subscribedTier)}
        confirmLabel={end.isPending ? 'Ending…' : `End ${label}`}
        pending={end.isPending}
        onOpenChange={setConfirming}
        onConfirm={() => end.mutate({ id: schoolId, periodId: period.id })}
      >
        <LostFeatureWarnings lost={planChangeEffect(plan.features, planTierWithTrial(plan.subscribedTier, null)).lost} />
      </ConfirmationDialog>
    </>
  );
}

/** Said when the period is not above the standing tier: it runs, but gives the school nothing more. */
function PeriodBelowStandingNote({ period, subscribedTier }: { period: ActivePeriod; subscribedTier: SchoolTier | null }) {
  if (subscribedTier === null || resolveSchoolPlan({ subscribedTier, activePeriod: period }).source === period.kind) return null;
  return (
    <p className="text-xs text-muted-foreground">
      The school has the {schoolTierCatalogue[subscribedTier].label} standing tier, so this period changes nothing while it runs.
    </p>
  );
}

/**
 * The active period: its kind, tier and end, with End and (for a trial)
 * Change. Editing is UI state, not form state.
 */
function ActivePeriodPanel({ schoolId, plan, period }: { schoolId: string; plan: SchoolPlanFlags; period: ActivePeriod }) {
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
          <p className="text-sm font-medium">
            {schoolTierCatalogue[period.tier].label} {PERIOD_KIND_LABELS[period.kind]}
          </p>
          <p className="text-sm text-muted-foreground">
            Ends {formatIstDate(period.endsAt)} ({formatDaysUntil(period.endsAt)}). Started {formatIstDate(period.startsAt)}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Not disabled while the form is open: a focused button that becomes disabled drops keyboard focus. */}
          {period.kind === 'trial' ? (
            <Button ref={changeButton} type="button" variant="outline" aria-expanded={editing} onClick={() => setEditing(true)}>
              Change
            </Button>
          ) : null}
          <EndPeriodButton schoolId={schoolId} plan={plan} period={period} />
        </div>
      </div>
      <PeriodBelowStandingNote period={period} subscribedTier={plan.subscribedTier} />
      {editing ? <ChangeTrialForm schoolId={schoolId} plan={plan} trial={period} onDone={closeForm} /> : null}
    </div>
  );
}

/**
 * The current-period half of the Plan card (docs/school-billing.md): the
 * active billing period with End (and Change for a trial), or a form to
 * start a trial. A period never takes away the school's standing tier: the
 * school has the higher of the two. Paid periods are added and their history
 * shown on the Billing card. Each form is keyed by what is stored, so it
 * restarts from the saved state after every change.
 */
export function SchoolPeriodSection({ schoolId, plan }: { schoolId: string; plan: SchoolPlanFlags }) {
  const period = plan.period;
  return (
    <section className="flex flex-col gap-4" aria-labelledby="school-period-heading">
      <div className="flex flex-col gap-1">
        <h3 id="school-period-heading" className="text-sm font-medium">Current period</h3>
        <p className="text-xs text-muted-foreground">
          A trial, paid or free period of 28 days gives the school a tier while it runs and ends by itself.
        </p>
      </div>
      {period ? (
        <ActivePeriodPanel key={`${period.id}:${period.tier}:${period.endsAt.getTime()}`} schoolId={schoolId} plan={plan} period={period} />
      ) : (
        <StartTrialForm key={`start:${plan.subscribedTier ?? 'none'}`} schoolId={schoolId} plan={plan} />
      )}
    </section>
  );
}
