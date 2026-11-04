import { ArrowRight, Plus } from "lucide-react";
import { Link } from "react-router";

import { Pill } from "./section";

export type FaqEntry = {
  answer: string;
  question: string;
};

/**
 * Native `<details>` keeps the accordion keyboard- and screen-reader-friendly
 * without state. The shared `name` makes it exclusive (one answer open at a time)
 * in browsers that support it; the height animation uses `::details-content`
 * where available and degrades to an instant toggle elsewhere.
 */
function FaqItem({ entry, group }: { entry: FaqEntry; group: string }) {
  return (
    <details className="cp-faq-item" name={group}>
      <summary>
        <span>{entry.question}</span>
        <span className="cp-faq-icon" aria-hidden="true">
          <Plus />
        </span>
      </summary>
      <p className="cp-faq-answer">{entry.answer}</p>
    </details>
  );
}

function FaqIntro({ title, description }: { title: React.ReactNode; description: React.ReactNode }) {
  return (
    <div className="cp-faq-intro">
      <Pill>FAQ</Pill>
      <h2 id="cp-faq-title">{title}</h2>
      <p>{description}</p>
      <Link className="cp-text-link" to="/book-demo">
        Still curious? Book a demo <ArrowRight aria-hidden="true" />
      </Link>
    </div>
  );
}

type FaqSectionProps = {
  entries: readonly FaqEntry[];
  title?: React.ReactNode;
  description?: React.ReactNode;
};

/** Sticky intro on the left, accordion on the right (stacked on mobile). One per page. */
export function FaqSection({
  entries,
  title = "Questions schools ask us",
  description = "What CampusPilot does today, what AI-ready means for your data, and what is coming next.",
}: FaqSectionProps) {
  return (
    <section className="cp-section cp-faq" id="faq" aria-labelledby="cp-faq-title">
      <FaqIntro title={title} description={description} />
      <div className="cp-faq-list">
        {entries.map((entry) => (
          <FaqItem key={entry.question} entry={entry} group="cp-faq" />
        ))}
      </div>
    </section>
  );
}
