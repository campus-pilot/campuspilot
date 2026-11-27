'use client';

import { BILLING_PERIOD_DAYS } from '@campuspilot/api/billing/billing.contract';
import { SCHOOL_TIERS, schoolTierCatalogue, type SchoolTier } from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import { SCHOOL_SETUP_MAX_TRIAL_PERIODS } from '@campuspilot/api/school-setup/school-setup.contract';
import { OptionSelect, type OptionSelectOption } from '@campuspilot/components/option-select';
import { Checkbox } from '@campuspilot/ui/components/checkbox';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import { FieldError, FieldRow, StepIntro } from './field-bits';
import type { SetupFormApi } from './setup-form';

const TIER_OPTIONS: OptionSelectOption<SchoolTier>[] = SCHOOL_TIERS.map((tier) => ({ value: tier, label: schoolTierCatalogue[tier].label }));
const STANDING_OPTIONS: OptionSelectOption<SchoolTier | 'none'>[] = [{ value: 'none', label: 'None (billed by period)' }, ...TIER_OPTIONS];

const dayFormatter = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' });

function StandingTierField({ form }: { form: SetupFormApi }) {
  return (
    <form.Field name="draft.plan.standingTier">
      {(field) => (
        <FieldRow id={field.name} label="Standing tier" hint="Never lapses and is not billed (contracts). Most schools have none and are billed per 28-day period.">
          <OptionSelect
            value={field.state.value ?? 'none'}
            options={STANDING_OPTIONS}
            onValueChange={(tier) => field.handleChange(tier === 'none' ? null : tier)}
            triggerProps={{ id: field.name, className: 'w-full' }}
          />
        </FieldRow>
      )}
    </form.Field>
  );
}

function TrialFields({ form }: { form: SetupFormApi }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <form.Field name="draft.plan.trial.tier">
        {(field) => (
          <FieldRow id={field.name} label="Trial tier">
            <OptionSelect value={field.state.value} options={TIER_OPTIONS} onValueChange={field.handleChange} triggerProps={{ id: field.name, className: 'w-full' }} />
          </FieldRow>
        )}
      </form.Field>
      <form.Field name="draft.plan.trial.periods">
        {(field) => (
          <FieldRow
            id={field.name}
            label={`Length (${BILLING_PERIOD_DAYS}-day periods)`}
            hint={`Ends about ${dayFormatter.format(new Date(Date.now() + field.state.value * BILLING_PERIOD_DAYS * 86_400_000))}, counted from when the setup runs.`}
            errors={field.state.meta.errors}
          >
            <Input
              id={field.name}
              type="number"
              min={1}
              max={SCHOOL_SETUP_MAX_TRIAL_PERIODS}
              value={field.state.value}
              onChange={(event) => field.handleChange(Math.min(SCHOOL_SETUP_MAX_TRIAL_PERIODS, Math.max(1, Number(event.target.value) || 1)))}
            />
          </FieldRow>
        )}
      </form.Field>
    </div>
  );
}

export function PlanStep({ form }: { form: SetupFormApi }) {
  return (
    <div className="flex flex-col gap-5">
      <StepIntro title="Plan and trial" description="What the school has from day one. Without a trial or a tier it starts read-only." />
      <StandingTierField form={form} />
      <form.Field name="draft.plan.trial.enabled">
        {(field) => (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Checkbox id={field.name} checked={field.state.value} onCheckedChange={(checked) => field.handleChange(checked === true)} />
              <Label htmlFor={field.name}>Start a trial</Label>
            </div>
            <FieldError errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Subscribe selector={(state) => state.values.draft.plan.trial.enabled}>{(enabled) => (enabled ? <TrialFields form={form} /> : null)}</form.Subscribe>
      <form.Field name="draft.plan.trial">{(field) => <FieldError errors={field.state.meta.errors} />}</form.Field>
    </div>
  );
}
