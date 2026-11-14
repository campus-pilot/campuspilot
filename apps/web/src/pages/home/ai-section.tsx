import { ArrowRight, Sparkles } from "lucide-react";
import { Link } from "react-router";

import { DotsNetwork } from "@/site/signature";
import { Section, SectionIntro } from "@/site/ui/section";

type AiStage = {
  id: "today" | "coming";
  tag: string;
  title: string;
  text: string;
};

/**
 * The only place on the home page that names the roadmap, so "available today"
 * and "coming" are never confused. "Coming" must stay labelled as roadmap.
 */
const aiStages: readonly AiStage[] = [
  {
    id: "today",
    tag: "Today",
    title: "Your assistants, your permissions",
    text: "Connect the AI assistants your team already uses. They answer from live CampusPilot records as the person asking. Inside CampusPilot, AI already drafts question papers for teachers to review.",
  },
  {
    id: "coming",
    tag: "Coming · on the roadmap",
    title: "More AI inside CampusPilot",
    text: "Agentic AI that prepares more work, like the fee-reminder list or report cards for approval, for a person to review.",
  },
];

function AiStageItem({ stage }: { stage: AiStage }) {
  return (
    <li className="pg-home-ai-stage" data-stage={stage.id}>
      <span className="pg-home-ai-marker" aria-hidden="true" />
      <span className="pg-home-ai-tag">{stage.tag}</span>
      <b>{stage.title}</b>
      <p>{stage.text}</p>
    </li>
  );
}

/** Two stops on one rail: a solid "today" marker and a dashed, hollow "coming" one. */
function AiRail() {
  return (
    <div className="pg-home-ai-rail">
      <ol aria-label="AI in CampusPilot, today and coming">
        {aiStages.map((stage) => (
          <AiStageItem key={stage.id} stage={stage} />
        ))}
      </ol>
      <Link className="cp-text-link" to="/ai-ready">
        How AI readiness works <ArrowRight aria-hidden="true" />
      </Link>
    </div>
  );
}

/**
 * "AI-ready, permissions intact": the `/3`-born dots network in AI mode. The
 * assistant is the hub; switching the asking role relights the record areas it
 * may reach, which is the whole message of the section.
 */
export function AiSection() {
  return (
    <Section id="ai" labelledBy="ai-title" className="pg-home-ai">
      <SectionIntro
        id="ai-title"
        eyebrow="AI-ready"
        eyebrowIcon={Sparkles}
        title="AI-ready, with permissions intact."
        description="An assistant reaches only what the person asking may reach. Switch roles and watch its reach change."
      />
      <DotsNetwork mode="ai" />
      <AiRail />
    </Section>
  );
}
