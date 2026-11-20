import { NotebookSection } from "@/site/signature";
import { FaqSection } from "@/site/ui/faq";
import { FinalCta } from "@/site/ui/final-cta";

import { AiSection } from "./ai-section";
import { homeFaqs } from "./faq-data";
import { Hero } from "./hero";
import { StepsSection } from "./steps";
import { WorkflowsSection } from "./workflows";

/**
 * The handwritten notebook recaps both core messages after how it works.
 * Its roadmap page is hidden: everything on the home page ships today.
 */
function DoneOnceNotebook() {
  return (
    <NotebookSection
      hideRoadmap
      title="The busywork, done once. Your school, ready for questions."
      description="Five chores crossed off the list for good, and two questions put to the school: one answered, one politely refused."
    />
  );
}

/**
 * Home: hero → workflows (tabs) → AI-ready (voice, chat, your own assistant)
 * → how it works (steps) → notebook → FAQ → final CTA. Section ids:
 * `workflows`, `ai`, `how-it-works`, `done-once`, `faq`.
 */
export function HomePage() {
  return (
    <>
      <Hero />
      <WorkflowsSection />
      <AiSection />
      <StepsSection />
      <DoneOnceNotebook />
      <FaqSection entries={homeFaqs} />
      <FinalCta />
    </>
  );
}
