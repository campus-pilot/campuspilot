import { Navigate, useParams } from "react-router";

import { DetailPage, featureData, type FeatureSlug } from "@/marketing/catalog";
import { createMeta, type LandingPath } from "@/marketing/seo";

import type { Route } from "./+types/features.$slug";

export function meta({ params }: Route.MetaArgs) {
  return createMeta(`/features/${params.slug}` as LandingPath);
}

export default function FeatureDetail() {
  const { slug } = useParams();
  if (!slug || !(slug in featureData)) return <Navigate to="/features" replace />;
  return <DetailPage data={featureData[slug as FeatureSlug]} />;
}
