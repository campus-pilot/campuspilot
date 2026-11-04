import { ChannelCard } from "@/pages/contact-channels/channel-links";
import { channels } from "@/pages/contact-channels/channels";

/** The three env-driven channels as large cards, WhatsApp first and recommended. */
export function ChannelGrid() {
  return (
    <section className="cp-section pg-contact-channels" id="channels" aria-labelledby="pg-contact-channels-title">
      <div className="pg-contact-channels-head">
        <h2 id="pg-contact-channels-title">Three ways to reach the team</h2>
        <p>WhatsApp and phone are quickest. Email suits longer notes about how your school runs.</p>
      </div>
      <div className="pg-contact-channels-grid">
        <ChannelCard
          channel={channels.whatsapp}
          kicker="Quickest"
          description="Start with a short message. It opens with a note ready to send, so you only need to press send."
          recommended
        />
        <ChannelCard
          channel={channels.phone}
          kicker="Speak directly"
          description="Talk it through in person. Tell us how your school runs today and what you want to improve."
        />
        <ChannelCard
          channel={channels.email}
          kicker="Share the details"
          description="Best for longer notes: your campuses, fee structure, exam pattern and the tools you use today."
        />
      </div>
    </section>
  );
}
