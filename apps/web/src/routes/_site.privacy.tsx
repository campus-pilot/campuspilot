import { LegalPage } from "@/pages/legal/page";
import pageStyles from "@/pages/legal/page.css?url";
import { privacyPolicy } from "@/pages/legal/legal-content";
import { createMeta } from "@/site/seo";

import type { Route } from "./+types/_site.privacy";

export function meta({}: Route.MetaArgs) {
  return createMeta("/privacy");
}

export const links: Route.LinksFunction = () => [{ rel: "stylesheet", href: pageStyles }];

export default function PrivacyRoute() {
  return <LegalPage document={privacyPolicy} other={{ to: "/terms", label: "Terms of use" }} />;
}
