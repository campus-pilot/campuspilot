import { ClipboardCheck, GraduationCap, IndianRupee, ListChecks, MessageCircleQuestion, Sparkles, UserPlus, type LucideIcon } from "lucide-react";

import { Pill } from "@/site/ui/section";

type AgendaTopic = {
  /** Minute mark on the 30-minute running order. */
  minute: string;
  icon: LucideIcon;
  title: string;
  text: string;
  /** What the school will see on screen for this topic. */
  see: string;
  /** Honest roadmap note; only the AI topic has one. */
  roadmap?: string;
};

const topics: readonly AgendaTopic[] = [
  {
    minute: "00",
    icon: GraduationCap,
    title: "Your sessions & classes",
    text: "Your session set up the way you run it: classes from Nursery to Class 12, sections, subjects and teacher assignments.",
    see: "Session 2026–27 · LKG A/B · Class 8-A",
  },
  {
    minute: "06",
    icon: UserPlus,
    title: "Admissions",
    text: "Enquiry to registration, class allocation and one student record the whole office works from, entered once.",
    see: "Enquiry → Registration → Class 3-B",
  },
  {
    minute: "12",
    icon: IndianRupee,
    title: "Fee structures & receipts",
    text: "Your fee heads and instalments, billing runs, discounts, and receipts that land in the ledger on their own.",
    see: "Term 1 · ₹18,400 · Receipt R-0412",
  },
  {
    minute: "18",
    icon: ClipboardCheck,
    title: "Exams & report cards",
    text: "Exam plans and timetables, marks entry with approvals, then report cards and admit cards from the same marks.",
    see: "First Term · marks approved · report cards",
  },
  {
    minute: "24",
    icon: Sparkles,
    title: "What AI-ready means for your records",
    text: "Today, the AI assistants your team already uses can work with CampusPilot records, with the same permissions as the person asking. AI inside CampusPilot also drafts question papers for teachers.",
    see: "“Which Class 3-B fees are still due?”",
    roadmap: "On the roadmap: more AI inside CampusPilot that prepares work, like a fee-reminder list, for a person to review.",
  },
];

function AgendaNote({ topic }: { topic: AgendaTopic }) {
  if (topic.roadmap) {
    return (
      <p className="pg-book-agenda-roadmap">
        <span>Coming</span> {topic.roadmap}
      </p>
    );
  }
  return null;
}

function AgendaItem({ topic, index }: { topic: AgendaTopic; index: number }) {
  const Icon = topic.icon;
  return (
    <li className="pg-book-agenda-item" style={{ "--pg-i": index } as React.CSSProperties}>
      <span className="pg-book-agenda-time">
        <span className="pg-cc-sr">Minute </span>
        {topic.minute}
      </span>
      <span className="pg-book-agenda-node" aria-hidden="true">
        <Icon />
      </span>
      <div className="pg-book-agenda-body">
        <h3>{topic.title}</h3>
        <p>{topic.text}</p>
        <span className="pg-book-agenda-see">{topic.see}</span>
        <AgendaNote topic={topic} />
      </div>
    </li>
  );
}

/** Closing marker of the running order: questions are welcome throughout. */
function AgendaEnd() {
  return (
    <li className="pg-book-agenda-item pg-book-agenda-end">
      <span className="pg-book-agenda-time">30</span>
      <span className="pg-book-agenda-node" aria-hidden="true">
        <MessageCircleQuestion />
      </span>
      <div className="pg-book-agenda-body">
        <h3>Your questions</h3>
        <p>Interrupt us any time. It's your walkthrough, so we follow what matters to your school.</p>
      </div>
    </li>
  );
}

/** Decorative 30-minute dial: five segments, one per topic, with a slowly sweeping hand. */
function AgendaDial() {
  return (
    <span className="pg-book-dial" aria-hidden="true">
      <span className="pg-book-dial-ring" />
      <span className="pg-book-dial-hand" />
      <b>30</b>
      <small>min</small>
    </span>
  );
}

function AgendaIntro() {
  return (
    <div className="pg-book-agenda-intro">
      <Pill icon={ListChecks}>Agenda</Pill>
      <h2 id="pg-book-agenda-title">What we'll cover in 30 minutes.</h2>
      <p>A running order, not a script. We spend longer wherever your school needs it.</p>
      <AgendaDial />
    </div>
  );
}

export function AgendaSection() {
  return (
    <section className="cp-section pg-book-agenda" id="agenda" aria-labelledby="pg-book-agenda-title">
      <AgendaIntro />
      <ol className="pg-book-agenda-list">
        {topics.map((topic, index) => (
          <AgendaItem key={topic.title} topic={topic} index={index} />
        ))}
        <AgendaEnd />
      </ol>
    </section>
  );
}
