'use client';

import { useQuery } from '@tanstack/react-query';
import { formatUsdText } from '@campuspilot/assistant-contract/money';
import { BILLING_PERIOD_DAYS } from '@campuspilot/api/billing/billing.contract';
import { schoolTierCatalogue } from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import { Bot, CalendarClock, Sparkles, type LucideIcon } from 'lucide-react';
import { orpc } from '@/lib/orpc';
import { useSchoolFeature } from '../require-feature';

const trialEndFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  dateStyle: 'medium',
});

function WelcomeFact({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: string }) {
  return (
    <li className="flex gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-sm text-muted-foreground">{children}</span>
      </div>
    </li>
  );
}

/** The plan the trial gives, from the school's feature flags (the tier of its plan). */
function TrialPlanFact({ schoolId, endsAt }: { schoolId: string; endsAt: string }) {
  const flagsQuery = useQuery(orpc.school.getFeatureFlags.queryOptions({ input: { schoolId } }));
  const tier = flagsQuery.data?.tier;
  const title = tier ? `${schoolTierCatalogue[tier].label} plan, free until ${trialEndFormatter.format(new Date(endsAt))}` : `Free until ${trialEndFormatter.format(new Date(endsAt))}`;
  return (
    <WelcomeFact icon={Sparkles} title={title}>
      {tier ? schoolTierCatalogue[tier].description : `A free trial of ${BILLING_PERIOD_DAYS} days.`}
    </WelcomeFact>
  );
}

/** The assistant's spending limit, shown only when the school has the assistant with a limit. */
function AssistantFact({ schoolId }: { schoolId: string }) {
  const assistant = useSchoolFeature(schoolId, 'assistant');
  const limit = assistant.enabled ? assistant.config?.monthlyLimitUsd : null;
  if (limit === null || limit === undefined) return null;
  return (
    <WelcomeFact icon={Bot} title="AI assistant included">
      {`Up to ${formatUsdText(String(limit))} of use every ${BILLING_PERIOD_DAYS} days.`}
    </WelcomeFact>
  );
}

/**
 * What a new school's free trial gives and when it ends
 * (docs/school-creation.md), on the first screen of its guided setup. It reads
 * the school list (`planSource`, `planEndsAt`) and the feature flags rather
 * than the creation constants, so it never tells a school about a trial it
 * does not have.
 */
export function NewSchoolTrialFacts({ schoolId }: { schoolId: string }) {
  const schoolsQuery = useQuery(orpc.school.listMySchools.queryOptions());
  const school = schoolsQuery.data?.find((entry) => entry.id === schoolId);
  if (!school || school.planSource !== 'trial' || school.planEndsAt === null) return null;
  return (
    <ul className="flex flex-col gap-3 rounded-lg bg-muted/50 p-3">
      <TrialPlanFact schoolId={schoolId} endsAt={school.planEndsAt} />
      <AssistantFact schoolId={schoolId} />
      <WelcomeFact icon={CalendarClock} title="After the trial">
        {`The school becomes read-only, with nothing lost, until the next ${BILLING_PERIOD_DAYS}-day period is paid. Contact CampusPilot to continue.`}
      </WelcomeFact>
    </ul>
  );
}
