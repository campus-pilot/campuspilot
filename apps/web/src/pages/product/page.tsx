import { Waypoints } from "lucide-react";

import { ConsoleStage, EventStreamSection } from "@/site/signature";
import { ButtonLink, ButtonRow } from "@/site/ui/button";
import { FinalCta } from "@/site/ui/final-cta";
import { PageHero } from "@/site/ui/page-hero";

import { CapabilityIndexSection } from "./capability-index";
import { LifecycleSection } from "./lifecycle";
import { RecordViewsSection } from "./record-views";

function ProductHero() {
  return (
    <PageHero
      eyebrow="The connected school operating system"
      eyebrowIcon={Waypoints}
      title={
        <>
          One platform for every step, <em>from admission to year-end.</em>
        </>
      }
      description="CampusPilot connects admissions, classes, fees, examinations, documents and family access in one system. Each thing is entered once and moves on with its context, to the people allowed to see it."
      actions={
        <ButtonRow>
          <ButtonLink href="/book-demo">Book a demo</ButtonLink>
          <ButtonLink href="#capabilities" tone="light">See every capability</ButtonLink>
        </ButtonRow>
      }
      note="Nursery to Class 12 · Sessions like 2026–27 · Fees in ₹"
      visual={<ConsoleStage />}
    />
  );
}

/**
 * `/product`: hero (console stage) → events in / finished work out →
 * school-year lifecycle rail → one record seen by four roles → capability
 * index with the AI-ready teaser → final CTA.
 */
export function ProductPage() {
  return (
    <>
      <ProductHero />
      <EventStreamSection
        variant="full"
        eyebrow="Repeated work, done once"
        title="Everything comes in. Finished work goes out."
        description="Enquiries, payments, attendance and marks are taken in once, tied to the right student and checked against who may see them. What leaves is finished: receipts, ledgers, report cards and answers."
      />
      <LifecycleSection />
      <RecordViewsSection />
      <CapabilityIndexSection />
      <FinalCta
        title="See your whole school year in one connected system."
        description="A focused walkthrough of your admissions, classes, fee structures and exams, and what AI-ready means for your records."
      />
    </>
  );
}
