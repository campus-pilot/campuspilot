import { CalendarDays, CheckCheck } from "lucide-react";

import { ButtonLink, ButtonRow } from "@/site/ui/button";
import { PageHero } from "@/site/ui/page-hero";
import { ChannelRow } from "@/pages/contact-channels/channel-links";
import { WHATSAPP_MESSAGE, channels } from "@/pages/contact-channels/channels";

/**
 * Preview of the message WhatsApp opens with, so a principal knows exactly what
 * will be sent before tapping. The text is the same constant the link encodes.
 */
function WhatsAppPreview() {
  return (
    <figure className="pg-book-bubble">
      <figcaption>WhatsApp opens with this message ready to send</figcaption>
      <blockquote>
        <p>{WHATSAPP_MESSAGE}</p>
      </blockquote>
      <span className="pg-book-bubble-ticks" aria-hidden="true">
        <CheckCheck />
      </span>
    </figure>
  );
}

function FastChannelsHead() {
  return (
    <div className="pg-book-fast-head">
      <h2 id="pg-book-fast-title">Rather not wait for a slot?</h2>
      <p>Reach the team directly, whichever is easiest for you.</p>
    </div>
  );
}

/** Hero visual: the faster channels, with WhatsApp recommended and previewed. */
function FastChannels() {
  return (
    <aside className="pg-book-fast" aria-labelledby="pg-book-fast-title">
      <FastChannelsHead />
      <WhatsAppPreview />
      <div className="pg-book-fast-list">
        <ChannelRow channel={channels.whatsapp} recommended />
        <ChannelRow channel={channels.phone} />
        <ChannelRow channel={channels.email} />
      </div>
    </aside>
  );
}

export function BookDemoHero() {
  return (
    <PageHero
      eyebrow="Book a demo"
      eyebrowIcon={CalendarDays}
      title={
        <>
          Book a demo <em>built around your school.</em>
        </>
      }
      description="Pick a 30-minute slot that suits your school day. We'll walk through your sessions, admissions, fees and exams the way you run them, and show what AI-ready means for your records."
      actions={
        <ButtonRow>
          <ButtonLink href="#schedule" size="lg">
            Pick a time
          </ButtonLink>
          <ButtonLink href="#agenda" size="lg" tone="light">
            What we'll cover
          </ButtonLink>
        </ButtonRow>
      }
      note="For principals, owners and administrators · Nursery to Class 12 · Single and multi-campus"
      visual={<FastChannels />}
    />
  );
}
