import { ArrowRight } from "lucide-react";

import { DirectoryGrid, featureDirectory } from "@/marketing/catalog";
import { FinalCta, MarketingPage, PageHero, SectionIntro } from "@/marketing/components";
import { createMeta } from "@/marketing/seo";

import type { Route } from "./+types/features";

export function meta({}: Route.MetaArgs) { return createMeta("/features"); }

export default function FeaturesPage() {
  return <MarketingPage><PageHero eyebrow="Everything your school needs to keep moving" title="One platform." accent="Every essential workflow." description="CampusPilot connects the operational journey of a school—from the first admission enquiry to class placement, fee collection, examinations, results, and official documents." /><section className="marketing-section"><div className="marketing-container"><SectionIntro eyebrow="01 / Explore the platform" title="Choose a workflow." accent="Keep the context." description="Each capability is designed to work deeply on its own and naturally with everything around it." /><DirectoryGrid items={featureDirectory} /></div></section><section className="marketing-section muted-section"><div className="marketing-container"><SectionIntro eyebrow="02 / One connected lifecycle" title="The record gets richer." accent="The work gets easier." /><ol className="step-strip">{["Admission", "Classroom", "Billing", "Examination", "Document", "Student access"].map((item, index) => <li key={item}><span>0{index + 1}</span><b>{item}</b>{index < 5 && <ArrowRight />}</li>)}</ol></div></section><FinalCta /></MarketingPage>;
}
