import { ArrowRight, Bot, Repeat2, Sparkles } from "lucide-react";
import { Link } from "react-router";

import { Section, SectionIntro } from "@/site/ui/section";

import { featureExtras, type AiNote, type FeatureExtra, type FlowLink } from "./feature-extras";

function NextCard({ link }: { link: FlowLink }) {
  const target = featureExtras[link.slug];
  const Icon = target.icon;
  return (
    <li>
      <Link to={`/features/${link.slug}`} className="pg-features-next-card">
        <span className="pg-features-next-icon" aria-hidden="true"><Icon /></span>
        <small>{link.direction === "into" ? "Flows into" : "Draws from"}</small>
        <b>{target.name}</b>
        <p>{link.carries}</p>
        <span className="pg-features-next-go">
          Explore {target.name.toLowerCase()} <ArrowRight aria-hidden="true" />
        </span>
      </Link>
    </li>
  );
}

function AiRoadmap({ text }: { text: string }) {
  return (
    <p className="pg-features-ai-roadmap">
      <span><Sparkles aria-hidden="true" /> On the roadmap</span>
      {text}
    </p>
  );
}

/**
 * The feature's AI-ready angle: a question a staff member could put to the
 * assistant they already use, how the answer is bounded, and (only where the
 * brief allows) an agentic idea clearly labelled as roadmap.
 */
function AiReadyCard({ ai }: { ai: AiNote }) {
  return (
    <aside className="pg-features-ai" aria-labelledby="pg-features-ai-title">
      <div className="pg-features-ai-head">
        <span className="pg-features-next-icon" aria-hidden="true"><Bot /></span>
        <h3 id="pg-features-ai-title">AI-ready today</h3>
      </div>
      <p className="pg-features-ai-ask">“{ai.ask}”</p>
      <p className="pg-features-ai-answer">{ai.answer}</p>
      {ai.roadmap ? <AiRoadmap text={ai.roadmap} /> : null}
      <Link className="cp-text-link" to="/ai-ready">
        How AI-ready works <ArrowRight aria-hidden="true" />
      </Link>
    </aside>
  );
}

/** "What flows next": the done-once promise, the 2–3 features this record feeds, and the AI-ready note. */
export function FlowsNext({ extra }: { extra: FeatureExtra }) {
  return (
    <Section id="flows-next" labelledBy="pg-features-next-title" className="pg-features-next">
      <SectionIntro
        id="pg-features-next-title"
        eyebrow="Done once"
        eyebrowIcon={Repeat2}
        title="What flows next."
        description={extra.doneOnce}
      />
      <div className="pg-features-next-layout" data-has-ai={extra.ai ? "" : undefined}>
        <ul className="pg-features-next-list">
          {extra.next.map((link) => (
            <NextCard key={link.slug} link={link} />
          ))}
        </ul>
        {extra.ai ? <AiReadyCard ai={extra.ai} /> : null}
      </div>
    </Section>
  );
}
