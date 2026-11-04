import { Sparkles } from "lucide-react";

import { AiArt } from "@/site/signature";
import { ButtonLink, ButtonRow } from "@/site/ui/button";
import { FaqSection } from "@/site/ui/faq";
import { FinalCta } from "@/site/ui/final-cta";
import { PageHero } from "@/site/ui/page-hero";

import { AnswerPathSection } from "./answer-path";
import { aiFaqEntries } from "./faq-data";
import { ReachSection } from "./reach";
import { TodayNextSection } from "./today-next";
import { TrustBand } from "./trust-band";

function AiReadyHero() {
  return (
    <PageHero
      eyebrow="AI-ready school management"
      eyebrowIcon={Sparkles}
      title={
        <>
          Your school records, <em>ready for AI.</em>
        </>
      }
      description="Today, the AI assistants your team already uses can answer from your live CampusPilot records, with the same permissions as the person asking. Next, AI inside CampusPilot will prepare routine work for a person to approve."
      actions={
        <ButtonRow>
          <ButtonLink href="/book-demo">Book a demo</ButtonLink>
          <ButtonLink href="#reach" tone="light">See who reaches what</ButtonLink>
        </ButtonRow>
      }
      note="Today: answers within each person's access · On the roadmap: prepared work, approved by a person"
      visual={
        <AiArt label="Illustration: a class teacher's assistant answers which Science marks are pending in her class, declines a question about whole-school fee dues as outside her access, and below it a fee-reminder list prepared for review is marked as roadmap." />
      }
    />
  );
}

/**
 * `/ai-ready`: hero → permission-aware network (centrepiece) → today vs.
 * roadmap → how a question is answered → trust band → FAQ → final CTA.
 */
export function AiReadyPage() {
  return (
    <>
      <AiReadyHero />
      <ReachSection />
      <TodayNextSection />
      <AnswerPathSection />
      <TrustBand />
      <FaqSection
        entries={aiFaqEntries}
        title="Questions about AI and your records"
        description="What AI-ready means for your school today, what stays protected, and what is still on the roadmap."
      />
      <FinalCta
        title="See what AI-ready means for your school."
        description="We will walk through your roles and classes, ask real questions as different people, and show what is on the roadmap."
        secondary={{ href: "/security", label: "How security works" }}
      />
    </>
  );
}
