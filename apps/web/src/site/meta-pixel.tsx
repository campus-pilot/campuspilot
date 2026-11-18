import { useCallback } from "react";
import { useLocation } from "react-router";
import { env } from "@campuspilot/env/web";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

/**
 * The Meta Pixel of the website, set at build time (`VITE_META_PIXEL_ID`).
 * Without it nothing is loaded or sent: the pixel is opt-in per build, so a
 * build without the variable behaves exactly as before.
 */
const PIXEL_ID = env.VITE_META_PIXEL_ID;

/**
 * Meta's standard base code, minus its PageView call: page views are sent by
 * {@link MetaPixelPageView} on every route, the first one included, so the
 * first page is not counted twice. The ID is validated as digits by the env
 * schema, so interpolating it into the script is safe.
 */
const baseCode = (pixelId: string) =>
  `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${pixelId}');`;

/** The pixel's base code for the document head; nothing when the site has no pixel. */
export function MetaPixelScript() {
  if (!PIXEL_ID) return null;
  return <script dangerouslySetInnerHTML={{ __html: baseCode(PIXEL_ID) }} />;
}

/**
 * Sends a PageView for the current route. The element is keyed by the path,
 * so every navigation mounts a new one, and its callback ref fires once after
 * that commit: one page view per page, the prerendered first page included
 * (its hydration is the first mount). A callback ref rather than an effect,
 * as elsewhere in the apps.
 */
export function MetaPixelPageView() {
  const { pathname } = useLocation();
  if (!PIXEL_ID) return null;
  return <PageViewMarker key={pathname} />;
}

function PageViewMarker() {
  const track = useCallback((node: HTMLSpanElement | null) => {
    if (node) window.fbq?.("track", "PageView");
  }, []);
  return <span ref={track} hidden />;
}
