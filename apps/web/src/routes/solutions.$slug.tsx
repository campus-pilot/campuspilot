import { Navigate, useParams } from "react-router";

import { DetailPage, solutionData, type SolutionSlug } from "@/marketing/catalog";
import { createMeta, type LandingPath } from "@/marketing/seo";

import type { Route } from "./+types/solutions.$slug";

export function meta({ params }: Route.MetaArgs) {
  return createMeta(`/solutions/${params.slug}` as LandingPath);
}

export default function SolutionDetail() {
  const { slug } = useParams();
  if (!slug || !(slug in solutionData)) return <Navigate to="/solutions" replace />;
  return <DetailPage data={solutionData[slug as SolutionSlug]} />;
}
