import { createMeta } from "@/site/seo";
import { NotFoundPage } from "@/pages/utility/not-found";
import pageStyles from "@/pages/utility/page.css?url";

import type { Route } from "./+types/_site.$";

export function meta({}: Route.MetaArgs) {
  return createMeta("/404");
}

export const links: Route.LinksFunction = () => [{ rel: "stylesheet", href: pageStyles }];

export default function NotFoundRoute() {
  return <NotFoundPage />;
}
