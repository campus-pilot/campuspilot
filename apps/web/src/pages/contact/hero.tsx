import { MessageSquareText } from "lucide-react";

import { ButtonLink, ButtonRow } from "@/site/ui/button";
import { PageHero } from "@/site/ui/page-hero";
import { DemoRequestCard } from "./demo-request-form";

/** `/contact` hero: the contact form is the page's main action. */
export function ContactHero() {
  return (
    <PageHero
      eyebrow="Contact us"
      eyebrowIcon={MessageSquareText}
      title={
        <>
          Contact us <em>about your school.</em>
        </>
      }
      description="Tell us a little about your school and we'll call or WhatsApp you, whichever you prefer, to set up a 30-minute walkthrough of your sessions, admissions, fees and exams, and show what AI-ready means for your records."
      actions={
        <ButtonRow>
          <ButtonLink href="#agenda" size="lg" tone="light">
            What we'll cover
          </ButtonLink>
        </ButtonRow>
      }
      note="For principals, owners and administrators · Nursery to Class 12 · Single and multi-campus"
      visual={<DemoRequestCard />}
    />
  );
}
