import { CalendarClock, Check, Hourglass, UserRoundCheck, type LucideIcon } from "lucide-react";

import { Section, SectionIntro } from "@/site/ui/section";

import { playOnView, stagger } from "./play-on-view";

type TodayItem = { title: string; text: string };

const todayItems: readonly TodayItem[] = [
  { title: "Ask in plain words", text: "Your team asks the AI assistant they already use about admissions, fees, marks or attendance." },
  { title: "Answers from live records", text: "Answers come from what is in CampusPilot right now, not from a spreadsheet exported last week." },
  { title: "Same permissions as the person asking", text: "A class teacher's assistant sees her classes. An accountant's sees fees. Nobody's sees more than they do." },
  { title: "Access ends with the person", text: "Your records are not copied into a separate AI tool, so when someone's access ends, their assistant's ends too." },
];

type NextItem = { title: string; text: string; reviewer: string };

const nextItems: readonly NextItem[] = [
  { title: "Fee-reminder list", text: "Drafted from overdue ledgers for one class or the whole school.", reviewer: "Accounts approves" },
  { title: "Report cards for approval", text: "Assembled from entered marks, ready for a final check.", reviewer: "Principal signs off" },
  { title: "Admission follow-ups", text: "Enquiries that have gone quiet, each with a suggested next step.", reviewer: "Office decides" },
];

/** "Now ● ── ○ Next" rail above the two lanes; the roadmap half is dashed. Decorative. */
function TimeRail() {
  return (
    <div className="pg-ai-rail" aria-hidden="true">
      <span className="pg-ai-rail-mark" data-lane="today">Now</span>
      <i className="pg-ai-rail-line" />
      <span className="pg-ai-rail-mark" data-lane="next">Next</span>
    </div>
  );
}

function LaneHead({ id, icon: Icon, status, title, text }: { id: string; icon: LucideIcon; status: string; title: string; text: string }) {
  return (
    <header className="pg-ai-lane-head">
      <span className="pg-ai-lane-status"><Icon aria-hidden="true" />{status}</span>
      <h3 id={id}>{title}</h3>
      <p>{text}</p>
    </header>
  );
}

function TodayLane() {
  return (
    <article className="pg-ai-lane" data-lane="today" aria-labelledby="pg-ai-today-title">
      <LaneHead id="pg-ai-today-title" icon={Check} status="Available today" title="Your assistants, inside your rules" text="The AI assistants your team already uses can work with CampusPilot records." />
      <ul className="pg-ai-today-list">
        {todayItems.map((item, index) => (
          <li key={item.title} style={stagger(index)}>
            <Check aria-hidden="true" />
            <p><b>{item.title}</b> {item.text}</p>
          </li>
        ))}
      </ul>
    </article>
  );
}

function NextCard({ item, index }: { item: NextItem; index: number }) {
  return (
    <li className="pg-ai-next-card" style={stagger(index)}>
      <b>{item.title}</b>
      <p>{item.text}</p>
      <span className="pg-ai-next-review"><Hourglass aria-hidden="true" />Draft · {item.reviewer}</span>
    </li>
  );
}

function NextLane() {
  return (
    <article className="pg-ai-lane" data-lane="next" aria-labelledby="pg-ai-next-title">
      <LaneHead id="pg-ai-next-title" icon={CalendarClock} status="Coming · on the roadmap" title="AI that prepares work for review" text="Agentic AI inside the CampusPilot web app that gets the routine work ready, then waits for a person." />
      <ul className="pg-ai-next-list">
        {nextItems.map((item, index) => <NextCard key={item.title} item={item} index={index} />)}
      </ul>
      <p className="pg-ai-next-foot"><UserRoundCheck aria-hidden="true" />A person stays in the loop. Nothing is sent without approval.</p>
    </article>
  );
}

/**
 * Honest split between what ships today (solid lane) and what is on the
 * roadmap (dashed lane, "Coming" status, every item a draft awaiting a named
 * reviewer). Lanes rise in once on view (`playOnView`).
 */
export function TodayNextSection() {
  return (
    <Section id="today-and-next" labelledBy="pg-ai-today-next-title" className="pg-ai-today-next">
      <SectionIntro
        id="pg-ai-today-next-title"
        eyebrow="Today and next"
        eyebrowIcon={CalendarClock}
        title="What works today, and what is on the roadmap."
        description="We keep the two apart on purpose. One is ready for your school now; the other is being built, and we will say so until it ships."
      />
      <TimeRail />
      <div className="pg-ai-lanes" ref={playOnView}>
        <TodayLane />
        <NextLane />
      </div>
    </Section>
  );
}
