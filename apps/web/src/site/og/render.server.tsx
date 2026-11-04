import { Resvg } from "@resvg/resvg-js";
import satori from "satori";

import { SOCIAL_IMAGE_SIZE, type SocialCard as SocialCardCopy } from "@/site/seo";

import geistRegular from "./fonts/Geist-Regular.ttf?inline";
import geistSemiBold from "./fonts/Geist-SemiBold.ttf?inline";
import { SocialCard } from "./social-card";

/**
 * Fonts are inlined into the server bundle (`?inline` yields a base64 data
 * URL) so rendering never depends on the working directory or system fonts.
 * The TTFs are Geist (SIL OFL, see `fonts/OFL.txt`), the site's own typeface.
 */
function fontData(dataUrl: string) {
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
}

const fonts = [
  { name: "Geist", data: fontData(geistRegular), weight: 400, style: "normal" },
  { name: "Geist", data: fontData(geistSemiBold), weight: 600, style: "normal" },
] as const;

/**
 * Renders a route's social card to PNG: satori lays the JSX out as SVG with the
 * text converted to paths, and resvg rasterises it — the same pipeline as
 * `next/og`. Runs only while prerendering, never in the browser.
 */
export async function renderSocialCard(card: SocialCardCopy) {
  const svg = await satori(<SocialCard card={card} />, { ...SOCIAL_IMAGE_SIZE, fonts: [...fonts] });
  return new Resvg(svg, { fitTo: { mode: "width", value: SOCIAL_IMAGE_SIZE.width } }).render().asPng();
}
