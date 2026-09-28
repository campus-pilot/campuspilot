'use client';

import { useCallback, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { AuthLoading } from '@/components/auth-loading';
import { orpc } from '@/lib/orpc';
import { schoolHref, schoolSessionHref } from './school-route';
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

  if (schoolsQuery.isError) {
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
    return (
      <main className="grid min-h-[50vh] place-items-center px-6">
        <p className="text-sm text-muted-foreground">
          {activeSessionQuery.isError
            ? 'Unable to load the active school session.'
            : 'This school does not have an active session.'}
        </p>
      </main>
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
