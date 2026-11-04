import { ArrowRight, BookOpen, Compass, MessageSquarePlus, PenLine } from "lucide-react";
import { Link } from "react-router";

import { ButtonLink, ButtonRow } from "@/site/ui/button";
import { FinalCta } from "@/site/ui/final-cta";
import { PageHero } from "@/site/ui/page-hero";
import { Section, SectionIntro } from "@/site/ui/section";

const guides: readonly [string, string, readonly string[]][] = [
  ["Getting started", "Set up your school once", ["Your school and session", "Classes, sections and subjects", "Inviting your staff"]],
  ["Admissions", "Enquiry to student record", ["Enquiries and registrations", "Class allocation", "Student records"]],
  ["Fees", "From structure to receipt", ["Fee structures and instalments", "Billing runs and receipts", "Discounts, waivers and ledgers"]],
  ["Exams", "Plans, marks and report cards", ["Exam plans and timetables", "Marks entry and approvals", "Report cards and admit cards"]],
  ["Documents", "Branded outputs from live records", ["School templates", "Generating from records", "Document history"]],
  ["Permissions", "Who sees what", ["Roles and access", "Campus and classroom scopes", "Multi-campus groups"]],
  ["AI assistants", "Working with your records", ["Connecting the assistants you use", "Same permissions as the person asking", "What's on the roadmap"]],
];

/**
 * One upcoming guide, drawn as a booklet with a numbered tab. Every guide is
 * honestly marked "In writing": nothing here links to unpublished content.
 */
function GuideCard({ number, title, summary, topics }: { number: string; title: string; summary: string; topics: readonly string[] }) {
  return (
    <li className="pg-util-guide" style={{ "--pg-i": Number(number) - 1 } as React.CSSProperties}>
      <span className="pg-util-guide-tab">Guide {number}</span>
      <h3>{title}</h3>
      <p>{summary}</p>
      <ul>
        {topics.map((topic) => (
          <li key={topic}>{topic}</li>
        ))}
      </ul>
      <span className="pg-util-guide-status">
        <PenLine aria-hidden="true" /> In writing
      </span>
    </li>
  );
}

/** Fills the shelf's last slot: invites schools to say which guide they need first. */
function GuideRequest() {
  return (
    <li>
      <Link className="pg-util-guide-request" to="/contact">
        <MessageSquarePlus aria-hidden="true" />
        <b>Which guide do you need first?</b>
        <span>Tell us. It helps us decide what to write next.</span>
      </Link>
    </li>
  );
}

function GuideShelf() {
  return (
    <Section id="guides" labelledBy="pg-util-guides-title">
      <SectionIntro
        id="pg-util-guides-title"
        eyebrow="What's coming"
        eyebrowIcon={BookOpen}
        title="Seven guides, written for school teams."
        description="Practical, step-by-step and in plain language, from the first session setup to the AI assistants your team already uses."
      />
      <ul className="pg-util-guides">
        {guides.map(([title, summary, topics], index) => (
          <GuideCard key={title} number={String(index + 1).padStart(2, "0")} title={title} summary={summary} topics={topics} />
        ))}
        <GuideRequest />
      </ul>
    </Section>
  );
}

const paths: readonly [string, string, string][] = [
  ["/features", "Explore every feature", "Admissions, academics, fees, exams, documents and dashboards."],
  ["/ai-ready", "See what AI-ready means", "How assistants work with your records, within each person's access."],
  ["/contact", "Ask us directly", "WhatsApp, call or email with any question about your setup."],
  ["/book-demo", "Book a walkthrough", "30 minutes, built around your school."],
];

function PathLink({ href, title, text }: { href: string; title: string; text: string }) {
  return (
    <li>
      <Link className="pg-util-path" to={href}>
        <b>{title}</b>
        <span>{text}</span>
        <ArrowRight aria-hidden="true" />
      </Link>
    </li>
  );
}

function UntilThen() {
  return (
    <Section id="until-then" labelledBy="pg-util-until-title" className="pg-util-until">
      <SectionIntro id="pg-util-until-title" eyebrow="Until then" eyebrowIcon={Compass} title="Good places to start today." />
      <ul className="pg-util-paths">
        {paths.map(([href, title, text]) => (
          <PathLink key={href} href={href} title={title} text={text} />
        ))}
      </ul>
    </Section>
  );
}

/** `/documentation`: coming-soon hero → upcoming guides → where to go meanwhile → final CTA. */
export function DocumentationPage() {
  return (
    <>
      <PageHero
        eyebrow="Documentation · coming soon"
        eyebrowIcon={BookOpen}
        title={
          <>
            Guides are on the way. <em>Here's what's coming.</em>
          </>
        }
        description="We're writing practical guides for principals, office staff, accountants and teachers. Until they're ready, we'll happily walk you through anything directly."
        actions={
          <ButtonRow>
            <ButtonLink href="/book-demo" size="lg">
              Book a demo
            </ButtonLink>
            <ButtonLink href="/features" size="lg" tone="light">
              Explore features
            </ButtonLink>
          </ButtonRow>
        }
      />
      <GuideShelf />
      <UntilThen />
      <FinalCta />
    </>
  );
}
