'use client';

import {
  resolveSchoolFeatureActivity,
  resolveSchoolFeatureSwitches,
  schoolFeatureCatalogue,
  schoolTierCatalogue,
  SCHOOL_FEATURE_KEYS,
  type SchoolFeatureKey,
  type SchoolTier,
} from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import type { SchoolSetupDraft } from '@campuspilot/api/school-setup/school-setup.contract';
import { OptionSelect, type OptionSelectOption } from '@campuspilot/components/option-select';
import { Badge } from '@campuspilot/ui/components/badge';
import { Input } from '@campuspilot/ui/components/input';
import { FieldRow, StepIntro } from './field-bits';
import { plannedTier } from './plan-tier';
import type { SetupFormApi } from './setup-form';

type Choice = 'plan' | 'on' | 'off';
const CHOICES: OptionSelectOption<Choice>[] = [
  { value: 'plan', label: 'Follow the plan' },
  { value: 'on', label: 'On for this school' },
  { value: 'off', label: 'Off for this school' },
];

function choiceOf(adjustment: boolean | undefined): Choice {
  return adjustment === undefined ? 'plan' : adjustment ? 'on' : 'off';
}

function withChoice(adjustments: SchoolSetupDraft['features']['adjustments'], feature: SchoolFeatureKey, choice: Choice) {
  const next = { ...adjustments };
  if (choice === 'plan') delete next[feature];
  else next[feature] = choice === 'on';
  return next;
}

/** Whether the feature will be active, given the plan's tier and every adjustment (requirements included). */
function FeatureState({ active }: { active: boolean }) {
  return <Badge variant={active ? 'secondary' : 'outline'}>{active ? 'Active' : 'Not active'}</Badge>;
}

function AssistantLimit({ form }: { form: SetupFormApi }) {
  return (
    <form.Field name="draft.features.assistantMonthlyLimitUsd">
      {(field) => (
        <FieldRow id={field.name} label="Monthly limit (USD)" hint="Empty for no limit. Every assistant request is paid model usage." errors={field.state.meta.errors}>
          <Input
            id={field.name}
            type="number"
            min={1}
            className="w-40"
            value={field.state.value ?? ''}
            onChange={(event) => field.handleChange(event.target.value ? Math.max(1, Number(event.target.value)) : null)}
          />
        </FieldRow>
      )}
    </form.Field>
  );
}

function FeatureRow({ form, feature, tier, active }: { form: SetupFormApi; feature: SchoolFeatureKey; tier: SchoolTier | null; active: boolean }) {
  const entry = schoolFeatureCatalogue[feature];
  const included = tier !== null && (entry.tiers as readonly SchoolTier[]).includes(tier);
  return (
    <form.Field name="draft.features.adjustments">
      {(field) => (
        <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="flex items-center gap-2 text-sm font-medium">
              {entry.label} <FeatureState active={active} />
            </span>
            <span className="text-xs text-muted-foreground">
              {entry.tiers.length === 0 ? 'Add-on: in no tier.' : included ? `Included in ${schoolTierCatalogue[tier!].label}.` : 'Not in the plan.'} {entry.description}
            </span>
            {feature === 'assistant' && field.state.value.assistant === true ? <AssistantLimit form={form} /> : null}
          </div>
          <OptionSelect
            value={choiceOf(field.state.value[feature])}
            options={CHOICES}
            onValueChange={(choice) => field.handleChange(withChoice(field.state.value, feature, choice))}
            triggerProps={{ className: 'w-full sm:w-48', 'aria-label': `${entry.label} for this school` }}
          />
        </li>
      )}
    </form.Field>
  );
}

export function FeaturesStep({ form }: { form: SetupFormApi }) {
  return (
    <div className="flex flex-col gap-2">
      <StepIntro title="Features" description="The school has its plan's features. Switch a feature on or off for this school only when it should differ." />
      <form.Subscribe selector={(state) => ({ plan: state.values.draft.plan, adjustments: state.values.draft.features.adjustments })}>
        {({ plan, adjustments }) => {
          const tier = plannedTier(plan);
          const active = resolveSchoolFeatureActivity(resolveSchoolFeatureSwitches(tier, adjustments));
          return (
            <ul className="divide-y">
              {SCHOOL_FEATURE_KEYS.map((feature) => (
                <FeatureRow key={feature} form={form} feature={feature} tier={tier} active={active[feature]} />
              ))}
            </ul>
          );
        }}
      </form.Subscribe>
    </div>
  );
}
