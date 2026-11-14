import { LegalPage } from "@/pages/legal/page";
import pageStyles from "@/pages/legal/page.css?url";
import { termsOfUse } from "@/pages/legal/legal-content";
import { createMeta } from "@/site/seo";

import type { Route } from "./+types/_site.terms";

export function meta({}: Route.MetaArgs) {
  return createMeta("/terms");
}

export const links: Route.LinksFunction = () => [{ rel: "stylesheet", href: pageStyles }];

export default function TermsRoute() {
  return <LegalPage document={termsOfUse} other={{ to: "/privacy", label: "Privacy policy" }} />;
}
