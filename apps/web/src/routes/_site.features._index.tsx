import { FeaturesIndexPage } from "@/pages/features/index-page";
import pageStyles from "@/pages/features/page.css?url";
import { createMeta } from "@/site/seo";

import type { Route } from "./+types/_site.features._index";

export function meta({}: Route.MetaArgs) {
  return createMeta("/features");
}

export const links: Route.LinksFunction = () => [{ rel: "stylesheet", href: pageStyles }];

export default function FeaturesRoute() {
  return <FeaturesIndexPage />;
}
