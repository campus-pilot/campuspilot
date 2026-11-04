import { ArrowRight, Bot, Workflow } from "lucide-react";
import { Link } from "react-router";

import { Section, SectionIntro } from "@/site/ui/section";

import { playOnView, staggerStyle } from "./reveal";

type ChainLink = {
  stage: string;
  /** What this stage adds to the one record (fictional student, illustrative values). */
  adds: string;
  feature: string;
  href: string;
};

const chain: readonly ChainLink[] = [
  { stage: "Admission", adds: "Aarav Sharma · 2025015", feature: "Admissions", href: "/features/admissions" },
  { stage: "Class and section", adds: "+ Class 8 A · 2026–27", feature: "Academics", href: "/features/academics" },
  { stage: "Fee account", adds: "+ Term 1 bill · receipt", feature: "Finance and billing", href: "/features/billing" },
  { stage: "Marks", adds: "+ First Term results", feature: "Examinations", href: "/features/examinations" },
  { stage: "Report card", adds: "+ Approved PDF", feature: "Documents", href: "/features/documents" },
  { stage: "Family view", adds: "Only Aarav's records", feature: "Student portal", href: "/features/student-portal" },
];

function ChainNode({ link, index }: { link: ChainLink; index: number }) {
  return (
    <li className="pg-features-chain-node" style={staggerStyle(index)}>
      <Link to={link.href} className="pg-features-chain-card">
        <span className="pg-features-chain-dot" aria-hidden="true" />
        <b>{link.stage}</b>
        <code>{link.adds}</code>
        <small>
          {link.feature} <ArrowRight aria-hidden="true" />
        </small>
      </Link>
    </li>
  );
}

/** Honest AI-ready note: today's assistant access, with the agentic part labelled as roadmap. */
function ChainAiNote() {
  return (
    <div className="pg-features-chain-ai">
      <span className="pg-features-chain-ai-icon" aria-hidden="true"><Bot /></span>
      <p>
        <b>AI-ready, because it is one set of records.</b> The assistant your team already uses can answer from them, with
        the same permissions as the person asking. <em>On the roadmap:</em> CampusPilot preparing work, like a
        fee-reminder list, for someone to review.
      </p>
      <Link className="cp-text-link" to="/ai-ready">
        How AI-ready works <ArrowRight aria-hidden="true" />
      </Link>
    </div>
  );
}

/**
 * "How the features connect": one student's record gathering detail as it
 * passes through each feature. The rail fills and the stages light up in order
 * the first time the strip scrolls into view (`playOnView`).
 */
export function ConnectStrip() {
  return (
    <Section id="connect" labelledBy="pg-features-connect-title" className="pg-features-connect">
      <SectionIntro
        id="pg-features-connect-title"
        eyebrow="Done once"
        eyebrowIcon={Workflow}
        title="One record. Every workflow after it."
        description="Details are entered once, at the point they first appear. Each feature after that adds to the same record instead of starting a new one."
      />
      <ol className="pg-features-chain" ref={playOnView}>
        {chain.map((link, index) => (
          <ChainNode key={link.stage} link={link} index={index} />
        ))}
      </ol>
      <ChainAiNote />
    </Section>
  );
}
