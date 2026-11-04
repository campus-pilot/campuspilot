import { createMeta } from "@/site/seo";
import { createHomeStructuredData } from "@/site/structured-data";
import { homeFaqs } from "@/pages/home/faq-data";
import { HomePage } from "@/pages/home/page";
import pageStyles from "@/pages/home/page.css?url";

import type { Route } from "./+types/_site._index";

/** The home page also carries the site-wide Organization, WebSite, product and FAQ structured data. */
export function meta({}: Route.MetaArgs) {
  return [...createMeta("/"), { "script:ld+json": createHomeStructuredData(homeFaqs) }];
}

export const links: Route.LinksFunction = () => [{ rel: "stylesheet", href: pageStyles }];

export default function HomeRoute() {
  return <HomePage />;
}
