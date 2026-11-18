'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { formatUsdText } from '@campuspilot/assistant-contract/money';
import { BILLING_PERIOD_DAYS } from '@campuspilot/api/billing/billing.contract';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { schoolTierCatalogue } from '@campuspilot/api/routers/school/feature-flags/feature-flags.dto';
import type { MySchoolDto } from '@campuspilot/api/routers/school/school.dto';
import { Button } from '@campuspilot/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@campuspilot/ui/components/dialog';
import { Bot, CalendarClock, Sparkles, type LucideIcon } from 'lucide-react';
import { orpc } from '@/lib/orpc';
import { RequirePermissions } from '../require-permissions';
import { useSchoolFeature } from '../require-feature';
import { schoolHref } from '../school-route';

/**
 * The search parameter that opens the welcome dialog on a school just
 * created. It is part of the URL, not stored anywhere: the dialog belongs to
 * the moment of creation, and closing it removes the parameter. A new school
 * has no session, so its entry page stays where it is and keeps the URL.
 */
export const NEW_SCHOOL_WELCOME_PARAM = 'welcome';

/** Where the create-school dialog sends the person: the new school, with its welcome. */
export function newSchoolWelcomeHref(schoolId: string): string {
  return schoolHref(schoolId, `?${NEW_SCHOOL_WELCOME_PARAM}=1`);
}

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
 * The first step for a school without an active session: setting one up,
 * for people who may create sessions. Otherwise the dialog only closes.
 */
function WelcomeActions({ schoolId, onClose }: { schoolId: string; onClose: () => void }) {
  const activeSessionQuery = useQuery(
    orpc.school.listSessions.queryOptions({ input: { schoolId, limit: 1, filters: { isActive: true } } }),
  );
  const close = (
    <Button type="button" onClick={onClose}>
      Get started
    </Button>
  );
  if (activeSessionQuery.data?.items.length !== 0) return <DialogFooter>{close}</DialogFooter>;
  return (
    <DialogFooter>
      <RequirePermissions
        permissions={{ action: SCHOOL_ACTIONS.CREATE_SESSION, resource: { kind: 'school', schoolId } }}
        fallback={close}
      >
        <Button type="button" variant="outline" onClick={onClose}>
          Later
        </Button>
        <Button asChild>
          <Link href={schoolHref(schoolId, '/settings/session')}>Set up your first session</Link>
        </Button>
      </RequirePermissions>
    </DialogFooter>
  );
}

function WelcomeContent({ school, onClose }: { school: MySchoolDto & { planEndsAt: string }; onClose: () => void }) {
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Welcome to {school.name}</DialogTitle>
        <DialogDescription>Your school is ready and its free trial has started.</DialogDescription>
      </DialogHeader>
      <ul className="flex flex-col gap-4">
        <TrialPlanFact schoolId={school.id} endsAt={school.planEndsAt} />
        <AssistantFact schoolId={school.id} />
        <WelcomeFact icon={CalendarClock} title="After the trial">
          {`When the trial ends the school becomes read-only, with nothing lost, until the next ${BILLING_PERIOD_DAYS}-day period is paid. Contact CampusPilot to continue.`}
        </WelcomeFact>
      </ul>
      <WelcomeActions schoolId={school.id} onClose={onClose} />
    </DialogContent>
  );
}

/**
 * The welcome shown once a school is created (docs/school-creation.md):
 * what its free trial gives and when it ends. It opens while the URL carries
 * {@link NEW_SCHOOL_WELCOME_PARAM} and the school is on a trial, read from the
 * school list (`planSource`, `planEndsAt`), so it never tells a school about
 * a trial it does not have. Closing it removes the parameter.
 */
export function NewSchoolWelcomeDialog({ schoolId }: { schoolId: string }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const schoolsQuery = useQuery(orpc.school.listMySchools.queryOptions());
  if (!searchParams.has(NEW_SCHOOL_WELCOME_PARAM)) return null;
  const school = schoolsQuery.data?.find((entry) => entry.id === schoolId);
  if (!school || school.planSource !== 'trial' || school.planEndsAt === null) return null;
  const close = () => router.replace(pathname);
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <WelcomeContent school={{ ...school, planEndsAt: school.planEndsAt }} onClose={close} />
    </Dialog>
  );
}
