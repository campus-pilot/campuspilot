import { ArrowRight, BookOpen } from "lucide-react";
import { Link } from "react-router";

import { MarketingFooter } from "@/marketing/components";
import { createMeta } from "@/marketing/seo";

import type { Route } from "./+types/documentation";

export function meta({}: Route.MetaArgs) { return createMeta("/documentation"); }

export default function DocumentationPage() {
  return <><main id="main" className="documentation-soon"><BookOpen /><span>Documentation</span><h1>Coming soon.</h1><p>Product guides and workflow references are being prepared.</p><Link className="quiet-link" to="/product">Explore CampusPilot <ArrowRight /></Link></main><MarketingFooter /></>;
}
