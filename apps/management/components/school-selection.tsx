'use client';

import { useCallback, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@campuspilot/ui/components/button';
import { AuthLoading } from '@/components/auth-loading';
import { orpc } from '@/lib/orpc';
import { schoolHref, schoolSessionHref } from './school-route';
import { onboardingHref, onboardingPermissions } from './school-onboarding/onboarding-route';
import { RequirePermissions } from './require-permissions';
import { CreateSessionButton } from './session/create-session-button';
import { storeSchoolSessionId } from './session-selection';

const ACTIVE_SCHOOL_KEY = 'campuspilot.management.activeSchoolId';

export function getStoredSchoolId() {
  if (typeof window === 'undefined') return undefined;
  return window.localStorage.getItem(ACTIVE_SCHOOL_KEY) ?? undefined;
}

export function storeSchoolId(schoolId: string) {
  window.localStorage.setItem(ACTIVE_SCHOOL_KEY, schoolId);
}

export function clearStoredSchoolId() {
  window.localStorage.removeItem(ACTIVE_SCHOOL_KEY);
}

function RouteAfterCommit({
  href,
  schoolId,
  sessionId,
}: {
  href: string;
  schoolId?: string;
  sessionId?: string;
}) {
  const router = useRouter();
  /**
   * A callback ref performs the browser-only persistence and navigation after
   * commit, avoiding a render side effect and avoiding an effect-only redirect.
   */
  const route = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      clearStoredSchoolId();
      if (schoolId) storeSchoolId(schoolId);
      if (schoolId && sessionId) storeSchoolSessionId(schoolId, sessionId);
      router.replace(href);
    },
    [href, router, schoolId, sessionId],
  );

  return (
    <div ref={route}>
      <AuthLoading label="Opening your school…" />
    </div>
  );
}

function PersistSchoolSelection({
  children,
  schoolId,
}: {
  children: ReactNode;
  schoolId: string;
}) {
  /** Keeps direct links and browser navigation in sync with the switcher. */
  const persist = useCallback(
    (node: HTMLSpanElement | null) => {
      if (node) storeSchoolId(schoolId);
    },
    [schoolId],
  );

  return (
    <>
      <span ref={persist} hidden />
      {children}
    </>
  );
}

export function SchoolAccessBoundary({
  children,
  schoolId,
}: {
  children: ReactNode;
  schoolId: string;
}) {
  const schoolsQuery = useQuery(orpc.school.listMySchools.queryOptions());

  if (schoolsQuery.isPending) {
    return <AuthLoading label="Checking school access…" />;
  }

  // Only a list that was never read is an error screen. A background
  // refetch that fails (returning to the tab on a flaky network) leaves the
  // last good list in `data`; replacing the whole workspace then would
  // unmount every open page and drop unsaved input, such as a half-written
  // notice. The known list keeps deciding access until a read succeeds.
  if (!schoolsQuery.data) {
    return (
      <main className="grid min-h-svh place-items-center px-6">
        <p className="text-sm text-destructive">Unable to load your schools.</p>
      </main>
    );
  }

  const hasAccess = schoolsQuery.data.some((school) => school.id === schoolId);
  if (!hasAccess) {
    const fallbackSchool = schoolsQuery.data[0];
    return fallbackSchool ? (
      <RouteAfterCommit
        href={schoolHref(fallbackSchool.id)}
        schoolId={fallbackSchool.id}
      />
    ) : (
      <RouteAfterCommit href="/school" />
    );
  }

  return (
    <PersistSchoolSelection schoolId={schoolId}>
      {children}
    </PersistSchoolSelection>
  );
}

export function SchoolEntryRedirect({ schoolId }: { schoolId: string }) {
  return <RouteAfterCommit href={schoolHref(schoolId)} schoolId={schoolId} />;
}

/**
 * A direct school entry intentionally resets that school's remembered session
 * to the currently active session before opening its dashboard.
 */
/**
 * A school without an active session, where every workspace page waits for
 * one. A guided setup that is neither finished nor set aside opens on its own
 * for someone who may run it (docs/school-creation.md, "Guided setup");
 * anyone else, and everyone once it is set aside or finished, is told the
 * school has no session and offered to create one.
 */
function NoActiveSession({ schoolId }: { schoolId: string }) {
  const onboarding = useQuery(orpc.school.getOnboarding.queryOptions({ input: { schoolId } }));
  if (onboarding.isPending) return <AuthLoading label="Opening your school…" />;
  const onboardingState = onboarding.data?.state;
  const notice = <NoActiveSessionNotice schoolId={schoolId} offerGuide={onboardingState === 'skipped'} />;
  if (onboardingState !== 'pending') return notice;
  return (
    <RequirePermissions permissions={onboardingPermissions(schoolId)} fallback={notice} pending={<AuthLoading label="Opening your school…" />}>
      <RouteAfterCommit href={onboardingHref(schoolId)} schoolId={schoolId} />
    </RequirePermissions>
  );
}

/**
 * Says the school has no active session and offers to create one, with the
 * guided setup beside it while that is set aside. A session created while
 * none is active becomes active, and the refreshed session query opens it.
 */
function NoActiveSessionNotice({ schoolId, offerGuide }: { schoolId: string; offerGuide: boolean }) {
  return (
    <main className="grid min-h-[50vh] place-items-center px-6">
      <section className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">No active academic session</h1>
          <p className="text-sm text-muted-foreground">
            Classes, examinations and the dashboard belong to an academic session. Create one to start working in this
            school.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {offerGuide ? (
            <Button asChild variant="outline">
              <Link href={onboardingHref(schoolId)}>Use the guided setup</Link>
            </Button>
          ) : null}
          <CreateSessionButton schoolId={schoolId} />
        </div>
      </section>
    </main>
  );
}

export function SchoolSessionEntryRedirect({ schoolId }: { schoolId: string }) {
  const activeSessionQuery = useQuery(
    orpc.school.listSessions.queryOptions({
      input: { schoolId, limit: 1, filters: { isActive: true } },
    }),
  );

  if (activeSessionQuery.isPending) {
    return <AuthLoading label="Opening the active session…" />;
  }

  const activeSession = activeSessionQuery.data?.items[0];
  if (!activeSession) {
    return activeSessionQuery.isError ? (
      <main className="grid min-h-[50vh] place-items-center px-6">
        <p className="text-sm text-muted-foreground">Unable to load the active school session.</p>
      </main>
    ) : (
      <NoActiveSession schoolId={schoolId} />
    );
  }

  return (
    <RouteAfterCommit
      href={schoolSessionHref(schoolId, activeSession.id)}
      schoolId={schoolId}
      sessionId={activeSession.id}
    />
  );
}
