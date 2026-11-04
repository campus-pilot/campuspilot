import { ArrowRight, BookOpen, CreditCard, FileText, Sparkles, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { AdmissionsArt, AiArt, DocumentsArt, ExamsArt, FeesArt } from "./tab-art";

type TabId = "admissions" | "fees" | "exams" | "documents" | "ai";

type TabDef = {
  id: TabId;
  label: string;
  icon: typeof Users;
  title: string;
  body: string;
  once: string;
  flows: string;
  who: string;
  href: string;
  cta: string;
  note?: string;
  Art: () => React.ReactNode;
};

const tabs: readonly TabDef[] = [
  {
    id: "admissions",
    label: "Admissions",
    icon: Users,
    title: "From first enquiry to student record — without re-typing.",
    body: "An enquiry becomes a registration, a class allocation and a student record in one continuous flow. What a parent tells you once follows the child into fees, exams and documents.",
    once: "Parent and student details, captured at enquiry",
    flows: "Registration, class allocation, fee bills, admit cards",
    who: "Admission desk and leadership. Teachers see only students in their classrooms.",
    href: "/features/admissions",
    cta: "Explore admissions",
    Art: AdmissionsArt,
  },
  {
    id: "fees",
    label: "Fees & receipts",
    icon: CreditCard,
    title: "Collect a fee once. Receipts and ledgers keep up.",
    body: "Fee structures become bills for the whole session. Every payment, discount or waiver lands in the student ledger and the session dashboard as it is recorded, with the receipt ready to print.",
    once: "The payment, recorded at the counter",
    flows: "Receipt, student ledger, dues list, collection dashboard",
    who: "Accounts teams see amounts. Families see their own child's ledger.",
    href: "/features/billing",
    cta: "Explore fees & billing",
    Art: FeesArt,
  },
  {
    id: "exams",
    label: "Examinations",
    icon: BookOpen,
    title: "Marks entered once become report cards.",
    body: "Plan exams and timetables per class, let subject teachers enter marks for their own classrooms, approve results, and generate report cards and admit cards from the same data.",
    once: "Marks, entered by the subject teacher",
    flows: "Results, approvals, report cards, admit cards",
    who: "Teachers enter marks only for assigned subjects. Approval stays with the exam team.",
    href: "/features/examinations",
    cta: "Explore examinations",
    Art: ExamsArt,
  },
  {
    id: "documents",
    label: "Documents",
    icon: FileText,
    title: "Every school document, generated from live records.",
    body: "Branded report cards, admit cards, ID cards, receipts, timetables and notices come straight from the records you already keep — no copy-pasting into templates the night before.",
    once: "Your school's template, set up once",
    flows: "Report cards, admit cards, ID cards, receipts, timetables, notices",
    who: "Generation follows the same campus and classroom boundaries as the records.",
    href: "/features/documents",
    cta: "Explore documents",
    Art: DocumentsArt,
  },
  {
    id: "ai",
    label: "AI-ready",
    icon: Sparkles,
    title: "AI that answers from your school — and only what you may see.",
    body: "Connect the AI assistants your team already uses. They answer from live CampusPilot records through the same permissions as the person asking, so a class teacher's assistant never sees the whole school's fees.",
    once: "The permissions you already set for each person",
    flows: "Answers from live admissions, fee and exam records",
    who: "Exactly what the asking person is allowed to see — nothing more.",
    href: "/ai-ready",
    cta: "How AI readiness works",
    note: "On the roadmap: assistants inside CampusPilot that prepare work — the fee-reminder list, report cards for approval — for a person to review.",
    Art: AiArt,
  },
];

type TabsState = { active: TabId; leaving: TabId | null };

/**
 * Tracks the active tab and the one that is animating out. Keeping `leaving` in state lets the
 * previous panel play its own exit keyframes while the next one enters, without timers or
 * effects: the exit animation ends on `visibility: hidden` and the panel is `inert` meanwhile.
 */
function useAnimatedTabs() {
  const [state, setState] = useState<TabsState>({ active: tabs[0].id, leaving: null });

  const select = (id: TabId) =>
    setState((current) => (current.active === id ? current : { active: id, leaving: current.active }));

  /** Automatic activation with Left/Right/Home/End, per the WAI-ARIA tabs pattern. */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((tab) => tab.id === state.active);
    const nextIndex = {
      ArrowRight: (index + 1) % tabs.length,
      ArrowLeft: (index - 1 + tabs.length) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    }[event.key];
    if (nextIndex === undefined) return;
    event.preventDefault();
    const next = tabs[nextIndex].id;
    select(next);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-tab-id="${next}"]`)?.focus();
  };

  return { ...state, select, onKeyDown };
}

export function ProductTabsSection() {
  const { active, leaving, select, onKeyDown } = useAnimatedTabs();
  return (
    <section className="d2-section d2-product" id="d2-product" aria-labelledby="d2-product-title">
      <div className="d2-container">
        <header className="d2-section-head">
          <p className="d2-kicker">Inside CampusPilot</p>
          <h2 id="d2-product-title" className="d2-section-title">Clean records in.<br /><em>Only what matters out.</em></h2>
          <p className="d2-section-lead">
            Pick a workflow to see which step you do once, where it flows next, and who gets to
            see it.
          </p>
        </header>
        <div className="d2-tabs" data-touched={leaving !== null}>
          <TabList active={active} onSelect={select} onKeyDown={onKeyDown} />
          <div className="d2-panels">
            {tabs.map((tab) => (
              <TabPanel key={tab.id} tab={tab} state={tab.id === active ? "active" : tab.id === leaving ? "leaving" : "idle"} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function TabList({
  active,
  onSelect,
  onKeyDown,
}: {
  active: TabId;
  onSelect: (id: TabId) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
}) {
  return (
    <div className="d2-tablist" role="tablist" aria-label="CampusPilot workflows" onKeyDown={onKeyDown}>
      {tabs.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={`d2-tab-${id}`}
          data-tab-id={id}
          className="d2-tab"
          aria-selected={id === active}
          aria-controls={`d2-panel-${id}`}
          tabIndex={id === active ? 0 : -1}
          onClick={() => onSelect(id)}
        >
          <Icon aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}

function TabPanel({ tab, state }: { tab: TabDef; state: "active" | "leaving" | "idle" }) {
  const { Art } = tab;
  return (
    <div
      role="tabpanel"
      id={`d2-panel-${tab.id}`}
      aria-labelledby={`d2-tab-${tab.id}`}
      className="d2-panel"
      data-tab={tab.id}
      data-state={state}
      hidden={state === "idle"}
      inert={state === "leaving"}
      aria-hidden={state === "leaving" ? true : undefined}
      tabIndex={state === "active" ? 0 : -1}
    >
      <PanelCopy tab={tab} />
      <div className="d2-panel-art">
        <Art />
      </div>
    </div>
  );
}

function PanelCopy({ tab }: { tab: TabDef }) {
  return (
    <div className="d2-panel-copy">
      <h3 className="d2-panel-title d2-rise" style={{ "--i": 0 } as React.CSSProperties}>{tab.title}</h3>
      <p className="d2-panel-body d2-rise" style={{ "--i": 1 } as React.CSSProperties}>{tab.body}</p>
      <dl className="d2-facts d2-rise" style={{ "--i": 2 } as React.CSSProperties}>
        <PanelFact term="Done once" detail={tab.once} />
        <PanelFact term="Flows to" detail={tab.flows} />
        <PanelFact term="Who sees it" detail={tab.who} />
      </dl>
      {tab.note && <p className="d2-roadmap-note d2-rise" style={{ "--i": 3 } as React.CSSProperties}><span>Roadmap</span>{tab.note}</p>}
      <Link className="d2-text-link d2-rise" style={{ "--i": 4 } as React.CSSProperties} to={tab.href}>
        {tab.cta} <ArrowRight aria-hidden="true" />
      </Link>
    </div>
  );
}

function PanelFact({ term, detail }: { term: string; detail: string }) {
  return (
    <div className="d2-fact">
      <dt>{term}</dt>
      <dd>{detail}</dd>
    </div>
  );
}
