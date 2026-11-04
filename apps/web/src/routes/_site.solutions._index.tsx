import { createMeta } from "@/site/seo";
import { SolutionsIndexPage } from "@/pages/solutions/index-page";
import pageStyles from "@/pages/solutions/page.css?url";

import type { Route } from "./+types/_site.solutions._index";

export function meta({}: Route.MetaArgs) {
  return createMeta("/solutions");
}

export const links: Route.LinksFunction = () => [{ rel: "stylesheet", href: pageStyles }];

export default function SolutionsRoute() {
  return <SolutionsIndexPage />;
}
