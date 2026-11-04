import { MessagesSquare } from "lucide-react";

import { FinalCta } from "@/site/ui/final-cta";
import { PageHero } from "@/site/ui/page-hero";

import { ChannelGrid } from "./channel-grid";
import { SwitchboardSection } from "./switchboard";

function ContactHero() {
  return (
    <PageHero
      eyebrow="Talk to CampusPilot"
      eyebrowIcon={MessagesSquare}
      title={
        <>
          Reach us the way <em>you already work.</em>
        </>
      }
      description="Questions about your school's setup, a demo, or what AI-ready means for your records? Message, call or email, and we'll take it from there."
      note="Nursery to Class 12 · Single campus or a group of schools · Fees in ₹"
    />
  );
}

/** `/contact`: hero → channel cards → "which channel for what" switchboard → final CTA. */
export function ContactPage() {
  return (
    <>
      <ContactHero />
      <ChannelGrid />
      <SwitchboardSection />
      <FinalCta
        title="Prefer to see it first?"
        description="Book a focused walkthrough of your sessions, classes, fee structures and exams, and what AI-ready means for your records."
        secondary={{ href: "/features", label: "Explore features" }}
      />
    </>
  );
}
