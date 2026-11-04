import { Lock, Sparkles } from "lucide-react";

import { DoodleArrow, DoodleCheck, Squiggle, Tape, revealOnView } from "./doodles";

const chores = [
  {
    before: "Copy every admission form into three registers",
    after: "Enquiry → registration → class → student record, in one flow.",
  },
  {
    before: "Write fee receipts by hand and tally the cash box",
    after: "Every payment issues a receipt and updates that student's ledger.",
  },
  {
    before: "Collect marks on paper slips from every teacher",
    after: "Teachers enter marks for their classes; the exam cell approves.",
  },
  {
    before: "Format hundreds of report cards and admit cards",
    after: "Branded report cards and admit cards, generated from live records.",
  },
  {
    before: "Re-type the same notice for every class",
    after: "Write the notice once, from one place.",
  },
] as const;

function ChoreItem({ before, after, index }: { before: string; after: string; index: number }) {
  return (
    <li className="d3-chore" style={{ "--i": index } as React.CSSProperties}>
      <DoodleCheck />
      <p>
        <s className="d3-strike"><span className="d3-sr">Before: </span>{before}</s>
        <span className="d3-chore-after"><span className="d3-sr">Now: </span>{after}</span>
      </p>
    </li>
  );
}

function DoneOncePage() {
  return (
    <article className="d3-page-sheet d3-page-left" aria-labelledby="d3-done-title">
      <p className="d3-page-tag d3-hand">the repeated work</p>
      <h3 id="d3-done-title">Crossed off the to-do list — for good.</h3>
      <p className="d3-page-intro">
        School admin is the same steps every day, term and session. CampusPilot connects them, so each one is done
        once, correctly, and flows on.
      </p>
      <ul className="d3-chores" ref={revealOnView}>
        {chores.map((chore, index) => <ChoreItem key={chore.before} {...chore} index={index} />)}
      </ul>
    </article>
  );
}

type Exchange = { who: string; scope: string; question: string; answer: string; refused?: boolean };

const exchanges: readonly Exchange[] = [
  {
    who: "Principal",
    scope: "all classes",
    question: "Which classes have the most fees outstanding this session?",
    answer: "Class 9–A ₹48,200 · Class 6–B ₹38,400 · Class 11–C ₹31,750 — from the 2026–27 ledgers.",
  },
  {
    who: "Class teacher, 7–A",
    scope: "own class only",
    question: "Show me the fee dues for the whole school.",
    answer: "Fee records aren't part of your access. I can help with marks and timetables for Class 7–A.",
    refused: true,
  },
];

function ChatExchange({ exchange }: { exchange: Exchange }) {
  return (
    <li className="d3-chat" data-refused={exchange.refused ?? false}>
      <p className="d3-chat-who d3-hand">
        {exchange.who} <span>· {exchange.scope}</span>
      </p>
      <p className="d3-bubble d3-bubble-ask">{exchange.question}</p>
      <p className="d3-bubble d3-bubble-answer">
        {exchange.refused ? <Lock aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
        <span>{exchange.answer}</span>
      </p>
    </li>
  );
}

function AiTodayPage() {
  return (
    <article className="d3-page-sheet d3-page-right" aria-labelledby="d3-ai-title">
      <p className="d3-page-tag d3-hand">ready for AI — today</p>
      <h3 id="d3-ai-title">Ask your school a question. Get an answer you're allowed to see.</h3>
      <p className="d3-page-intro">
        CampusPilot works with the AI assistants your team already uses. Answers come from your live records — and an
        assistant only sees what the person asking is allowed to see.
      </p>
      <ul className="d3-chats" aria-label="Illustrative assistant conversations">
        {exchanges.map((exchange) => <ChatExchange key={exchange.who} exchange={exchange} />)}
      </ul>
      <p className="d3-ai-margin d3-hand">
        <DoodleArrow /> same question, different person, different answer. that's the point.
      </p>
    </article>
  );
}

const roadmap = [
  "Draft the fee-reminder list for overdue families",
  "Prepare report cards and queue them for the principal's approval",
  "Gather the documents a new admission still needs",
] as const;

/**
 * The agentic assistant is deliberately drawn as an unfinished pencil page
 * (dashed, lighter, "coming" stamp): it is on the roadmap, not shipped.
 */
function NextPage() {
  return (
    <aside className="d3-nextpage" aria-labelledby="d3-next-title">
      <Tape className="d3-tape-top" />
      <p className="d3-stamp">Coming · on the roadmap</p>
      <h3 id="d3-next-title">Next page: assistants inside CampusPilot</h3>
      <p>Agentic AI in the CampusPilot app that prepares the work for a person to review:</p>
      <ul>
        {roadmap.map((item) => <li key={item}>{item}</li>)}
      </ul>
      <p className="d3-hand d3-nextpage-foot">Nothing goes out until someone approves it. Not shipped yet — we'll say so when it is.</p>
    </aside>
  );
}

function DoneOnceIntro() {
  return (
    <header className="d3-section-head" ref={revealOnView}>
      <p className="d3-chapter d3-hand">chapter 2</p>
      <h2 id="d3-busywork-title">
        The busywork, done <span className="d3-nowrap"><span className="d3-underlined">once<Squiggle /></span>.</span> The school, ready for AI.
      </h2>
    </header>
  );
}

export function DoneOnce() {
  return (
    <section id="busywork" className="d3-section d3-busywork" aria-labelledby="d3-busywork-title">
      <div className="d3-wrap">
        <DoneOnceIntro />
        <div className="d3-notebook">
          <DoneOncePage />
          <AiTodayPage />
        </div>
        <NextPage />
      </div>
    </section>
  );
}
