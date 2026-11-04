import { ShieldCheck } from "lucide-react";

import { ButtonLink, ButtonRow } from "@/site/ui/button";
import { FinalCta } from "@/site/ui/final-cta";
import { PageHero } from "@/site/ui/page-hero";

import { AiBand } from "./ai-band";
import { BoundaryRingsSection } from "./boundary-rings";
import { PrinciplesSection } from "./principles";
import { WhoSeesWhatSection } from "./who-sees-what";

function SecurityHero() {
  return (
    <PageHero
      eyebrow="Security and access"
      eyebrowIcon={ShieldCheck}
      title={
        <>
          The right access for every <em>campus, role, class and section.</em>
        </>
      }
      description="CampusPilot is designed around boundaries. Each school is kept apart, access follows the job, teachers work within their assigned classes, and families see only their own child."
      actions={
        <ButtonRow>
          <ButtonLink href="/book-demo">Book a demo</ButtonLink>
          <ButtonLink href="#boundaries" tone="light">Explore the boundaries</ButtonLink>
        </ButtonRow>
      }
      note="Designed around boundaries from the start, not added later"
    />
  );
}

/**
 * `/security`: hero → boundary rings (interactive) → principles register →
 * illustrative "who sees what" matrix → link band to `/ai-ready` → final CTA.
 */
export function SecurityPage() {
  return (
    <>
      <SecurityHero />
      <BoundaryRingsSection />
      <PrinciplesSection />
      <WhoSeesWhatSection />
      <AiBand />
      <FinalCta
        title="Walk through access with your own roles."
        description="Bring your campuses, roles and class assignments. We will show who sees what, and how it stays that way."
        secondary={{ href: "/ai-ready", label: "AI-ready" }}
      />
    </>
  );
}
