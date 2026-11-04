import { ButtonLink, ButtonRow } from "@/site/ui/button";
import { channels } from "@/pages/contact-channels/channels";

/**
 * Closing band for `/book-demo`. A "Book a demo" final CTA would point back at
 * this very page, so it offers the direct channels instead, styled like the
 * shared final CTA.
 */
export function ContactFallback() {
  return (
    <section className="cp-final-cta pg-book-fallback" aria-labelledby="pg-book-fallback-title">
      <h2 id="pg-book-fallback-title">Rather talk it through first?</h2>
      <p>No slot that works, or a quick question before you book? Message, call or email us, whichever is easiest.</p>
      <ButtonRow center>
        <ButtonLink href={channels.whatsapp.href} size="lg" external>
          Message on WhatsApp
        </ButtonLink>
        <ButtonLink href={channels.phone.href} size="lg" tone="light">
          Call {channels.phone.value}
        </ButtonLink>
        <ButtonLink href={channels.email.href} size="lg" tone="light">
          Email us
        </ButtonLink>
      </ButtonRow>
    </section>
  );
}
