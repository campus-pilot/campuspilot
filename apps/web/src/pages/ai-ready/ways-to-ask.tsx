import { Cable, Check, Mic, MessagesSquare, UserRoundCheck, type LucideIcon } from "lucide-react";

import { AssistantMark } from "@/site/signature";
import { Section, SectionIntro } from "@/site/ui/section";

import { playOnView, stagger } from "./play-on-view";

type WayItem = { title: string; text: string };

const insideItems: readonly WayItem[] = [
  { title: "Talk while you work", text: "Start voice from the top bar and just speak. It stays with you as you move between pages and can read the screen in front of you." },
  { title: "Type, attach, get things back", text: "Ask in ⌘K or on the Assistant page, attach photos or PDFs, and get tables, results, report cards and other documents back." },
  { title: "Changes wait for you", text: "Recording a payment, publishing a notice or editing a record waits on screen until you approve it." },
  { title: "Question papers from a photo", text: "A teacher uploads a handwritten paper or describes it in chat. AI drafts it, the teacher refines it, and it prints on the school's letterhead." },
];

const yoursItems: readonly WayItem[] = [
  { title: "Ask in plain words", text: "Your team asks the AI assistant they already use about admissions, fees, marks or notices." },
  { title: "Answers from live records", text: "Answers come from what is in CampusPilot right now, not from a spreadsheet exported last week." },
  { title: "Same permissions as the person asking", text: "A class teacher's assistant sees her classes. An accountant's sees fees. Nobody's sees more than they do." },
  { title: "Access ends with the person", text: "Your records are not copied into a separate AI tool, so when someone's access ends, their assistant's ends too." },
];

/** The voice bar as staff see it in the app, drawn small above the in-app lane. Decorative. */
function VoiceBar() {
  return (
    <p className="pg-ai-voice-bar" aria-hidden="true">
      <AssistantMark speaking className="pg-ai-voice-mark" />
      <span>Listening…</span>
      <span className="pg-ai-voice-wave"><i /><i /><i /><i /></span>
    </p>
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

function WayList({ items }: { items: readonly WayItem[] }) {
  return (
    <ul className="pg-ai-way-list">
      {items.map((item, index) => (
        <li key={item.title} style={stagger(index)}>
          <Check aria-hidden="true" />
          <p><b>{item.title}</b> {item.text}</p>
        </li>
      ))}
    </ul>
  );
}

function InsideLane() {
  return (
    <article className="pg-ai-lane" aria-labelledby="pg-ai-inside-title">
      <VoiceBar />
      <LaneHead id="pg-ai-inside-title" icon={Mic} status="Inside CampusPilot" title="An assistant built into the app" text="Talk to it from any page, or type to it. A voice model listens and speaks; a reasoning model does the work behind it." />
      <WayList items={insideItems} />
    </article>
  );
}

function YoursLane() {
  return (
    <article className="pg-ai-lane" aria-labelledby="pg-ai-yours-title">
      <LaneHead id="pg-ai-yours-title" icon={Cable} status="Your own assistant" title="The AI your team already uses" text="Connect it to CampusPilot and it answers from your live records, signed in as the person asking." />
      <WayList items={yoursItems} />
    </article>
  );
}

/**
 * The ways to ask, all live today: the built-in assistant (voice, chat, question
 * papers, approvals) and the assistants a team already uses. Both lanes share
 * one permission model, which the foot line says once. Lanes rise in once on
 * view (`playOnView`).
 */
export function WaysToAskSection() {
  return (
    <Section id="ways-to-ask" labelledBy="pg-ai-ways-title" className="pg-ai-ways">
      <SectionIntro
        id="pg-ai-ways-title"
        eyebrow="Ways to ask"
        eyebrowIcon={MessagesSquare}
        title="Talk to it, type to it, or bring your own."
        description="Every way of asking reaches the same live records, through the same permissions as the person asking."
      />
      <div className="pg-ai-lanes" ref={playOnView}>
        <InsideLane />
        <YoursLane />
      </div>
      <p className="pg-ai-ways-foot"><UserRoundCheck aria-hidden="true" />Your school chooses which roles may use the built-in assistant and how much it may spend each month.</p>
    </Section>
  );
}
