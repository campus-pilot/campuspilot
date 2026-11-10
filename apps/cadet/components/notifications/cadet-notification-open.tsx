'use client';

import { redirect, useSearchParams } from 'next/navigation';

import { cadetRouteFromLink } from './cadet-notification-routes';

/**
 * Resolves a push link (`?type=…&<link facts>`) with the portal's route
 * builders and replaces this page with the result; the inbox when the type
 * has no page of its own. The target page checks the session itself.
 */
export function CadetNotificationOpen(): null {
  const params = useSearchParams();
  redirect(cadetRouteFromLink(new URLSearchParams(params.toString())));
}
