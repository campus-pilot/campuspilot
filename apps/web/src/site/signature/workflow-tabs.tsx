/**
 * WorkflowTabs: Admissions → Fees & receipts → Examinations → Documents →
 * AI-ready, each tab with its own enter/exit animation and artwork.
 *
 * - `WorkflowTabsSection` ({ id?, eyebrow?, title?, description?, tabs? }):
 *   a full `cp-section` with its own `SectionIntro`. Placement: directly under
 *   the home hero.
 * - `WorkflowTabs` ({ tabs?, label? }): the widget alone, for pages that bring
 *   their own heading.
 * - `workflowTabs`: the default tab data (exported so pages can reorder or
 *   filter it, e.g. `workflowTabs.filter(...)`).
 *
 * Accessibility: WAI-ARIA tabs with automatic activation (Left/Right/Home/End),
 * roving tabindex, `aria-controls`/`aria-labelledby`, focusable active panel.
 */
import { ArrowRight, BookOpen, CreditCard, FileText, LayoutGrid, Sparkles, Users, type LucideIcon } from "lucide-react";
import { useId, useState, type ComponentType } from "react";
import { Link } from "react-router";

import { Section, SectionIntro } from "@/site/ui/section";

import { AdmissionsArt, AiArt, DocumentsArt, ExamsArt, FeesArt, type ArtProps } from "./feature-art";
import { stagger } from "./shared";

/** Named enter/exit animation pair a panel plays (see `signature.css`). */
export type WorkflowTabMotion = "rise" | "zoom" | "wipe" | "drop" | "focus";

export type WorkflowTab = {
  id: string;
  label: string;
  icon: LucideIcon;
  title: string;
  body: string;
  /** "Done once" fact. */
  once: string;
  /** "Flows to" fact. */
  flows: string;
  /** "Who sees it" fact. */
  who: string;
  href: string;
  cta: string;
  /** Optional honest roadmap line, rendered with a "Roadmap" tag. */
  note?: string;
  motion: WorkflowTabMotion;
  Art: ComponentType<ArtProps>;
};

export const workflowTabs: readonly WorkflowTab[] = [
  {
    id: "admissions",
    label: "Admissions",
    icon: Users,
    title: "From first enquiry to student record, without re-typing.",
    body: "An enquiry becomes a registration, a class allocation and a student record in one continuous flow. What a parent tells you once follows the child into fees, exams and documents.",
    once: "Parent and student details, captured at enquiry",
    flows: "Registration, class allocation, fee bills, admit cards",
    who: "Admission desk and leadership. Teachers see only students in their classrooms.",
    href: "/features/admissions",
    cta: "Explore admissions",
    motion: "rise",
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
    motion: "zoom",
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
    motion: "wipe",
    Art: ExamsArt,
  },
  {
    id: "documents",
    label: "Documents",
    icon: FileText,
    title: "Every school document, generated from live records.",
    body: "Branded report cards, admit cards, ID cards, receipts, timetables and notices come straight from the records you already keep. No copy-pasting into templates the night before.",
    once: "Your school's template, set up once",
    flows: "Report cards, admit cards, ID cards, receipts, timetables, notices",
    who: "Generation follows the same campus and classroom boundaries as the records.",
    href: "/features/documents",
    cta: "Explore documents",
    motion: "drop",
    Art: DocumentsArt,
  },
  {
    id: "ai",
    label: "AI-ready",
    icon: Sparkles,
    title: "AI that answers from your school, and only what you may see.",
    body: "Connect the AI assistants your team already uses. They answer from live CampusPilot records through the same permissions as the person asking, so a class teacher's assistant never sees the whole school's fees.",
    once: "The permissions you already set for each person",
    flows: "Answers from live admissions, fee and exam records",
    who: "Exactly what the asking person is allowed to see, nothing more.",
    href: "/ai-ready",
    cta: "How AI readiness works",
    note: "Assistants inside CampusPilot that prepare work (the fee-reminder list, report cards for approval) for a person to review.",
    motion: "focus",
    Art: AiArt,
  },
];

type TabsState = { active: string; leaving: string | null };

/**
 * Tracks the active tab and the one animating out. Keeping `leaving` in state
 * lets the previous panel play its own exit keyframes while the next one
 * enters, without timers or effects: the exit animation ends on
 * `visibility: hidden` (and the panel is `inert` meanwhile). Reduced motion
 * hides the leaving panel outright in CSS.
 */
