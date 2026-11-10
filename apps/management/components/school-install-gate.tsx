'use client';

import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  InstallAppScreen,
  type InstallAppScreenStatus,
} from '@campuspilot/components/install-app-screen';
import { orpc } from '@/lib/orpc';
import { SchoolAvatar } from './school-avatar';

/** How long "Continue here" keeps the install screen away for a school. */
const DISMISS_FOR_MS = 7 * 24 * 60 * 60 * 1_000;

const dismissKey = (schoolId: string) =>
  `campuspilot.management.installDismissedUntil:${schoolId}`;

/** Chromium's install-prompt event; not part of the DOM type library. */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

/**
 * Module-level install state, subscribed to through `useSyncExternalStore`.
 * Listeners attach when this module loads, so a `beforeinstallprompt` that
 * fires before React renders is still captured.
 */
const installStore = (() => {
  let deferredPrompt: BeforeInstallPromptEvent | null = null;
  let installed = false;
  let snapshot = { canPrompt: false, installed: false };
  const listeners = new Set<() => void>();
  const emit = () => {
    snapshot = { canPrompt: deferredPrompt !== null, installed };
    listeners.forEach((listener) => listener());
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', (event) => {
      // Suppress Chrome's own mini-infobar; the install screen offers it.
      event.preventDefault();
      deferredPrompt = event as BeforeInstallPromptEvent;
      emit();
    });
    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      installed = true;
      emit();
    });
  }

  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    /** Opens the browser's install dialog; true when the user accepted. */
    async prompt() {
      const event = deferredPrompt;
      if (!event) return false;
      deferredPrompt = null;
      await event.prompt();
      const { outcome } = await event.userChoice;
      if (outcome === 'accepted') installed = true;
      emit();
      return outcome === 'accepted';
    },
  };
})();

const SERVER_INSTALL_SNAPSHOT = { canPrompt: false, installed: false };

/**
 * True for any display mode other than a browser tab (standalone, fullscreen,
 * minimal UI, window controls overlay), plus iOS home-screen apps. Inside an
 * installed app the install screen must never appear.
 */
function subscribeDisplayMode(listener: () => void) {
  const query = window.matchMedia('(display-mode: browser)');
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}
function isInstalledApp() {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean })
    .standalone;
  return iosStandalone === true || !window.matchMedia('(display-mode: browser)').matches;
}

/**
 * Phones only. Chromium reports it directly; iPhone (every browser there runs
 * WebKit) and Firefox for Android fall back to the User-Agent string. iPads
 * present themselves as Macs and so never match.
 */
function isPhone() {
  const uaData = (navigator as Navigator & { userAgentData?: { mobile: boolean } })
    .userAgentData;
  return uaData?.mobile ?? /iPhone|iPod|Android.*Mobile/.test(navigator.userAgent);
}
const isIos = () => /iPhone|iPod/.test(navigator.userAgent);

const noopSubscribe = () => () => {};

/**
 * Reads and writes the per-school "Continue here" expiry in localStorage.
 * Storage can be unavailable (private mode, blocked site data); the screen
 * then simply shows again next time.
 */
function subscribeStorage(listener: () => void) {
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}
function isDismissed(schoolId: string) {
  try {
    const until = Number(window.localStorage.getItem(dismissKey(schoolId)));
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}
function dismiss(schoolId: string) {
  try {
    window.localStorage.setItem(
      dismissKey(schoolId),
      String(Date.now() + DISMISS_FOR_MS),
    );
  } catch {
    // Without storage the choice lasts for this page only.
  }
}

/**
 * Decides whether a school's install screen shows. The server render and
 * hydration always say "hidden"; the client re-checks right after, so these
 * browser-only facts never cause a hydration mismatch.
 */
function useInstallScreen(schoolId: string) {
  const phone = useSyncExternalStore(noopSubscribe, isPhone, () => false);
  const installedApp = useSyncExternalStore(subscribeDisplayMode, isInstalledApp, () => true);
  const dismissed = useSyncExternalStore(
    subscribeStorage,
    () => isDismissed(schoolId),
    () => true,
  );
  const install = useSyncExternalStore(
    installStore.subscribe,
    installStore.getSnapshot,
    () => SERVER_INSTALL_SNAPSHOT,
  );
  const [continued, setContinued] = useState(false);
  const [needsSteps, setNeedsSteps] = useState(false);

  return {
    visible: phone && !installedApp && !dismissed && !continued,
    status: installStatus(install, needsSteps),
    onInstall: async () => {
      // No dialog available (Firefox, an installed app, a dismissed dialog
      // that Chrome will not offer again): show the manual steps instead.
      if (!(await installStore.prompt())) setNeedsSteps(true);
    },
    onContinue: () => {
      dismiss(schoolId);
      setContinued(true);
    },
  };
}

/**
 * iPhone browsers can never open an install dialog, so they get the steps
 * straight away. Elsewhere the button shows first and falls back to steps
 * once a tap finds no dialog to open.
 */
function installStatus(
  install: { canPrompt: boolean; installed: boolean },
  needsSteps: boolean,
): InstallAppScreenStatus {
  if (install.installed) return 'installed';
  if (isIos()) return 'ios';
  if (install.canPrompt || !needsSteps) return 'ready';
  return 'android';
}

/**
 * Covers every page under `/school/{schoolId}` on phones, outside the
 * installed app, with an invitation to install this school's app. "Continue
 * here" hides it for this school for a week. Mounted once, in the
 * `[schoolId]` layout, so no lower layout repeats it.
 */
export function SchoolInstallGate({
  schoolId,
  children,
}: {
  schoolId: string;
  children: ReactNode;
}) {
  const screen = useInstallScreen(schoolId);
  const schoolsQuery = useQuery(orpc.school.listMySchools.queryOptions());
  const school = schoolsQuery.data?.find((candidate) => candidate.id === schoolId);

  return (
    <>
      {children}
      {screen.visible && school ? (
        <InstallAppScreen
          schoolLogo={<SchoolAvatar school={school} size="sm" />}
          schoolName={school.name}
          status={screen.status}
          onInstall={screen.onInstall}
          onContinue={screen.onContinue}
        />
      ) : null}
    </>
  );
}
