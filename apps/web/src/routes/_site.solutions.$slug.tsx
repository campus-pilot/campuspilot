import { Navigate } from "react-router";

import { isSolutionSlug } from "@/site/content/catalog";
import { createMeta } from "@/site/seo";
import { SolutionDetailPage } from "@/pages/solutions/detail-page";
import pageStyles from "@/pages/solutions/page.css?url";

import type { Route } from "./+types/_site.solutions.$slug";

/** Unknown slugs fall back to the `/solutions` metadata while the page redirects there. */
export function meta({ params }: Route.MetaArgs) {
  return createMeta(isSolutionSlug(params.slug) ? `/solutions/${params.slug}` : "/solutions");
}

export const links: Route.LinksFunction = () => [{ rel: "stylesheet", href: pageStyles }];

export default function SolutionDetailRoute({ params }: Route.ComponentProps) {
  if (!isSolutionSlug(params.slug)) return <Navigate to="/solutions" replace />;
  return <SolutionDetailPage key={params.slug} slug={params.slug} />;
}
