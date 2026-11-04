import { Target } from "lucide-react";

import type { DetailData } from "@/site/content/catalog";
import { Pill } from "@/site/ui/section";

type Outcome = DetailData["outcomes"][number];

function OutcomeRow({ outcome, index }: { outcome: Outcome; index: number }) {
  return (
    <li className="pg-features-outcome">
      <span className="pg-features-outcome-num" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
      <div className="pg-features-outcome-copy">
        <h3>{outcome.title}</h3>
        <p>{outcome.text}</p>
      </div>
    </li>
  );
}

/**
 * Three outcomes as a numbered ledger: a sticky heading on the left, large
 * mono numerals and ruled rows on the right (stacked on phones).
 */
export function OutcomesSection({ outcomes, name }: { outcomes: DetailData["outcomes"]; name: string }) {
  return (
    <section className="cp-section pg-features-outcomes" id="outcomes" aria-labelledby="pg-features-outcomes-title">
      <div className="pg-features-outcomes-intro">
        <Pill icon={Target}>Outcomes</Pill>
        <h2 id="pg-features-outcomes-title">What changes for your team.</h2>
        <p>{name} in CampusPilot, measured by the work it takes off people's desks.</p>
      </div>
      <ol className="pg-features-outcome-list">
        {outcomes.map((outcome, index) => (
          <OutcomeRow key={outcome.title} outcome={outcome} index={index} />
        ))}
      </ol>
    </section>
  );
}
