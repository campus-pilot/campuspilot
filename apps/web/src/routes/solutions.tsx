import { DirectoryGrid, solutionDirectory } from "@/marketing/catalog";
import { FinalCta, MarketingPage, PageHero, SectionIntro } from "@/marketing/components";
import { createMeta } from "@/marketing/seo";

import type { Route } from "./+types/solutions";

export function meta({}: Route.MetaArgs) { return createMeta("/solutions"); }

export default function SolutionsPage() {
  return <MarketingPage><PageHero eyebrow="Solutions for every school team" title="One operating system." accent="The right view for every role." description="CampusPilot keeps admissions, academics, finance, examinations, documents, and student access connected while giving each team access designed around its work." /><section className="marketing-section"><div className="marketing-container"><SectionIntro eyebrow="01 / By role and institution" title="Meet every team" accent="at the work they own." description="Focused workspaces share dependable records while permissions keep responsibility clear." /><DirectoryGrid items={solutionDirectory} /></div></section><FinalCta /></MarketingPage>;
}
