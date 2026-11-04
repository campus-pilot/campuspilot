import { createMeta } from "@/site/seo";
import { HomePage } from "@/pages/home/page";
import pageStyles from "@/pages/home/page.css?url";

import type { Route } from "./+types/_site._index";

export function meta({}: Route.MetaArgs) {
  return createMeta("/");
}

export const links: Route.LinksFunction = () => [{ rel: "stylesheet", href: pageStyles }];

export default function HomeRoute() {
  return <HomePage />;
}
