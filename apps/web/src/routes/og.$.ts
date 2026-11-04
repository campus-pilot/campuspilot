import { findRouteBySocialImage } from "@/site/seo";
import { renderSocialCard } from "@/site/og/render.server";

import type { Route } from "./+types/og.$";

/**
 * Resource route for the generated social cards (`/og/home.png`,
 * `/og/features/billing.png`, …). The site is static, so React Router calls
 * this loader only while prerendering and writes each PNG into
 * `build/client/og/`; nginx then serves them as plain files.
 */
export async function loader({ params }: Route.LoaderArgs) {
  const route = findRouteBySocialImage(`/og/${params["*"]}`);
  if (!route) throw new Response("Not found", { status: 404 });

  const png = await renderSocialCard(route.card);
  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
  });
}
