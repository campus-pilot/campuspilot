import { OnboardingPage } from "@/pages/onboarding/page";
import pageStyles from "@/pages/onboarding/page.css?url";
import requestStyles from "@/pages/contact/request.css?url";
import siteStyles from "@/site/site.css?url";

import type { Route } from "./+types/onboarding";

/**
 * `/onboarding`, the School Onboarding form. A page for people we send the
 * link to, never for search: it is outside the `_site` layout (no navigation,
 * not in `seoRoutes`, so no sitemap entry or social card), carries
 * `noindex, nofollow` here, is disallowed in `robots.txt`, and nginx adds an
 * `X-Robots-Tag` header for it.
 */
export function meta({}: Route.MetaArgs) {
  return [
    { title: "School onboarding | CampusPilot" },
    { name: "description", content: "Send us your school's details so we can set up CampusPilot for you." },
    { name: "robots", content: "noindex, nofollow, noarchive, nosnippet, noimageindex" },
  ];
}

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&display=swap" },
  { rel: "stylesheet", href: siteStyles },
  { rel: "stylesheet", href: requestStyles },
  { rel: "stylesheet", href: pageStyles },
];

export default function OnboardingRoute() {
  return <OnboardingPage />;
}
