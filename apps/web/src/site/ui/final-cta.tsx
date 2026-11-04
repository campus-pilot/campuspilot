import { ButtonLink, ButtonRow } from "./button";

type FinalCtaProps = {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /**
   * Secondary action next to "Book a demo". Defaults to "Talk to us" → `/contact`;
   * pass another link (e.g. on `/contact` itself) or `null` to show only the primary button.
   */
  secondary?: { href: string; label: string } | null;
};

/** Closing call to action placed as the last section of a page, right above the footer. */
export function FinalCta({
  title = "See CampusPilot with your school in mind.",
  description = "A focused walkthrough of your sessions, classes, fee structures and exams — and what AI-ready means for your records.",
  secondary = { href: "/contact", label: "Talk to us" },
}: FinalCtaProps) {
  return (
    <section className="cp-final-cta" aria-labelledby="cp-final-cta-title">
      <h2 id="cp-final-cta-title">{title}</h2>
      <p>{description}</p>
      <ButtonRow center>
        <ButtonLink href="/book-demo" size="lg">Book a demo</ButtonLink>
        {secondary ? (
          <ButtonLink href={secondary.href} size="lg" tone="light">{secondary.label}</ButtonLink>
        ) : null}
      </ButtonRow>
    </section>
  );
}
