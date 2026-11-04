'use client';

import { useSyncExternalStore } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
};

type InstallPromptStore = {
  promptEvent: BeforeInstallPromptEvent | null;
  listeners: Set<() => void>;
};

const storeKey = '__campusPilotInstallPromptStore__' as const;
const serverStore: InstallPromptStore = {
  promptEvent: null,
  listeners: new Set(),
};

type InstallPromptWindow = Window & {
  [storeKey]?: InstallPromptStore;
};

function notify(store: InstallPromptStore) {
  for (const listener of store.listeners) listener();
}

/**
 * Owns the one browser install prompt for the page. Keeping this external to
 * React lets every account-menu placement share the same prompt lifecycle.
 */
function getOrCreateClientStore(
  installWindow: InstallPromptWindow,
): InstallPromptStore {
  if (installWindow[storeKey]) return installWindow[storeKey];

  const store: InstallPromptStore = {
    promptEvent: null,
    listeners: new Set(),
  };
  installWindow[storeKey] = store;

  installWindow.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    store.promptEvent = event as BeforeInstallPromptEvent;
    notify(store);
  });
  installWindow.addEventListener('appinstalled', () => {
    store.promptEvent = null;
    notify(store);
  });

  return store;
}

const clientStore =
  typeof window === 'undefined'
    ? serverStore
    : getOrCreateClientStore(window as InstallPromptWindow);

function subscribe(listener: () => void) {
  clientStore.listeners.add(listener);
  return () => clientStore.listeners.delete(listener);
}

function getInstallAvailability() {
  return clientStore.promptEvent !== null;
}

function getServerInstallAvailability() {
  return false;
}

async function installApp() {
  const promptEvent = clientStore.promptEvent;
  if (!promptEvent) return;

  // A captured prompt can only be used once, regardless of the user's choice.
  clientStore.promptEvent = null;
  notify(clientStore);
  await promptEvent.prompt();
  await promptEvent.userChoice;
}

/** Exposes Chrome's native install action only while the app is installable. */
export function useInstallApp() {
  return {
    isInstallAvailable: useSyncExternalStore(
      subscribe,
      getInstallAvailability,
      getServerInstallAvailability,
    ),
    installApp,
  };
}
