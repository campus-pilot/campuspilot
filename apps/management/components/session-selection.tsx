'use client';

import { useCallback, useSyncExternalStore, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
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
