import { LayoutGrid } from "lucide-react";

import { ButtonLink, ButtonRow } from "@/site/ui/button";
import { FinalCta } from "@/site/ui/final-cta";
import { PageHero } from "@/site/ui/page-hero";

import { ConnectStrip } from "./connect-strip";
import { FeatureMapSection } from "./feature-map";

function FeaturesHero() {
  return (
    <PageHero
      eyebrow="Features"
      eyebrowIcon={LayoutGrid}
      title={
        <>
          One platform. <em>Every essential workflow.</em>
        </>
      }
      description="CampusPilot connects a school's working year, from the first admission enquiry to class placement, fees, examinations, results and documents. Each detail is entered once and flows on."
      actions={
        <ButtonRow>
          <ButtonLink href="/book-demo">Book a demo</ButtonLink>
          <ButtonLink href="#connect" tone="light">See how they connect</ButtonLink>
        </ButtonRow>
      }
      note="Nursery to Class 12 · Single campus or a group of schools · Fees in ₹"
    />
  );
}

/** `/features`: hero → feature map (list + live preview) → "how the features connect" chain → final CTA. */
export function FeaturesIndexPage() {
  return (
    <>
      <FeaturesHero />
      <FeatureMapSection />
      <ConnectStrip />
      <FinalCta
        title="See every workflow with your school in mind."
        description="A focused walkthrough of your sessions, classes, fee structures and exams, and what AI-ready means for your records."
      />
    </>
  );
}
