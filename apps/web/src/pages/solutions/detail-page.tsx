import { ArrowRight, ArrowUpRight, Check, Compass, LayoutGrid, Route as RouteIcon, Sparkles, Target } from "lucide-react";
import { Link } from "react-router";

import { featureDirectory, solutionData, solutionDirectory, type DetailData, type SolutionSlug } from "@/site/content/catalog";
import { NotebookSection } from "@/site/signature";
import { ButtonLink, ButtonRow } from "@/site/ui/button";
import { FinalCta } from "@/site/ui/final-cta";
import { PageHero } from "@/site/ui/page-hero";
import { Section, SectionIntro } from "@/site/ui/section";

import { roleVisual } from "./role-visual";
import { roleContent, type RoleContent } from "./roles";

/* ───────────── Hero ───────────── */

function SolutionHero({ slug, data, role }: { slug: SolutionSlug; data: DetailData; role: RoleContent }) {
  const Visual = roleVisual[slug];
  return (
    <PageHero
      eyebrow={data.eyebrow}
      eyebrowIcon={Compass}
      title={<>{data.title} <em>{data.accent}</em></>}
      description={data.description}
      actions={
        <ButtonRow>
          <ButtonLink href="/book-demo">Book a demo</ButtonLink>
          <ButtonLink href="/solutions" tone="light">All solutions</ButtonLink>
        </ButtonRow>
      }
      visual={<Visual />}
      note={role.heroNote}
    />
  );
}

/* ───────────── Outcomes ───────────── */

function OutcomeItem({ outcome, index }: { outcome: DetailData["outcomes"][number]; index: number }) {
  return (
    <li className="pg-sol-outcome">
      <span className="pg-sol-outcome-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
      <h3>{outcome.title}</h3>
      <p>{outcome.text}</p>
    </li>
  );
}

/** Three outcomes as a ruled, numbered row (stacked on phones). */
function OutcomesSection({ data, role }: { data: DetailData; role: RoleContent }) {
  return (
    <Section id="outcomes" labelledBy="outcomes-title">
      <SectionIntro id="outcomes-title" eyebrow="What changes" eyebrowIcon={Target} title={`What changes for ${role.audience}`} />
      <ol className="pg-sol-outcomes">
        {data.outcomes.map((outcome, index) => <OutcomeItem key={outcome.title} outcome={outcome} index={index} />)}
      </ol>
    </Section>
  );
}

/* ───────────── Workflow, spotlight and bullets ───────────── */

function StepRail({ steps }: { steps: readonly string[] }) {
  return (
    <ol className="pg-sol-steps" aria-label="Workflow in four steps">
      {steps.map((step, index) => (
        <li key={step} style={{ "--i": index } as React.CSSProperties}>
          <span className="pg-sol-step-dot" aria-hidden="true">{index + 1}</span>
          <b>{step}</b>
        </li>
      ))}
    </ol>
  );
}

function SpotlightCard({ data }: { data: DetailData }) {
  return (
    <div className="pg-sol-spotlight">
      <p className="pg-sol-spotlight-kicker"><Sparkles aria-hidden="true" />In practice</p>
      <h3>{data.spotlightTitle}</h3>
      <p>{data.spotlightText}</p>
    </div>
  );
}

function BulletList({ bullets }: { bullets: readonly string[] }) {
  return (
    <div className="pg-sol-included">
      <h3>What this view includes</h3>
      <ul>
        {bullets.map((bullet) => <li key={bullet}><Check aria-hidden="true" />{bullet}</li>)}
      </ul>
    </div>
  );
}

/** The four-step workflow as a connected rail, then the spotlight and the included bullets side by side. */
function WorkflowSection({ data }: { data: DetailData }) {
  return (
    <Section id="workflow" labelledBy="workflow-title">
      <SectionIntro
        id="workflow-title"
        eyebrow="How the work flows"
        eyebrowIcon={RouteIcon}
        title="Four steps, each one entered once."
        description="Every step hands its record to the next, so nothing is copied between registers along the way."
      />
      <StepRail steps={data.steps} />
      <div className="pg-sol-workflow-detail">
        <SpotlightCard data={data} />
        <BulletList bullets={data.bullets} />
      </div>
    </Section>
  );
}

/* ───────────── Features used most, other roles ───────────── */

function FeatureLink({ entry }: { entry: (typeof featureDirectory)[number] }) {
  const Icon = entry.icon;
  return (
    <li>
      <Link className="pg-sol-feature" to={entry.href}>
        <span className="pg-sol-feature-icon"><Icon aria-hidden="true" /></span>
        <b>{entry.title}</b>
        <small>{entry.text}</small>
        <ArrowUpRight className="pg-sol-feature-arrow" aria-hidden="true" />
      </Link>
    </li>
  );
}

function OtherRoles({ slug }: { slug: SolutionSlug }) {
  const others = solutionDirectory.filter((entry) => entry.href !== `/solutions/${slug}`);
  return (
    <nav className="pg-sol-others" aria-label="Other solutions">
      <p>Also see</p>
      <ul>
        {others.map((entry) => (
          <li key={entry.href}><Link to={entry.href}>{entry.title}<ArrowRight aria-hidden="true" /></Link></li>
        ))}
      </ul>
    </nav>
  );
}

function FeaturesSection({ slug, role }: { slug: SolutionSlug; role: RoleContent }) {
  const features = role.featureHrefs.flatMap((href) => featureDirectory.filter((entry) => entry.href === href));
  return (
    <Section id="features-used" labelledBy="features-used-title">
      <SectionIntro id="features-used-title" eyebrow="Features" eyebrowIcon={LayoutGrid} title={`Features ${role.audience} use most`} />
      <ul className="pg-sol-features">
        {features.map((entry) => <FeatureLink key={entry.href} entry={entry} />)}
      </ul>
      <OtherRoles slug={slug} />
    </Section>
  );
}

/* ───────────── Page ───────────── */

/**
 * `/solutions/:slug`: one template for all seven roles. Shared facts come from
 * `solutionData`; the hero console, notebook, feature picks and closing copy
 * are role-specific (`roleVisual`, `roleContent`).
 */
export function SolutionDetailPage({ slug }: { slug: SolutionSlug }) {
  const data = solutionData[slug];
  const role = roleContent[slug];
  return (
    <div className="pg-sol">
      <SolutionHero slug={slug} data={data} role={role} />
      <OutcomesSection data={data} role={role} />
      <NotebookSection title={role.notebook.title} description={role.notebook.description} {...role.notebook.book} />
      <WorkflowSection data={data} />
      <FeaturesSection slug={slug} role={role} />
      <FinalCta title={role.cta.title} description={role.cta.description} />
    </div>
  );
}
