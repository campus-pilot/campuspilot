import { Link } from "react-router";

import { PageHero } from "@/site/ui/page-hero";
import { Section } from "@/site/ui/section";

import type { LegalBlock, LegalDocument, LegalSection } from "./legal-content";

function Block({ block }: { block: LegalBlock }) {
  if (block.kind === "p") return <p>{block.text}</p>;
  return (
    <ul>
      {block.items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function SectionBody({ section, number }: { section: LegalSection; number: number }) {
  const headingId = `pg-legal-${section.id}-title`;
  return (
    <section id={section.id} aria-labelledby={headingId} className="pg-legal-section">
      <h2 id={headingId}>
        <span aria-hidden="true">{number}.</span> {section.title}
      </h2>
      {section.blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </section>
  );
}

function TableOfContents({ sections }: { sections: readonly LegalSection[] }) {
  return (
    <nav className="pg-legal-toc" aria-label="On this page">
      <p>On this page</p>
      <ol>
        {sections.map((section) => (
          <li key={section.id}>
            <a href={`#${section.id}`}>{section.title}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function OtherDocumentLink({ to, label }: { to: string; label: string }) {
  return (
    <p className="pg-legal-other">
      Also read our <Link to={to}>{label}</Link>.
    </p>
  );
}

/** Shared layout for `/privacy` and `/terms`: hero, sticky contents list and numbered sections. */
export function LegalPage({ document, other }: { document: LegalDocument; other: { to: string; label: string } }) {
  return (
    <>
      <PageHero
        eyebrow={`Last updated ${document.updated}`}
        title={document.title}
        description={document.intro}
      />
      <Section id="document" labelledBy="cp-page-title" className="pg-legal">
        <div className="pg-legal-layout">
          <TableOfContents sections={document.sections} />
          <div className="pg-legal-body">
            {document.sections.map((section, index) => (
              <SectionBody key={section.id} section={section} number={index + 1} />
            ))}
            <OtherDocumentLink {...other} />
          </div>
        </div>
      </Section>
    </>
  );
}
