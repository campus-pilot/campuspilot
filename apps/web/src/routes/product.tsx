import { ArrowRight, Check, FileText, GraduationCap, School, Users } from "lucide-react";
import { Link } from "react-router";

import { FinalCta, MarketingPage, PageHero, SectionIntro } from "@/marketing/components";
import { createMeta } from "@/marketing/seo";

import type { Route } from "./+types/product";

export function meta({}: Route.MetaArgs) { return createMeta("/product"); }

export default function ProductPage() {
  return <MarketingPage>
    <PageHero eyebrow="The connected school operating system" title="One platform for every step" accent="from admission to graduation." description="CampusPilot brings people, academics, fees, examinations, documents, and student access into one secure system—so every workflow carries the right context forward."><div className="product-orbit"><span><Users />Admission</span><span><School />Classroom</span><span><GraduationCap />Examinations</span><span><FileText />Documents</span><b>CampusPilot<small>One shared source</small></b></div></PageHero>
    <section className="marketing-section"><div className="marketing-container"><SectionIntro eyebrow="01 / One connected lifecycle" title="Work moves forward." accent="Context moves with it." description="A confirmed admission becomes an active student record. That record enters the right class and session, connects to billing and examinations, and powers final documents—without repeated entry." /><ol className="step-strip">{["Admission", "Classroom", "Billing", "Examination", "Document"].map((item, index) => <li key={item}><span>0{index + 1}</span><b>{item}</b>{index < 4 && <ArrowRight />}</li>)}</ol></div></section>
    <section className="marketing-section muted-section"><div className="marketing-container detail-split"><div><SectionIntro eyebrow="02 / Designed for the real operation" title="Deep workflows." accent="One dependable system." description="Each area is useful on its own and stronger because the same school, session, people, and permission context runs through all of them." /><ul className="check-list">{["Admissions and complete student records", "Academic structures and teacher assignments", "Session-owned finance and transparent ledgers", "Examination lifecycles and official documents", "Role-aware dashboards and student access", "Native MCP readiness for compatible AI tools"].map((item) => <li key={item}><Check />{item}</li>)}</ul></div><div className="setup-panel"><small>GUIDED SCHOOL SETUP</small>{["Add school details", "Invite team members", "Create classes and sections", "Configure academic session", "Set up finance rules", "Choose document templates"].map((item, index) => <span key={item}><b>0{index + 1}</b>{item}<Check /></span>)}</div></div></section>
    <section className="marketing-section"><div className="marketing-container related-banner"><div><small>EXPLORE THE DETAILS</small><h2>See every workflow in context.</h2><p>Understand what each CampusPilot capability owns and how it connects to the rest of the school.</p></div><Link className="marketing-button marketing-button-dark" to="/features">Browse all features <ArrowRight /></Link></div></section>
    <FinalCta />
  </MarketingPage>;
}
