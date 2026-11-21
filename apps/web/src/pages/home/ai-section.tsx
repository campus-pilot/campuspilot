import { ArrowRight, Cable, Check, Keyboard, Mic, Sparkles, type LucideIcon } from "lucide-react";
import { Link } from "react-router";

import { AssistantMark } from "@/site/signature";
import { Section, SectionIntro } from "@/site/ui/section";

/** Fee dues shown as the assistant's answer (illustrative names and amounts). */
const dueRows = [
  ["Aarav Sharma", "8 A", "₹4,500"],
  ["Diya Nair", "8 B", "₹2,250"],
  ["Kabir Singh", "8 A", "₹4,500"],
] as const;

/** The management app behind the voice bar, drawn as quiet placeholder rows. */
function StageApp() {
  return (
    <div className="pg-home-voice-app">
      <span className="pg-home-voice-chrome"><i /><i /><i /></span>
      <span className="pg-home-voice-side" />
      <span className="pg-home-voice-rows" />
    </div>
  );
}

/** What was said, and the answer as the app's own table. */
function SpokenAnswer() {
  return (
    <div className="pg-home-voice-answer">
      <p className="pg-home-voice-said">
        <Mic /> You said: <b>“Who in Class 8 still owes Term 2 fees?”</b>
      </p>
      <table>
        <thead>
          <tr><th>Student</th><th>Section</th><th>Due</th></tr>
        </thead>
        <tbody>
          {dueRows.map(([name, section, due]) => (
            <tr key={name}><td>{name}</td><td>{section}</td><td>{due}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The voice bar docked at the bottom of the app, as in the management app. */
function VoiceDock() {
  return (
    <div className="pg-home-voice-dock">
      <AssistantMark speaking className="pg-home-voice-mark" />
      <p>
        <small>Assistant</small>
        Three students in Class 8 still owe Term 2 fees…
      </p>
      <span className="pg-home-voice-wave"><i /><i /><i /><i /><i /></span>
      <span className="pg-home-voice-end">End</span>
    </div>
  );
}

/**
 * Decorative stage: the app window with the voice glow, a spoken question
 * answered with a table, and the voice bar. Described once by `aria-label`.
 */
function VoiceStage() {
  return (
    <figure
      className="pg-home-voice-stage"
      role="img"
      aria-label="Illustration: a staff member asks out loud which Class 8 students still owe Term 2 fees, and the assistant answers in the app with a table of three students."
    >
      <StageApp />
      <SpokenAnswer />
      <VoiceDock />
    </figure>
  );
}

type Way = { icon: LucideIcon; title: string; text: string };

/** The three ways to ask, all through the same permissions. */
const ways: readonly Way[] = [
  { icon: Mic, title: "Talk", text: "Start voice from any page. It keeps listening as you move around the app and can read the screen you are on." },
  { icon: Keyboard, title: "Type", text: "Ask from ⌘K or the Assistant page. Attach a photo or PDF, and get tables, results and documents back." },
  { icon: Cable, title: "Connect yours", text: "Use the AI assistant your team already has. It reaches CampusPilot as the person asking." },
];

function WaysList() {
  return (
    <ul className="pg-home-ways">
      {ways.map(({ icon: Icon, title, text }) => (
        <li key={title}>
          <span className="pg-home-way-icon"><Icon aria-hidden="true" /></span>
          <b>{title}</b>
          <p>{text}</p>
        </li>
      ))}
    </ul>
  );
}

const promises = [
  "Same permissions as the person asking",
  "Changes in the app wait for your approval",
  "You choose which roles may use it",
] as const;

function Promises() {
  return (
    <ul className="pg-home-promises">
      {promises.map((promise) => (
        <li key={promise}><Check aria-hidden="true" />{promise}</li>
      ))}
    </ul>
  );
}

/**
 * Home "AI-ready" section: the built-in assistant answering a spoken question
 * over the app, then the three ways to ask (voice, chat, your own assistant)
 * and what never changes (permissions, approvals, who may use it). Everything
 * named here ships today; nothing on the home page is labelled as roadmap.
 */
export function AiSection() {
  return (
    <Section id="ai" labelledBy="ai-title" className="pg-home-ai">
      <SectionIntro
        id="ai-title"
        eyebrow="AI-ready"
        eyebrowIcon={Sparkles}
        title={<>Just ask your school.<br />Out loud, if you like.</>}
        description="Talk to CampusPilot while you work, type a question, or connect the AI assistant you already use. It answers from live records, only within what you may see."
      />
      <VoiceStage />
      <WaysList />
      <Promises />
      <Link className="cp-text-link pg-home-ai-link" to="/ai-ready">
        How AI readiness works <ArrowRight aria-hidden="true" />
      </Link>
    </Section>
  );
}
