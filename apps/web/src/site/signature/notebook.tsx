/**
 * Notebook: an open spiral-bound book, the one place the site goes handwritten.
 * - Left page: chores struck through and ticked (on view), each with the
 *   CampusPilot way written under it.
 * - Right page: assistant chats, answered inside the asker's access or politely
 *   refused outside it.
 * - Optional "next page" roadmap note stamped "Coming · on the roadmap".
 *
 * Fully prop-driven so solution pages can feed role-specific content:
 * `<Notebook leftKicker leftTitle chores rightKicker rightTitle chats roadmap? />`.
 * `NotebookSection` wraps it in a `cp-section` with a `SectionIntro`.
 *
 * Outside the book everything stays /1/1. On phones the pages stack and the
 * spiral moves to the top. Reduced motion shows the finished, ticked page.
 */
import { BookOpenCheck, Lock, Sparkles } from "lucide-react";
import { useId } from "react";

import { Section, SectionIntro } from "@/site/ui/section";

import { SrOnly, revealOnView, stagger } from "./shared";

export type NotebookChore = {
  /** The repeated chore, struck through. */
  chore: string;
  /** How CampusPilot handles it now. */
  how: string;
};

export type NotebookChat = {
  /** Who is asking and their scope, e.g. "Class teacher, 7 A". */
  asker: string;
  question: string;
  answer: string;
  /** `false` renders the answer as a polite refusal with a lock. */
  allowed: boolean;
};

export type NotebookRoadmap = { title: string; text: string };

export type NotebookProps = {
  leftKicker: string;
  leftTitle: string;
  chores: readonly NotebookChore[];
  rightKicker: string;
  rightTitle: string;
  chats: readonly NotebookChat[];
  roadmap?: NotebookRoadmap;
};

/** Hand-drawn tick inside a wobbly box, the "done" mark of the checklist. */
function DoodleCheck() {
  return (
    <svg className="cp-nb-check" viewBox="0 0 32 32" aria-hidden="true">
      <path className="cp-nb-check-box" d="M5 6 C 12 4, 22 5, 27 5 C 28 12, 27 21, 27 27 C 19 28, 11 27, 5 27 C 4 19, 5 12, 5 6 Z" />
      <path className="cp-nb-check-tick" pathLength={1} d="M9 16 L 14 22 L 29 3" />
    </svg>
  );
}

function ChoreItem({ chore, how, index }: NotebookChore & { index: number }) {
  return (
    <li className="cp-nb-chore" style={stagger(index)}>
      <DoodleCheck />
      <p>
        <s className="cp-nb-strike"><SrOnly>Before: </SrOnly>{chore}</s>
        <span className="cp-nb-how"><SrOnly>Now: </SrOnly>{how}</span>
      </p>
    </li>
  );
}

function PageHead({ id, kicker, title }: { id: string; kicker: string; title: string }) {
  return (
    <>
      <p className="cp-nb-kicker"><span>{kicker}</span></p>
      <h3 id={id}>{title}</h3>
    </>
  );
}

function ChoresPage({ id, kicker, title, chores }: { id: string; kicker: string; title: string; chores: readonly NotebookChore[] }) {
  return (
    <article className="cp-nb-sheet cp-nb-left" aria-labelledby={id} ref={revealOnView}>
      <PageHead id={id} kicker={kicker} title={title} />
      <ul className="cp-nb-chores">
        {chores.map((chore, index) => <ChoreItem key={chore.chore} {...chore} index={index} />)}
      </ul>
    </article>
  );
}

function ChatItem({ chat, index }: { chat: NotebookChat; index: number }) {
  const Icon = chat.allowed ? Sparkles : Lock;
  return (
    <li className="cp-nb-chat" data-allowed={chat.allowed} style={stagger(index)}>
      <p className="cp-nb-asker">{chat.asker}</p>
      <p className="cp-nb-bubble cp-nb-ask">{chat.question}</p>
      <p className="cp-nb-bubble cp-nb-answer">
        <Icon aria-hidden="true" />
        <span>
          <SrOnly>{chat.allowed ? "Answered: " : "Refused, outside this person's access: "}</SrOnly>
          {chat.answer}
        </span>
      </p>
    </li>
  );
}