function useAnimatedTabs(tabs: readonly WorkflowTab[]) {
  const [state, setState] = useState<TabsState>({ active: tabs[0]?.id ?? "", leaving: null });

  const select = (id: string) =>
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

type WorkflowTabsProps = {
  tabs?: readonly WorkflowTab[];
  /** Accessible name of the tab list. */
  label?: string;
};

/** The tab widget alone (tab list + animated panels). */
export function WorkflowTabs({ tabs = workflowTabs, label = "CampusPilot workflows" }: WorkflowTabsProps) {
  const { active, leaving, select, onKeyDown } = useAnimatedTabs(tabs);
  const prefix = useId();
  return (
    <div className="cp-wt" data-touched={leaving !== null}>
      <div className="cp-wt-tablist" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {tabs.map((tab) => (
          <TabButton key={tab.id} tab={tab} prefix={prefix} selected={tab.id === active} onSelect={select} />
        ))}
      </div>
      <div className="cp-wt-panels">
        {tabs.map((tab) => (
          <TabPanel
            key={tab.id}
            tab={tab}
            prefix={prefix}
            state={tab.id === active ? "active" : tab.id === leaving ? "leaving" : "idle"}
          />
        ))}
      </div>
    </div>
  );
}

function TabButton({
  tab,
  prefix,
  selected,
  onSelect,
}: {
  tab: WorkflowTab;
  prefix: string;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const Icon = tab.icon;
  return (
    <button
      type="button"
      role="tab"
      id={`${prefix}-tab-${tab.id}`}
      data-tab-id={tab.id}
      className="cp-wt-tab"
      aria-selected={selected}
      aria-controls={`${prefix}-panel-${tab.id}`}
      tabIndex={selected ? 0 : -1}
      onClick={() => onSelect(tab.id)}
    >
      <Icon aria-hidden="true" />
      {tab.label}
    </button>
  );
}

function TabPanel({ tab, prefix, state }: { tab: WorkflowTab; prefix: string; state: "active" | "leaving" | "idle" }) {
  const { Art } = tab;
  return (
    <div
      role="tabpanel"
      id={`${prefix}-panel-${tab.id}`}
      aria-labelledby={`${prefix}-tab-${tab.id}`}
      className="cp-wt-panel"
      data-motion={tab.motion}
      data-state={state}
      hidden={state === "idle"}
      inert={state === "leaving"}
      aria-hidden={state === "leaving" ? true : undefined}
      tabIndex={state === "active" ? 0 : -1}
    >
      <PanelCopy tab={tab} />
      <Art />
    </div>
  );
}

function PanelCopy({ tab }: { tab: WorkflowTab }) {
  return (
    <div className="cp-wt-copy">
      <h3 className="cp-wt-rise" style={stagger(0)}>{tab.title}</h3>
      <p className="cp-wt-body cp-wt-rise" style={stagger(1)}>{tab.body}</p>
      <dl className="cp-wt-facts cp-wt-rise" style={stagger(2)}>
        <PanelFact term="Done once" detail={tab.once} />
        <PanelFact term="Flows to" detail={tab.flows} />
        <PanelFact term="Who sees it" detail={tab.who} />
      </dl>
      {tab.note ? (
        <p className="cp-wt-note cp-wt-rise" style={stagger(3)}>
          <span>Roadmap</span>
          {tab.note}
        </p>
      ) : null}
      <Link className="cp-text-link cp-wt-rise" style={stagger(4)} to={tab.href}>
        {tab.cta} <ArrowRight aria-hidden="true" />
      </Link>
    </div>
  );
}

function PanelFact({ term, detail }: { term: string; detail: string }) {
  return (
    <div className="cp-wt-fact">
      <dt>{term}</dt>
      <dd>{detail}</dd>
    </div>
  );
}

type WorkflowTabsSectionProps = WorkflowTabsProps & {
  id?: string;
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
};

/** `cp-section` with a centred intro above the tab widget. */
export function WorkflowTabsSection({
  id = "workflows",
  eyebrow = "Inside CampusPilot",
  title = "Clean records in. Only what matters out.",
  description = "Pick a workflow to see which step you do once, where it flows next, and who gets to see it.",
  tabs,
  label,
}: WorkflowTabsSectionProps) {
  const headingId = `${id}-title`;
  return (
    <Section id={id} labelledBy={headingId}>
      <SectionIntro id={headingId} eyebrow={eyebrow} eyebrowIcon={LayoutGrid} title={title} description={description} />
      <WorkflowTabs tabs={tabs} label={label} />
    </Section>
  );
}
