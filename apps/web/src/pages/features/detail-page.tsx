import { featureData, type FeatureSlug } from "@/site/content/catalog";
import { featureArt } from "@/site/signature";
import { ButtonLink, ButtonRow } from "@/site/ui/button";
import { FaqSection } from "@/site/ui/faq";
import { FinalCta } from "@/site/ui/final-cta";
import { PageHero } from "@/site/ui/page-hero";

import { featureExtras } from "./feature-extras";
import { FlowsNext } from "./flows-next";
import { OutcomesSection } from "./outcomes";
import { SpotlightBand } from "./spotlight";
import { WorkflowStrip } from "./workflow-strip";

function FeatureHero({ slug }: { slug: FeatureSlug }) {
  const data = featureData[slug];
  const extra = featureExtras[slug];
  const Art = featureArt[slug];
  return (
    <PageHero
      eyebrow={data.eyebrow}
      eyebrowIcon={extra.icon}
      title={
        <>
          {data.title} <em>{data.accent}</em>
        </>
      }
      description={data.description}
      actions={
        <ButtonRow>
          <ButtonLink href="/book-demo">Book a demo</ButtonLink>
          <ButtonLink href="/features" tone="light">All features</ButtonLink>
        </ButtonRow>
      }
      visual={<Art label={extra.artLabel} />}
    />
  );
}

/**
 * `/features/:slug`: hero → outcomes → four-step workflow → spotlight →
 * what flows next (+ AI-ready) → FAQ → final CTA. One template for all seven
 * features; the spotlight illustration, its side and the copy vary per slug.
 */
export function FeatureDetailPage({ slug }: { slug: FeatureSlug }) {
  const data = featureData[slug];
  const extra = featureExtras[slug];
  return (
    <>
      <FeatureHero slug={slug} />
      <OutcomesSection outcomes={data.outcomes} name={extra.name} />
      <WorkflowStrip steps={data.steps} notes={extra.stepNotes} />
      <SpotlightBand slug={slug} data={data} />
      <FlowsNext extra={extra} />
      <FaqSection
        entries={extra.faq}
        title={`${extra.name} questions`}
        description="Straight answers about what CampusPilot does today."
      />
      <FinalCta title={extra.ctaTitle} secondary={{ href: "/features", label: "Explore all features" }} />
    </>
  );
}
