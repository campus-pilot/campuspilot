import { Sparkles } from "lucide-react";

import { AiArt } from "@/site/signature";
import { LoginCta } from "@/site/shell/login-dialog";
import { ButtonLink, ButtonRow } from "@/site/ui/button";
import { FaqSection } from "@/site/ui/faq";
import { FinalCta } from "@/site/ui/final-cta";
import { PageHero } from "@/site/ui/page-hero";

import { AnswerPathSection } from "./answer-path";
import { aiFaqEntries } from "./faq-data";
import { ReachSection } from "./reach";
import { TrustBand } from "./trust-band";
import { WaysToAskSection } from "./ways-to-ask";

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
      description="Talk to the assistant built into CampusPilot from any page, type to it, or connect the AI assistant your team already uses. Every answer comes from your live records, with the same permissions as the person asking, and the built-in assistant asks before it changes anything."
      actions={
        <ButtonRow>
          <LoginCta />
          <ButtonLink href="#reach" tone="light">See who reaches what</ButtonLink>
        </ButtonRow>
      }
      note="Voice and chat inside the app · Your own assistant, connected · Answers within each person's access"
      visual={
        <AiArt label="Illustration: a class teacher's assistant answers which Science marks are pending in her class, declines a question about whole-school fee dues as outside her access, and below it a fee payment asked for by voice waits for approval." />
      }
    />
  );
}

/**
 * `/ai-ready`: hero → permission-aware network (centrepiece) → ways to ask
 * (voice and chat inside the app, your own assistant) → how a question is
 * answered → trust band → FAQ → final CTA.
 */
export function AiReadyPage() {
  return (
    <>
      <AiReadyHero />
      <ReachSection />
      <WaysToAskSection />
      <AnswerPathSection />
      <TrustBand />
      <FaqSection
        entries={aiFaqEntries}
        title="Questions about AI and your records"
        description="What AI-ready means for your school, how the built-in assistant works, and what stays protected."
      />
      <FinalCta
        title="See what AI-ready means for your school."
        description="We will walk through your roles and classes, and ask real questions as different people, by voice and in chat."
        secondary={{ href: "/security", label: "How security works" }}
      />
    </>
  );
}
