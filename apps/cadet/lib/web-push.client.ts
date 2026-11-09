'use client';

import { isInstalledApp, isIos } from '@campuspilot/components/install-app-state';
import type { DeviceNotificationStatus } from '@campuspilot/components/notifications';
import { env } from '@campuspilot/env/cadet.client';

import { client } from './orpc';

/**
 * Web push on this device (plan §3b). The service worker is
 * `public/sw.js`, registered only when the student turns notifications on.
 * A browser profile has one push subscription for the portal, shared by
 * every student who signs in on it (siblings); the server keeps one row per
 * login, so "on/off" here is always about the signed-in student.
 */

const SERVICE_WORKER_URL = '/sw.js';

/** Whether this browser has every API web push needs and the portal has a key. */
function hasPushApis() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    Boolean(env.NEXT_PUBLIC_VAPID_PUBLIC_KEY)
  );
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration('/');
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/**
 * Reads this device's state for the signed-in student; the query function
 * of the device-state query. iPhones and iPads support push only inside the
 * installed (Home Screen) app.
 */
export async function readDeviceNotificationStatus(): Promise<Exclude<DeviceNotificationStatus, 'loading'>> {
  if (isIos() && !isInstalledApp()) return 'needs_install';
  if (!hasPushApis()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  const subscription = await currentSubscription();
  if (!subscription) return 'off';
  const { active } = await client.getPushSubscription({ endpoint: subscription.endpoint });
  return active ? 'on' : 'off';
}

/** The VAPID public key as the bytes `pushManager.subscribe` expects. */
function applicationServerKey(): Uint8Array<ArrayBuffer> {
  const base64 = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** A refusal shown to the student as is. */
export class DevicePushError extends Error {
  override name = 'DevicePushError';
}

/**
 * Turns notifications on for the signed-in student on this device.
 * `permission` must be the promise of `Notification.requestPermission()`
 * started directly in the click handler: Safari only shows the prompt for a
 * call made inside the user's gesture.
 */
export async function turnOnDeviceNotifications(permission: Promise<NotificationPermission>) {
  if (!hasPushApis()) throw new DevicePushError('This browser cannot show notifications.');
  if ((await permission) !== 'granted') {
    throw new DevicePushError('Notifications were not allowed. Allow them in your browser’s site settings to turn them on.');
  }
  await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: '/' });
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey() }));
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new DevicePushError('This browser returned an incomplete subscription.');
  await client.subscribePush({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
}

/**
 * Turns notifications off for the signed-in student on this device. The
 * browser subscription itself is kept: a sibling signed in on the same
 * browser may still use it.
 */
export async function turnOffDeviceNotifications() {
  if (!hasPushApis()) return;
  const subscription = await currentSubscription();
  if (subscription) await client.unsubscribePush({ endpoint: subscription.endpoint });
}
