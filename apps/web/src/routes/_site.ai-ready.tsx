import { AiReadyPage } from "@/pages/ai-ready/page";
import pageStyles from "@/pages/ai-ready/page.css?url";
import { createMeta } from "@/site/seo";

import type { Route } from "./+types/_site.ai-ready";

export function meta({}: Route.MetaArgs) {
  return createMeta("/ai-ready");
}

export const links: Route.LinksFunction = () => [{ rel: "stylesheet", href: pageStyles }];

export default function AiReadyRoute() {
  return <AiReadyPage />;
}
