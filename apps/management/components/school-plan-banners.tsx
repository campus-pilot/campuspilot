'use client';

import { useQuery } from '@tanstack/react-query';
import { AppShellAlert } from '@campuspilot/components/app-shell';
import { orpc } from '@/lib/orpc';
import { READ_ONLY_SCHOOL_MESSAGES, readOnlySchoolReason, trialEndingNotice } from './school-plan-banner-model';

/** The signed-in user's entry for the school, from the cached school list the switcher also reads. */
function useMySchool(schoolId: string) {
  const schoolsQuery = useQuery(orpc.school.listMySchools.queryOptions());
  return schoolsQuery.data?.find((school) => school.id === schoolId);
}

/**
 * Permanent warning on every page of a read-only school: one that is
 * suspended (`isSuspended`, docs/school-suspension.md) or has no active plan
 * (`hasActivePlan`, docs/school-trials.md); a suspension wins, as on the
 * server. Screens stay as they are and every change is refused by the
 * server, so this is where staff learn why. It has no action, so it cannot
 * be dismissed; the registration lives as long as the school shell is
 * mounted and the school stays read-only. Reads the same cached school list
 * as the switcher, which the query client reads again whenever the server
 * answers with either refusal (`lib/orpc.ts`).
 */
export function ReadOnlySchoolBanner({ schoolId }: { schoolId: string }) {
  const school = useMySchool(schoolId);
  const reason = school ? readOnlySchoolReason(school) : null;
  if (reason === null) return null;
  return <AppShellAlert key={reason} slug={`school:${schoolId}:${reason}`} type="warning" message={READ_ONLY_SCHOOL_MESSAGES[reason]} />;
}

/**
 * Informational notice in the last days of the trial that gives the school
 * its plan (`trialEndsAt`); nothing during the rest of the trial. It has no
 * action, like the read-only warning, and is gone once the trial is
 * changed, ended or replaced by a subscription.
 */
export function TrialEndingBanner({ schoolId }: { schoolId: string }) {
  const school = useMySchool(schoolId);
  const notice = school ? trialEndingNotice(school.trialEndsAt) : null;
  if (notice === null) return null;
  return <AppShellAlert slug={`school:${schoolId}:trial-ending`} type="normal" message={notice} />;
}
