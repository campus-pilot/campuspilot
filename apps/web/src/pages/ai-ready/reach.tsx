import { MessageSquareText, Waypoints } from "lucide-react";

import { DotsNetwork } from "@/site/signature";
import { Section, SectionIntro } from "@/site/ui/section";

/** The one question every role asks in this section, so only the reach changes. */
function SharedQuestion() {
  return (
    <p className="pg-ai-question">
      <MessageSquareText aria-hidden="true" />
      <span>Everyone asks the same thing:</span>
      <q>What needs my attention this week?</q>
    </p>
  );
}

/**
 * Centrepiece of `/ai-ready`: the signature AI network (assistant hub plus
 * school record areas) with its own "Ask as" role dropdown. Framed as "same question,
 * different person, different reach" so the role switch reads as the point.
 */
export function ReachSection() {
  return (
    <Section id="reach" labelledBy="pg-ai-reach-title" className="pg-ai-reach">
      <SectionIntro
        id="pg-ai-reach-title"
        eyebrow="Permission-aware by design"
        eyebrowIcon={Waypoints}
        title="Same question, different person, different reach."
        description="The assistant in the middle is the same for everyone. What it can reach depends entirely on who is asking. Switch the person and watch the record areas light up or lock."
      />
      <SharedQuestion />
      <DotsNetwork
        mode="ai"
        initialRole="class-teacher"
        label="School record areas the assistant can reach for the selected person"
      />
    </Section>
  );
}
