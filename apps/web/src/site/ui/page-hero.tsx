import type { LucideIcon } from "lucide-react";

import { Pill } from "./section";

type PageHeroProps = {
  eyebrow: React.ReactNode;
  eyebrowIcon?: LucideIcon;
  /** The page's only `<h1>`. Wrap a phrase in `<em>` for the muted second line. */
  title: React.ReactNode;
  description: React.ReactNode;
  /** Usually a `ButtonRow`. */
  actions?: React.ReactNode;
  /** Right-hand illustration; without it the hero is a centered single column. */
  visual?: React.ReactNode;
  /** Small line under the actions ("Nursery to Class 12 · Fees in ₹"). */
  note?: React.ReactNode;
};

/**
 * Opening band for every page except home. Split layout when a `visual` is
 * given (text left, illustration right; stacked on mobile), centered otherwise.
 */
export function PageHero({ eyebrow, eyebrowIcon, title, description, actions, visual, note }: PageHeroProps) {
  return (
    <section className={`cp-page-hero ${visual ? "has-visual" : ""}`.trim()} aria-labelledby="cp-page-title">
      <div className="cp-page-hero-copy">
        <Pill icon={eyebrowIcon}>{eyebrow}</Pill>
        <h1 id="cp-page-title">{title}</h1>
        <p className="cp-page-hero-lead">{description}</p>
        {actions}
        {note ? <p className="cp-page-hero-note">{note}</p> : null}
      </div>
      {visual ? <div className="cp-page-hero-visual">{visual}</div> : null}
    </section>
  );
}
