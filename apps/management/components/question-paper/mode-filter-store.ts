'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { modeFilterStorageKey, parseStoredModeFilter } from './question-paper-list-model';

/**
 * The Question paper tab's mode filter, kept in local storage per school
 * (`modeFilterStorageKey`) and read as an external store, like the stored
 * session selection (`useStoredSchoolSessionId`), so no effect copies it
 * into React state. Storage can be unavailable (a private window, blocked
 * site data): reads then give no filter and writes are skipped.
 */
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith('question-paper-mode-filter:')) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** The raw stored entry ('' when there is none), a string so the snapshot stays referentially stable. */
function readRaw(schoolId: string): string {
  try {
    return window.localStorage.getItem(modeFilterStorageKey(schoolId)) ?? '';
  } catch {
    return '';
  }
}

/** Stores the selected mode slugs for the school and tells every reader. */
export function storeModeFilter(schoolId: string, slugs: readonly string[]) {
  try {
    window.localStorage.setItem(modeFilterStorageKey(schoolId), JSON.stringify(slugs));
  } catch {
    return;
  }
  listeners.forEach((listener) => listener());
}

/**
 * The stored mode slugs for the school, or undefined while rendering on the
 * server or hydrating (local storage cannot be read there). A caller seeds
 * its form only once this is defined, so a reload never seeds an empty
 * filter over the stored one.
 */
export function useStoredModeFilter(schoolId: string): string[] | undefined {
  const getSnapshot = useCallback(() => readRaw(schoolId), [schoolId]);
  const raw = useSyncExternalStore<string | undefined>(subscribe, getSnapshot, () => undefined);
  return useMemo(() => (raw === undefined ? undefined : parseStoredModeFilter(raw)), [raw]);
}
