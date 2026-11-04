/**
 * School-year lifecycle rail: one fictional student (Meera) followed from a
 * confirmed admission to the family view. Each stage lists what it carries
 * forward; on wide screens a sticky "record" card fills in, row by row, as each
 * stage reaches the middle of the viewport.
 */
import {
  CalendarCheck,
  Check,
  CornerDownRight,
  FileText,
  HeartHandshake,
  IdCard,
  IndianRupee,
  Route as RouteIcon,
  School,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { Section, SectionIntro } from "@/site/ui/section";

type Stage = {
  icon: LucideIcon;
  title: string;
  text: string;
  /** Label above the chips: what this stage passes on. */
  carriesLabel: string;
  carries: readonly string[];
  /** The row this stage adds to the sticky record card. */
  field: { label: string; value: string };
};

const stages: readonly Stage[] = [
  {
    icon: UserCheck,
    title: "Admission confirmed",
    text: "The enquiry, registration form and documents end in one confirmed admission. Nobody types the family's details again.",
    carriesLabel: "Carried into the student record",
    carries: ["Meera Menon", "Father · Rajesh Menon", "Date of birth", "Previous school"],
    field: { label: "Applicant", value: "Meera Menon · daughter of Rajesh Menon" },
  },
  {
    icon: IdCard,
    title: "Student record",
    text: "The admission becomes an active student record for the 2026–27 session, with its own admission number.",
    carriesLabel: "Carried into the classroom",
    carries: ["Admission no. 2025016", "Session 2026–27"],
    field: { label: "Admission no.", value: "2025016 · active" },
  },
  {
    icon: School,
    title: "Class & section",
    text: "Meera joins Class 3, Section B, where the class teacher and subject teachers are already assigned.",
    carriesLabel: "Carried into billing",
    carries: ["Class 3 · B", "Class teacher · Ms. Kavya Rao", "6 subjects"],
    field: { label: "Class", value: "Class 3 · Section B" },
  },
  {
    icon: IndianRupee,
    title: "Fee account",
    text: "Class 3's fee structure applies on its own. Bills, discounts, payments and receipts all post to one ledger.",
    carriesLabel: "Carried into dashboards and the family view",
    carries: ["Term 1 · ₹18,400 billed", "Receipt RCP-2026-0418", "₹0 due"],
    field: { label: "Fee ledger", value: "₹18,400 billed · ₹0 due" },
  },
  {
    icon: CalendarCheck,
    title: "Attendance & marks",
    text: "Ms. Rao marks attendance for her class; subject teachers enter First Term marks only for the subjects they teach.",
    carriesLabel: "Carried into the report card",
    carries: ["94% present", "First Term marks", "Co-scholastic grades"],
    field: { label: "Attendance & marks", value: "94% present · First Term entered" },
  },
  {
    icon: FileText,
    title: "Report card & documents",
    text: "Approved results become the report card. The admit card and ID card come from the same record, in your school's branding.",
    carriesLabel: "Carried to the family",
    carries: ["Report card · approved", "Admit card", "ID card"],
    field: { label: "Documents", value: "Report card approved · ID card" },
  },
  {
    icon: HeartHandshake,
    title: "Family view",
    text: "Meera and her family see their own receipts, results and notices, and nothing about anyone else.",
    carriesLabel: "What the family sees",
    carries: ["Receipts", "Approved results", "Notices"],
    field: { label: "Family view", value: "Receipts, results and notices" },
  },
];

/**
 * Tracks which stage crosses a thin band in the middle of the viewport.
 *
 * `active` is `null` until the first stage is observed (server render, no
 * JavaScript): the rail and record card then show their finished, fully filled
 * state. One shared IntersectionObserver is created lazily inside the ref
 * callback (React 19 ref cleanups unobserve), so no effect is needed.
 */
function useActiveStage() {
  const [active, setActive] = useState<number | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const track = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    if (!observerRef.current) {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          const hit = entries.find((entry) => entry.isIntersecting);
          if (hit) setActive(Number((hit.target as HTMLElement).dataset.stage));
        },
        { rootMargin: "-45% 0px -54% 0px" },
      );
    }
    const observer = observerRef.current;
    observer.observe(node);
    setActive((current) => current ?? 0);
    return () => observer.unobserve(node);
  }, []);

  return { active, track };
}

