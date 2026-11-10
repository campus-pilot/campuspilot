/*
 * Cadet Portal service worker: web push only (plan §3b). It caches nothing
 * and handles no fetches, so the portal behaves exactly as without it.
 *
 * The server sends `{ title, body, url, tag }` (see
 * packages/api/src/notifications/channels/web-push/render.ts): text built
 * from the notification's facts, and a same-origin path to
 * `/notifications/open?type=…&<identifiers>`, which the portal turns into
 * the item's route. `tag` is the notification ID, so a repeated push of the
 * same notification replaces the shown one.
 */

const FALLBACK_URL = '/notifications';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function readMessage(event) {
  try {
    const message = event.data ? event.data.json() : null;
    return message && typeof message === 'object' ? message : null;
  } catch {
    return null;
  }
}

/** Only same-origin paths are opened; anything else opens the inbox. */
function sameOriginUrl(value) {
  try {
    const url = new URL(typeof value === 'string' ? value : FALLBACK_URL, self.location.origin);
    return url.origin === self.location.origin ? url.href : new URL(FALLBACK_URL, self.location.origin).href;
  } catch {
    return new URL(FALLBACK_URL, self.location.origin).href;
  }
}

self.addEventListener('push', (event) => {
  const message = readMessage(event);
  const title = typeof message?.title === 'string' ? message.title : 'Cadet Portal';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof message?.body === 'string' ? message.body : 'You have a new notification.',
      tag: typeof message?.tag === 'string' ? message.tag : undefined,
      icon: '/app-icon-192.png',
      data: { url: sameOriginUrl(message?.url) },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = sameOriginUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        try {
          const focused = await client.focus();
          await (focused || client).navigate(url);
          return;
        } catch {
          // An uncontrolled window cannot be navigated from here; open a new one.
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
