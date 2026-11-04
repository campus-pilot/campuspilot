import type { LucideIcon } from "lucide-react";

/** Small rounded label above headings ("How it works", "FAQ"…). */
export function Pill({ icon: Icon, children }: { icon?: LucideIcon; children: React.ReactNode }) {
  return (
    <span className="cp-pill">
      {Icon ? <Icon aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

type SectionProps = {
  children: React.ReactNode;
  /** Used for in-page anchors (`#faq`) and as the base of the heading id. */
  id: string;
  /** Id of the section's heading, announced as the section's accessible name. */
  labelledBy: string;
  className?: string;
};

/**
 * Full-width band inside the site frame: top rule plus the small "+" marks
 * where the rule meets the frame's guide lines.
 */
export function Section({ children, id, labelledBy, className = "" }: SectionProps) {
  return (
    <section className={`cp-section ${className}`.trim()} id={id} aria-labelledby={labelledBy}>
      {children}
    </section>
  );
}

type SectionIntroProps = {
  /** Heading id; pass the same value to the parent `Section`'s `labelledBy`. */
  id: string;
  eyebrow: React.ReactNode;
  eyebrowIcon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Usually a `ButtonRow`. */
  actions?: React.ReactNode;
};

/** Centered pill + heading + lead used at the top of most sections (fades in on scroll). */
export function SectionIntro({ id, eyebrow, eyebrowIcon, title, description, actions }: SectionIntroProps) {
  return (
    <div className="cp-section-intro">
      <Pill icon={eyebrowIcon}>{eyebrow}</Pill>
      <h2 id={id}>{title}</h2>
      {description ? <p>{description}</p> : null}
      {actions}
    </div>
  );
}
