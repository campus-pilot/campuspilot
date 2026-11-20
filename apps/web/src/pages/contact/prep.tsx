import { Check, NotebookPen } from "lucide-react";

import { Pill } from "@/site/ui/section";

const prepItems: readonly [string, string][] = [
  ["Number of campuses", "One campus, or several under one group? We'll show the setup that matches."],
  ["Classes & sections", "For example Nursery to Class 12, with sections A–C in the bigger classes."],
  ["Fee structure", "Your fee heads, instalments (monthly, term or annual), transport and the usual discounts."],
  ["Exam pattern", "Terms and unit tests, marks or grades, and the report card format you use today."],
  ["Current tools", "Registers, spreadsheets or another system: whatever you use now, so we can compare honestly."],
];

function PrepItem({ title, hint, index }: { title: string; hint: string; index: number }) {
  return (
    <li style={{ "--pg-i": index } as React.CSSProperties}>
      <span className="pg-book-tick" aria-hidden="true">
        <Check />
      </span>
      <span className="pg-book-pad-text">
        <b>{title}</b>
        <small>{hint}</small>
      </span>
    </li>
  );
}

/**
 * Paper-notepad checklist. Plain content on purpose: the ticks are drawn, not
 * inputs, because there is nothing to fill in before booking.
 */
function PrepNotepad() {
  return (
    <div className="pg-book-pad">
      <span className="pg-book-pad-clip" aria-hidden="true" />
      <div className="pg-book-pad-head">
        <b>Before the call</b>
        <small>5 things</small>
      </div>
      <ul className="pg-book-pad-list">
        {prepItems.map(([title, hint], index) => (
          <PrepItem key={title} title={title} hint={hint} index={index} />
        ))}
      </ul>
    </div>
  );
}

function PrepIntro() {
  return (
    <div className="pg-book-prep-intro">
      <Pill icon={NotebookPen}>Before the call</Pill>
      <h2 id="pg-book-prep-title">Five things worth having to hand.</h2>
      <p>
        Nothing needs to be exact, and nothing needs to be sent in advance. Rough answers help us show you your school
        instead of a generic one.
      </p>
      <span className="pg-book-scribble" aria-hidden="true">
        rough numbers are fine!
      </span>
    </div>
  );
}

export function PrepSection() {
  return (
    <section className="cp-section pg-book-prep" id="prepare" aria-labelledby="pg-book-prep-title">
      <PrepIntro />
      <PrepNotepad />
    </section>
  );
}
