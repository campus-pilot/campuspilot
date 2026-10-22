import { ArrowRight, Bot, Fingerprint, ShieldCheck, Sparkles } from "lucide-react";
import { Link } from "react-router";

import { aiItems } from "@/marketing/catalog";
import { FinalCta, MarketingPage, PageHero, SectionIntro } from "@/marketing/components";
import { createMeta } from "@/marketing/seo";

import type { Route } from "./+types/ai-ready";

export function meta({}: Route.MetaArgs) { return createMeta("/ai-ready"); }

export default function AiReadyPage() {
  return <MarketingPage>
    <PageHero eyebrow="AI readiness, built into the foundation" title="Ready to work with AI—" accent="without rebuilding later." description="CampusPilot makes authorized school workflows available to compatible AI assistants through a native Model Context Protocol connection, with existing permissions kept in force."><div className="ai-request-flow"><span><Bot />Compatible assistant</span><ArrowRight /><span><ShieldCheck />CampusPilot permissions</span><ArrowRight /><span><Sparkles />Useful result</span></div></PageHero>
    <section className="marketing-section dark-section"><div className="marketing-container"><SectionIntro eyebrow="01 / The connection model" title="Ask naturally." accent="Act through authorized tools." description="The assistant never receives a shortcut around CampusPilot. Each request is resolved through a structured platform procedure under the connected identity." /><div className="ai-flow-detail"><span><Bot /><b>Request</b><small>“Which classes still need result entries?”</small></span><ArrowRight /><span><Fingerprint /><b>Identity + permission check</b><small>Resolve the school, role, and assignment scope.</small></span><ArrowRight /><span><ShieldCheck /><b>Scoped answer</b><small>Return only authorized operational context.</small></span></div></div></section>
    <section className="marketing-section"><div className="marketing-container"><SectionIntro eyebrow="02 / AI-ready by design" title="A dependable foundation" accent="for assisted school operations." /><div className="outcome-grid four-column">{aiItems.map(([Icon, title, text], index) => <article key={title}><span><Icon /></span><small>0{index + 1}</small><h2>{title}</h2><p>{text}</p></article>)}</div></div></section>
    <section className="marketing-section muted-section"><div className="marketing-container related-banner"><Fingerprint /><div><small>AI TRUST STATEMENT</small><h2>AI access does not bypass CampusPilot security.</h2><p>Connected tools act within the identity and permissions provided to them. A teacher remains limited to assigned classes and sections; finance access stays restricted; and every campus remains isolated.</p></div><Link className="marketing-button marketing-button-dark" to="/security">Explore security <ArrowRight /></Link></div></section>
    <FinalCta />
  </MarketingPage>;
}
