import { AgendaSection } from "./agenda";
import { AssuranceSection } from "./assurances";
import { ContactFallback } from "./contact-fallback";
import { BookDemoHero } from "./hero";
import { PrepSection } from "./prep";

/** `/book-demo`: hero with the demo request form → assurances → agenda → prep checklist → contact fallback. */
export function BookDemoPage() {
  return (
    <>
      <BookDemoHero />
      <AssuranceSection />
      <AgendaSection />
      <PrepSection />
      <ContactFallback />
    </>
  );
}
