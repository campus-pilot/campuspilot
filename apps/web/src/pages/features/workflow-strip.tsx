import { Route as RouteIcon } from "lucide-react";

import { Section, SectionIntro } from "@/site/ui/section";

import { playOnView, staggerStyle } from "./reveal";

function FlowStep({ step, note, index }: { step: string; note: string; index: number }) {
  return (
    <li className="pg-features-flow-step" style={staggerStyle(index)}>
      <span className="pg-features-flow-node" aria-hidden="true">{index + 1}</span>
      <h3>{step}</h3>
      <p>{note}</p>
    </li>
  );
}

type WorkflowStripProps = {
  steps: readonly string[];
  notes: readonly string[];
};

/**
 * The feature's four steps on one rail. The first time the strip scrolls into
 * view the rail draws left to right and each step lights up as the line
 * reaches it (`playOnView`); phones get a vertical rail.
 */
export function WorkflowStrip({ steps, notes }: WorkflowStripProps) {
  return (
    <Section id="workflow" labelledBy="pg-features-flow-title" className="pg-features-workflow">
      <SectionIntro
        id="pg-features-flow-title"
        eyebrow="How it moves"
        eyebrowIcon={RouteIcon}
        title="Four steps, each done once."
        description="The same steps your team repeats every term, kept in order and connected, so nothing is entered twice."
      />
      <ol className="pg-features-flow" ref={playOnView}>
        {steps.map((step, index) => (
          <FlowStep key={step} step={step} note={notes[index] ?? ""} index={index} />
        ))}
      </ol>
    </Section>
  );
}
