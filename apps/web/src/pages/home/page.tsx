import { NotebookSection } from "@/site/signature";
import { FaqSection } from "@/site/ui/faq";
import { FinalCta } from "@/site/ui/final-cta";

import { AiSection } from "./ai-section";
import { homeFaqs } from "./faq-data";
import { Hero } from "./hero";
import { StepsSection } from "./steps";
import { TeamsBand } from "./teams-band";
import { WorkflowsSection } from "./workflows";

/**
 * The handwritten notebook recaps both core messages after the AI section.
 * Its roadmap page is hidden: the home page names the roadmap once, in `AiSection`.
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
 * Home: hero → workflows (tabs) → how it works (steps) → AI with permissions
 * intact → notebook → teams → FAQ → final CTA. Section ids: `workflows`,
 * `how-it-works`, `ai`, `done-once`, `teams`, `faq`.
 */
export function HomePage() {
  return (
    <>
      <Hero />
      <WorkflowsSection />
      <StepsSection />
      <AiSection />
      <DoneOnceNotebook />
      <TeamsBand />
      <FaqSection entries={homeFaqs} />
      <FinalCta />
    </>
  );
}
