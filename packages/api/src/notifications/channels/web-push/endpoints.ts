/**
 * Push services a subscription endpoint may point at. The worker POSTs to
 * the endpoint a browser handed the student, so an endpoint is user input:
 * without this allowlist a student could make the worker send requests to
 * any host (SSRF). Every browser engine CampusPilot supports uses one of
 * these services (Chromium browsers incl. Samsung Internet and Opera: FCM;
 * Firefox: Mozilla autopush; Safari/iOS: Apple; legacy Edge/Windows: WNS).
 * Checked when subscribing and again before every send.
 */
const PUSH_SERVICE_HOST_SUFFIXES = [
  'fcm.googleapis.com',
  'push.services.mozilla.com',
  'push.apple.com',
  'notify.windows.com',
] as const;

/** True for an `https:` URL on a known push service (host or subdomain). */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}
