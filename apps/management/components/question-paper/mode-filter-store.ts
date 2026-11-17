'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { isModeFilterStorageChange, modeFilterStorageKey, parseStoredModeFilter } from './question-paper-list-model';

/**
 * The Question paper tab's mode filter, kept in local storage per school
 * (`modeFilterStorageKey`) and read as an external store, like the stored
 * session selection (`useStoredSchoolSessionId`), so no effect copies it
 * into React state. Storage can be unavailable (a private window, blocked
 * site data): reads then give no filter and writes are skipped.
 *
 * Two kinds of change reach readers. A write from this tab (`storeModeFilter`)
 * only notifies them. A change from another tab arrives as a `storage` event
 * (which the writing tab never receives) and also bumps `externalRevision`,
 * which the page uses as part of its filter form's key: the form then
 * remounts seeded from the new entry. Without that, a form this tab already
 * changed would keep its own values and overwrite the other tab's choice on
 * its next change. A `storage` event with no key is `localStorage.clear()`
 * in another tab, which removes the entry too, so it counts as a change.
 */
const listeners = new Set<() => void>();
let externalRevision = 0;

function onStorage(event: StorageEvent) {
  if (!isModeFilterStorageChange(event.key)) return;
  externalRevision += 1;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  // One window listener for every reader, so one event bumps the revision once.
  if (listeners.size === 0) window.addEventListener('storage', onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
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

/**
 * How many times another tab changed (or cleared) a stored mode filter since
 * this page loaded; 0 on the server and at hydration. Part of the filter
 * form's key, so the form reseeds from the store only on such a change.
 */
export function useModeFilterExternalRevision(): number {
  return useSyncExternalStore(
    subscribe,
    () => externalRevision,
    () => 0,
  );
}
