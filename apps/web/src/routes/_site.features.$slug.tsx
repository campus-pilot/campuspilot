import { Navigate } from "react-router";

import { FeatureDetailPage } from "@/pages/features/detail-page";
import pageStyles from "@/pages/features/page.css?url";
import { isFeatureSlug } from "@/site/content/catalog";
import { createMeta } from "@/site/seo";

import type { Route } from "./+types/_site.features.$slug";

export function meta({ params }: Route.MetaArgs) {
  return isFeatureSlug(params.slug) ? createMeta(`/features/${params.slug}`) : createMeta("/404");
}

export const links: Route.LinksFunction = () => [{ rel: "stylesheet", href: pageStyles }];

/**
 * Unknown slugs go back to the features index, as on the previous site. The
 * page is keyed by slug so moving between features remounts it and replays
 * its one-time scroll animations.
 */
export default function FeatureRoute({ params }: Route.ComponentProps) {
  if (!isFeatureSlug(params.slug)) return <Navigate to="/features" replace />;
  return <FeatureDetailPage key={params.slug} slug={params.slug} />;
}
