import { SecurityPage } from "@/pages/security/page";
import pageStyles from "@/pages/security/page.css?url";
import { createMeta } from "@/site/seo";

import type { Route } from "./+types/_site.security";

export function meta({}: Route.MetaArgs) {
  return createMeta("/security");
}

export const links: Route.LinksFunction = () => [{ rel: "stylesheet", href: pageStyles }];

export default function SecurityRoute() {
  return <SecurityPage />;
}
