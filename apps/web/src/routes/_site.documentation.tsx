import { createMeta } from "@/site/seo";
import { DocumentationPage } from "@/pages/utility/documentation";
import pageStyles from "@/pages/utility/page.css?url";

import type { Route } from "./+types/_site.documentation";

export function meta({}: Route.MetaArgs) {
  return createMeta("/documentation");
}

export const links: Route.LinksFunction = () => [{ rel: "stylesheet", href: pageStyles }];

export default function DocumentationRoute() {
  return <DocumentationPage />;
}
