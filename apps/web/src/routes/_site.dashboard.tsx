import { createMeta } from "@/site/seo";
import { DashboardPage } from "@/pages/utility/dashboard";
import pageStyles from "@/pages/utility/page.css?url";

import type { Route } from "./+types/_site.dashboard";

export function meta({}: Route.MetaArgs) {
  return createMeta("/dashboard");
}

export const links: Route.LinksFunction = () => [{ rel: "stylesheet", href: pageStyles }];

export default function DashboardRoute() {
  return <DashboardPage />;
}
