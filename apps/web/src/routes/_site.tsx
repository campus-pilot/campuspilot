import { Outlet } from "react-router";

import { SiteShell } from "@/site/shell/site-shell";
import siteStyles from "@/site/site.css?url";
import signatureStyles from "@/site/signature/signature.css?url";

import type { Route } from "./+types/_site";

/**
 * Pathless layout for every public page: fonts, the shared stylesheets and the
 * site shell (navbar, frame, footer). Page routes are named `_site.<path>.tsx`
 * and render only their own sections; page-specific CSS comes from each
 * route's own `links`.
 */
export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&family=Caveat:wght@500..700&family=Kalam:wght@400;700&display=swap",
  },
  { rel: "stylesheet", href: siteStyles },
  { rel: "stylesheet", href: signatureStyles },
];

export default function SiteLayout() {
  return (
    <SiteShell>
      <Outlet />
    </SiteShell>
  );
}
