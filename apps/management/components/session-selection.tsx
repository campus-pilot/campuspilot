'use client';

import { useCallback, useSyncExternalStore, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import type { SchoolSessionDto } from '@campuspilot/api/routers/school/session/session.dto';
import { client, orpc } from '@/lib/orpc';

const SESSION_KEY_PREFIX = 'campuspilot.management.schoolSessionId.';
const sessionSelectionListeners = new Set<() => void>();

function sessionStorageKey(schoolId: string) {
  return `${SESSION_KEY_PREFIX}${schoolId}`;
}

function notifySessionSelectionChanged() {
  sessionSelectionListeners.forEach((listener) => listener());
}

function subscribeToSessionSelection(listener: () => void) {
  sessionSelectionListeners.add(listener);

  function handleStorage(event: StorageEvent) {
    if (event.key?.startsWith(SESSION_KEY_PREFIX)) listener();
  }

  window.addEventListener('storage', handleStorage);
  return () => {
    sessionSelectionListeners.delete(listener);
    window.removeEventListener('storage', handleStorage);
  };
}

export function getStoredSchoolSessionId(schoolId: string) {
  if (typeof window === 'undefined') return undefined;
  return window.localStorage.getItem(sessionStorageKey(schoolId)) ?? undefined;
}

/** Stores one independent last-used session for each school. */
export function storeSchoolSessionId(schoolId: string, sessionId: string) {
  window.localStorage.setItem(sessionStorageKey(schoolId), sessionId);
  notifySessionSelectionChanged();
}

/**
 * Reads local storage as an external browser store so global school routes can
 * retain their last session without effect-driven synchronization.
 */
export function useStoredSchoolSessionId(schoolId: string) {
  const getSnapshot = useCallback(
    () => getStoredSchoolSessionId(schoolId),
    [schoolId],
  );
  const getServerSnapshot = useCallback(() => undefined, []);

  return useSyncExternalStore(
    subscribeToSessionSelection,
    getSnapshot,
    getServerSnapshot,
  );
}

/** Loads every academic session so older sessions remain available to switch to. */
export function useSchoolSessions(schoolId: string, enabled = true) {
  return useQuery({
    queryKey: [
      ...orpc.school.listSessions.queryKey({ input: { schoolId } }),
      'all-pages',
    ],
    enabled,
    queryFn: async () => {
      const sessions: SchoolSessionDto[] = [];
      let page = 1;
      let totalPages = 1;

      while (page <= totalPages) {
        const result = await client.school.listSessions({
          schoolId,
          page,
          limit: 20,
        });
        sessions.push(...result.items);
        totalPages = result.pagination.totalPages;
        page += 1;
      }

      return sessions;
    },
  });
}

/**
 * The sessions a school-wide shell (Settings, the template marketplace) shows
 * in its session switcher and command context, read only when the user may
 * list them. Two separate facts are kept apart although they often coincide:
 * - `activeSessionId`: the school's active session;
 * - `selectedSessionId`: the session the user is working in (their stored
 *   choice, else the active one).
 */
export function useSchoolShellSessions(schoolId: string) {
  const permissionQuery = useQuery(
    orpc.authorization.checkPermissions.queryOptions({
      input: { permissions: [{ action: SCHOOL_ACTIONS.LIST_SESSIONS, resource: { kind: 'school', schoolId } }] },
    }),
  );
  const canListSessions = permissionQuery.data?.results[0] === true;
  const storedSessionId = useStoredSchoolSessionId(schoolId);
  const sessionsQuery = useSchoolSessions(schoolId, canListSessions);
  const sessions = sessionsQuery.data ?? [];
  const activeSessionId = sessions.find((session) => session.isActive)?.id;
  return {
    canListSessions,
    sessions,
    /** The sessions were read and there are none (not merely unread). */
    hasNoSessions: sessionsQuery.isSuccess && sessions.length === 0,
    activeSessionId,
    selectedSessionId: storedSessionId ?? activeSessionId,
  };
}

export function PersistSchoolSessionSelection({
  children,
  schoolId,
  sessionId,
}: {
  children: ReactNode;
  schoolId: string;
  sessionId: string;
}) {
  /** Persist direct session URLs only after the route has committed. */
  const persist = useCallback(
    (node: HTMLSpanElement | null) => {
      if (node) storeSchoolSessionId(schoolId, sessionId);
    },
    [schoolId, sessionId],
  );

  return (
    <>
      <span ref={persist} hidden />
      {children}
    </>
  );
}
