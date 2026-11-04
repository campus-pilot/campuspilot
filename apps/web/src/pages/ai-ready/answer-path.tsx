import { Check, Lock, MessageSquareText, Route as RouteIcon, ShieldCheck, Split, UserCheck, type LucideIcon } from "lucide-react";

import { Section, SectionIntro } from "@/site/ui/section";

import { playOnView, stagger } from "./play-on-view";

/** Shared frame of each step: number, icon dot, title and one plain sentence, then the step's example. */
function StepFrame({ index, icon: Icon, title, text, children }: { index: number; icon: LucideIcon; title: string; text: string; children: React.ReactNode }) {
  return (
    <li className="pg-ai-step" style={stagger(index)}>
      <span className="pg-ai-step-dot" aria-hidden="true"><Icon /></span>
      <div className="pg-ai-step-body">
        <small className="pg-ai-step-num">Step {index + 1}</small>
        <h3>{title}</h3>
        <p>{text}</p>
        {children}
      </div>
    </li>
  );
}

function AskExample() {
  return (
    <p className="pg-ai-bubble">
      <span className="cp-sr-only">Example question: </span>
      Whose Science marks are still pending in 8 A?
    </p>
  );
}

function ActAsExample() {
  return (
    <p className="pg-ai-identity">
      <UserCheck aria-hidden="true" />
      <span>Acting as <b>Ms. Anjali Rao</b> · Class teacher</span>
    </p>
  );
}

const checks = [
  ["Campus", "Riverview Public School, Bengaluru"],
  ["Role", "Class teacher"],
  ["Class", "8 A is assigned to her"],
] as const;

function CheckExample() {
  return (
    <ul className="pg-ai-checks" aria-label="Checks for this question">
      {checks.map(([label, value], index) => (
        <li key={label} style={stagger(index)}>
          <Check aria-hidden="true" />
          <span><b>{label}</b> {value}</span>
        </li>
      ))}
    </ul>
  );
}

function OutcomeExample() {
  return (
    <ul className="pg-ai-outcomes" aria-label="Possible outcomes">
      <li data-outcome="answer">
        <ShieldCheck aria-hidden="true" />
        <span><b>Answers:</b> 3 students in 8 A, from the marks entered so far.</span>
      </li>
      <li data-outcome="decline">
        <Lock aria-hidden="true" />
        <span><b>Declines:</b> asked about fee dues for the whole school, it says that is outside her access.</span>
      </li>
    </ul>
  );
}

/**
 * Four-step sequence: a person asks → the assistant acts as that person →
 * CampusPilot checks campus, role and class → answers from live records or
 * declines. Horizontal with a drawn connector on wide screens, a vertical
 * rail on phones. Steps, checks and outcomes play once on view.
 */
export function AnswerPathSection() {
  return (
    <Section id="how-it-answers" labelledBy="pg-ai-path-title" className="pg-ai-path-section">
      <SectionIntro
        id="pg-ai-path-title"
        eyebrow="How a question is answered"
        eyebrowIcon={RouteIcon}
        title="Every answer passes the same checks."
        description="Whatever the question, the path is the same. The assistant never gets a way around CampusPilot; it goes through the front door as the person who asked."
      />
      <ol className="pg-ai-path" ref={playOnView}>
        <StepFrame index={0} icon={MessageSquareText} title="A person asks" text="A class teacher asks her usual AI assistant a question in plain words.">
          <AskExample />
        </StepFrame>
        <StepFrame index={1} icon={UserCheck} title="The assistant acts as her" text="It works with her access, never as an administrator and never through a shared login.">
          <ActAsExample />
        </StepFrame>
        <StepFrame index={2} icon={ShieldCheck} title="CampusPilot checks" text="Which campus, which role, which classes and sections. Every time, for every question.">
          <CheckExample />
        </StepFrame>
        <StepFrame index={3} icon={Split} title="Answer or decline" text="Inside her access, it answers from live records. Outside it, it says no and points to who can help.">
          <OutcomeExample />
        </StepFrame>
      </ol>
      <p className="pg-ai-path-note"><Lock aria-hidden="true" />No step can be skipped, by a person or by an assistant.</p>
    </Section>
  );
}
