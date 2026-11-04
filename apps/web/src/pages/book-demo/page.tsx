import { AgendaSection } from "./agenda";
import { ContactFallback } from "./contact-fallback";
import { BookDemoHero } from "./hero";
import { PrepSection } from "./prep";
import { SchedulerSection } from "./scheduler";

/** `/book-demo`: hero with fast channels → scheduler → agenda → prep checklist → contact fallback. */
export function BookDemoPage() {
  return (
    <>
      <BookDemoHero />
      <SchedulerSection />
      <AgendaSection />
      <PrepSection />
      <ContactFallback />
    </>
  );
}