function ChatsPage({ id, kicker, title, chats }: { id: string; kicker: string; title: string; chats: readonly NotebookChat[] }) {
  return (
    <article className="cp-nb-sheet cp-nb-right" aria-labelledby={id} ref={revealOnView}>
      <PageHead id={id} kicker={kicker} title={title} />
      <ul className="cp-nb-chats" aria-label="Illustrative assistant conversations">
        {chats.map((chat, index) => <ChatItem key={chat.question} chat={chat} index={index} />)}
      </ul>
    </article>
  );
}

/**
 * The roadmap page is drawn as an unfinished pencil sheet (dashed, lighter,
 * "coming" stamp): it is on the roadmap, not shipped.
 */
function NextPage({ id, roadmap }: { id: string; roadmap: NotebookRoadmap }) {
  return (
    <aside className="cp-nb-next" aria-labelledby={id} ref={revealOnView}>
      <p className="cp-nb-stamp">Coming · on the roadmap</p>
      <h3 id={id}>{roadmap.title}</h3>
      <p>{roadmap.text}</p>
    </aside>
  );
}

export function Notebook({ leftKicker, leftTitle, chores, rightKicker, rightTitle, chats, roadmap }: NotebookProps) {
  const id = useId();
  return (
    <div className="cp-nb-wrap">
      <div className="cp-nb">
        <ChoresPage id={`${id}-left`} kicker={leftKicker} title={leftTitle} chores={chores} />
        <ChatsPage id={`${id}-right`} kicker={rightKicker} title={rightTitle} chats={chats} />
      </div>
      {roadmap ? <NextPage id={`${id}-next`} roadmap={roadmap} /> : null}
    </div>
  );
}

/** School-wide default content (home); solution pages pass their own. */
export const notebookDefaults: NotebookProps = {
  leftKicker: "the repeated work",
  leftTitle: "Crossed off the to-do list, for good.",
  chores: [
    { chore: "Copy every admission form into three registers", how: "Enquiry → registration → class → student record, in one flow." },
    { chore: "Write fee receipts by hand and tally the cash box", how: "Every payment issues a receipt and updates that student's ledger." },
    { chore: "Collect marks on paper slips from every teacher", how: "Teachers enter marks for their classes; the exam cell approves." },
    { chore: "Format hundreds of report cards and admit cards", how: "Branded report cards and admit cards, generated from live records." },
    { chore: "Re-type the same notice for every class", how: "Write the notice once, from one place." },
  ],
  rightKicker: "ready for AI, today",
  rightTitle: "Ask your school a question. Get an answer you're allowed to see.",
  chats: [
    {
      asker: "Principal · all classes",
      question: "Which classes have the most fees outstanding this session?",
      answer: "Class 9 A ₹48,200 · Class 6 B ₹38,400 · Class 11 C ₹31,750, from the 2026–27 ledgers.",
      allowed: true,
    },
    {
      asker: "Class teacher, 7 A · own class only",
      question: "Show me the fee dues for the whole school.",
      answer: "Fee records aren't part of your access. I can help with marks and timetables for Class 7 A.",
      allowed: false,
    },
  ],
  roadmap: {
    title: "Next page: assistants inside CampusPilot",
    text: "Agentic AI in the CampusPilot app that prepares work, like the fee-reminder list or report cards queued for the principal's approval, for a person to review. Nothing goes out until someone approves it.",
  },
};

type NotebookSectionProps = Partial<NotebookProps> & {
  id?: string;
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
};

/**
 * `cp-section` with a `SectionIntro` above the book. Each notebook prop left
 * out falls back to `notebookDefaults` individually (so pass both `chores`
 * and `chats` for role-specific pages). `hideRoadmap` drops the roadmap note.
 */
export function NotebookSection({
  id = "done-once",
  eyebrow = "Done once, ready for AI",
  title = "The busywork, done once. The school, ready for AI.",
  description = "School admin is the same steps every day, term and session. CampusPilot connects them, and the assistants your team already uses answer only within each person's access.",
  hideRoadmap = false,
  ...book
}: NotebookSectionProps & { hideRoadmap?: boolean }) {
  const headingId = `${id}-title`;
  const props = { ...notebookDefaults, ...book };
  return (
    <Section id={id} labelledBy={headingId}>
      <SectionIntro id={headingId} eyebrow={eyebrow} eyebrowIcon={BookOpenCheck} title={title} description={description} />
      <Notebook {...props} roadmap={hideRoadmap ? undefined : props.roadmap} />
    </Section>
  );
}
