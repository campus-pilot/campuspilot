'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@campuspilot/ui/components/button';
import { orpc } from '@/lib/orpc';
import { AuthLoading } from '../auth-loading';
import { RequirePermissions } from '../require-permissions';
import { onboardingPermissions } from './onboarding-route';
import { SchoolPageNavbar } from '../school-page-navbar';
import { schoolHref } from '../school-route';
import { OnboardingFirstPaper } from './onboarding-first-paper';
import { OnboardingWizard } from './onboarding-wizard';

/** A short message with the way into the school. */
function OnboardingNotice({ schoolId, title, children }: { schoolId: string; title: string; children: ReactNode }) {
  return (
    <section className="flex w-full max-w-md flex-col items-center gap-4 text-center">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{children}</p>
      </div>
      <Button asChild>
        <Link href={schoolHref(schoolId)}>Open the school</Link>
      </Button>
    </section>
  );
}

function OnboardingBody({ schoolId }: { schoolId: string }) {
  const onboarding = useQuery(orpc.school.getOnboarding.queryOptions({ input: { schoolId } }));
  if (onboarding.isPending) return <AuthLoading label="Opening your setup…" />;
  if (!onboarding.data)
    return (
      <section className="flex flex-col items-center gap-3 text-center">
        <p className="text-sm text-destructive">Your setup could not be loaded.</p>
        <Button type="button" variant="outline" onClick={() => void onboarding.refetch()}>
          Try again
        </Button>
      </section>
    );
  const { state } = onboarding.data;
  if (state === 'completed') return <OnboardingFirstPaper schoolId={schoolId} />;
  if (state === 'not_offered')
    return (
      <OnboardingNotice schoolId={schoolId} title="Nothing to set up here">
        This school is set up from its own screens.
      </OnboardingNotice>
    );
  return (
    <RequirePermissions
      permissions={onboardingPermissions(schoolId)}
      fallback={
        <OnboardingNotice schoolId={schoolId} title="Your school is being set up">
          The school&apos;s owner sets up its session, classes and examinations.
        </OnboardingNotice>
      }
    >
      <OnboardingWizard schoolId={schoolId} />
    </RequirePermissions>
  );
}

/**
 * The guided setup of a self-created school (docs/school-creation.md,
 * "Guided setup"), outside the workspace shell: a new school has no session
 * yet, and the guide is the owner's whole screen until it is done. It follows
 * the guide's state on the server, so finishing it shows the first paper and
 * a reload lands in the same place.
 */
export function SchoolOnboarding({ schoolId }: { schoolId: string }) {
  return (
    <div className="min-h-svh bg-muted/20">
      <SchoolPageNavbar />
      <main className="flex justify-center px-4 py-8 sm:py-12">
        <OnboardingBody schoolId={schoolId} />
      </main>
    </div>
  );
}
