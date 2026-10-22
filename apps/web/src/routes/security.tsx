import { Check, ShieldCheck } from "lucide-react";

import { securityItems } from "@/marketing/catalog";
import { FinalCta, MarketingPage, PageHero, SectionIntro } from "@/marketing/components";
import { createMeta } from "@/marketing/seo";

import type { Route } from "./+types/security";

export function meta({}: Route.MetaArgs) { return createMeta("/security"); }

export default function SecurityPage() {
  return <MarketingPage>
    <PageHero eyebrow="Designed around boundaries, not bolted on later" title="The right access for every" accent="campus, role, class, and section." description="CampusPilot combines isolated school tenants, role-based permissions, and teacher assignment scopes so each protected operation retains the right operational context."><div className="security-radar"><i /><i /><i /><span><ShieldCheck /></span><b>Teacher</b><b>Finance</b><b>Student</b></div></PageHero>
    <section className="marketing-section"><div className="marketing-container"><SectionIntro eyebrow="01 / Trust by architecture" title="Security follows the work" accent="all the way through." description="Identity, school context, role permissions, and assignment scope are evaluated across normal application workflows and connected tools." /><div className="outcome-grid">{securityItems.map(([Icon, title, text], index) => <article key={title}><span><Icon /></span><small>0{index + 1}</small><h2>{title}</h2><p>{text}</p></article>)}</div></div></section>
    <section className="marketing-section dark-section"><div className="marketing-container detail-split"><div><SectionIntro eyebrow="02 / Clear boundaries" title="Broad enough for the role." accent="Bound to the right school." description="Users see what they need to operate, without turning convenience into uncontrolled access." /><ul className="check-list inverse">{["School and session context remains explicit", "Finance permissions stay separate from general administration", "Teacher access follows assigned classes and sections", "Student identities access only their own information", "Connected AI tools inherit—not replace—authorization"].map((item) => <li key={item}><Check />{item}</li>)}</ul></div><div className="boundary-card"><ShieldCheck /><small>EVERY PROTECTED REQUEST</small><h2>Identity → Campus → Role → Assignment → Action</h2><p>Permission decisions remain attached to the operational context that gives them meaning.</p></div></div></section>
    <FinalCta />
  </MarketingPage>;
}
