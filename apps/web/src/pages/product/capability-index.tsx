/**
 * Capability index: a compact, numbered table of contents linking every
 * feature page and Security (`featureDirectory`), next to a short AI-ready
 * teaser that keeps "today" and "on the roadmap" clearly apart.
 */
import { ArrowRight, ArrowUpRight, Bot, LayoutGrid, Sparkles } from "lucide-react";
import { Link } from "react-router";

import { featureDirectory, type DirectoryEntry } from "@/site/content/catalog";
import { Section, SectionIntro } from "@/site/ui/section";

function IndexRow({ entry, index }: { entry: DirectoryEntry; index: number }) {
  const Icon = entry.icon;
  return (
    <li>
      <Link className="pg-product-index-link" to={entry.href}>
        <span className="pg-product-index-num">{String(index + 1).padStart(2, "0")}</span>
        <span className="pg-product-index-icon" aria-hidden="true">
          <Icon />
        </span>
        <span className="pg-product-index-text">
          <b>{entry.title}</b>
          <small>{entry.text}</small>
        </span>
        <ArrowUpRight className="pg-product-index-arrow" aria-hidden="true" />
      </Link>
    </li>
  );
}

function CapabilityIndex() {
  return (
    <nav className="pg-product-index" aria-label="CampusPilot capabilities">
      <ol>
        {featureDirectory.map((entry, index) => (
          <IndexRow key={entry.href} entry={entry} index={index} />
        ))}
      </ol>
    </nav>
  );
}

type AiStatus = { tag: string; tone: "today" | "coming"; title: string; text: string };

const aiStatuses: readonly AiStatus[] = [
  {
    tag: "Available today",
    tone: "today",
    title: "Assistants your team already uses",
    text: "They can look up and work with CampusPilot records, with the same permissions as the person asking.",
  },
  {
    tag: "On the roadmap",
    tone: "coming",
    title: "Help inside CampusPilot",
    text: "AI that prepares work for a person to review, such as a fee-reminder list or report cards waiting for approval.",
  },
];

function AiStatusItem({ status }: { status: AiStatus }) {
  return (
    <li className="pg-product-ai-item">
      <span className="pg-product-ai-tag" data-tone={status.tone}>
        {status.tag}
      </span>
      <b>{status.title}</b>
      <p>{status.text}</p>
    </li>
  );
}

function AiTeaser() {
  return (
    <aside className="pg-product-ai" aria-labelledby="pg-product-ai-title">
      <span className="pg-product-ai-badge" aria-hidden="true">
        <Bot />
        <Sparkles />
      </span>
      <h3 id="pg-product-ai-title">AI-ready, within the rules you already set.</h3>
      <ul>
        {aiStatuses.map((status) => (
          <AiStatusItem key={status.tag} status={status} />
        ))}
      </ul>
      <Link className="cp-text-link" to="/ai-ready">
        What AI-ready means <ArrowRight aria-hidden="true" />
      </Link>
    </aside>
  );
}

export function CapabilityIndexSection() {
  return (
    <Section id="capabilities" labelledBy="capabilities-title">
      <SectionIntro
        id="capabilities-title"
        eyebrow="Capabilities"
        eyebrowIcon={LayoutGrid}
        title="Deep workflows. One dependable system."
        description="Each area is useful on its own, and stronger because the same school, session, people and permissions run through all of them."
      />
      <div className="pg-product-caps">
        <CapabilityIndex />
        <AiTeaser />
      </div>
    </Section>
  );
}
