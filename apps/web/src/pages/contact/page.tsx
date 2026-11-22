import { FinalCta } from "@/site/ui/final-cta";

import { AgendaSection } from "./agenda";
import { AssuranceSection } from "./assurances";
import { ChannelGrid } from "./channel-grid";
import { ContactHero } from "./hero";
import { PrepSection } from "./prep";
import { SwitchboardSection } from "./switchboard";

/**
 * `/contact`, the site's only contact page: hero with the contact form →
 * assurances → the three direct channels → "which channel for what"
 * switchboard → demo agenda → prep checklist → final CTA.
 */
export function ContactPage() {
  return (
    <>
      <ContactHero />
      <AssuranceSection />
      <ChannelGrid />
      <SwitchboardSection />
      <AgendaSection />
      <PrepSection />
      <FinalCta
        title="Rather try it yourself?"
        description="Log in to set up your school, or explore what CampusPilot covers first."
        secondary={{ href: "/features", label: "Explore features" }}
      />
    </>
  );
}