type StageState = "done" | "current" | "next";

/** Without tracking (`active === null`) every stage counts as done. */
function stageState(index: number, active: number | null): StageState {
  if (active === null || index < active) return "done";
  return index === active ? "current" : "next";
}

function CarriedChips({ label, items }: { label: string; items: readonly string[] }) {
  return (
    <div className="pg-product-carry">
      <span className="pg-product-carry-label">
        <CornerDownRight aria-hidden="true" />
        {label}
      </span>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

type StageItemProps = {
  stage: Stage;
  index: number;
  state: StageState;
  track: (node: HTMLElement | null) => (() => void) | undefined;
};

function StageItem({ stage, index, state, track }: StageItemProps) {
  const Icon = stage.icon;
  return (
    <li className="pg-product-stage" data-stage={index} data-state={state} ref={track}>
      <span className="pg-product-stage-marker" aria-hidden="true">
        <Icon />
      </span>
      <div className="pg-product-stage-body">
        <small className="pg-product-stage-step">Stage {String(index + 1).padStart(2, "0")}</small>
        <h3>{stage.title}</h3>
        <p>{stage.text}</p>
        <CarriedChips label={stage.carriesLabel} items={stage.carries} />
      </div>
    </li>
  );
}

function RecordRow({ stage, state }: { stage: Stage; state: StageState }) {
  const Icon = stage.icon;
  return (
    <li className="pg-product-record-row" data-state={state}>
      <span className="pg-product-record-icon">
        {state === "next" ? <Icon /> : <Check />}
      </span>
      <span className="pg-product-record-text">
        <small>{stage.field.label}</small>
        <b>{state === "next" ? `Waiting for ${stage.title.toLowerCase()}` : stage.field.value}</b>
      </span>
    </li>
  );
}

/**
 * Sticky summary of the same student's record. Purely a visual echo of the
 * rail (all its facts are in the stage list), so it is hidden from assistive tech.
 */
function RecordCard({ active }: { active: number | null }) {
  const filled = active === null ? stages.length : active + 1;
  return (
    <div className="pg-product-record" aria-hidden="true">
      <div className="pg-product-record-head">
        <span className="pg-product-record-avatar">MM</span>
        <span className="pg-product-record-who">
          <b>Meera Menon</b>
          <small>Riverview Public School · 2026–27</small>
        </span>
        <span className="pg-product-record-count">
          {filled}/{stages.length}
        </span>
      </div>
      <ul className="pg-product-record-rows">
        {stages.map((stage, index) => (
          <RecordRow key={stage.title} stage={stage} state={stageState(index, active)} />
        ))}
      </ul>
      <p className="pg-product-record-foot">One record, entered once and never re-typed.</p>
    </div>
  );
}

function LifecycleRail() {
  const { active, track } = useActiveStage();
  return (
    <div className="pg-product-life">
      <ol className="pg-product-rail">
        {stages.map((stage, index) => (
          <StageItem key={stage.title} stage={stage} index={index} state={stageState(index, active)} track={track} />
        ))}
      </ol>
      <RecordCard active={active} />
    </div>
  );
}

export function LifecycleSection() {
  return (
    <Section id="lifecycle" labelledBy="lifecycle-title">
      <SectionIntro
        id="lifecycle-title"
        eyebrow="One school year"
        eyebrowIcon={RouteIcon}
        title="Work moves forward. Context moves with it."
        description="Follow one student, Meera, through a school year. Every stage starts with what the one before it already knows."
      />
      <LifecycleRail />
    </Section>
  );
}
