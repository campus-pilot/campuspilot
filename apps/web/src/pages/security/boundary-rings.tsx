import { Check, CircleDot, Minus, User } from "lucide-react";
import { useState } from "react";

import { Section, SectionIntro } from "@/site/ui/section";

type RingId = "group" | "campus" | "role" | "class" | "student";

type Ring = {
  id: RingId;
  label: string;
  summary: string;
  keepsIn: readonly string[];
  keepsOut: readonly string[];
  example: string;
};

/** Outermost first. The order is also the visual nesting and the arrow-key order. */
const rings: readonly Ring[] = [
  {
    id: "group",
    label: "School group",
    summary: "Your trust or group of schools is its own space in CampusPilot. Nothing crosses into another organisation.",
    keepsIn: ["Every campus your group runs", "A group-wide view for management, when you choose to give it"],
    keepsOut: ["Every other school and group on CampusPilot"],
    example: "Riverview Education Trust compares fee collection across its three campuses. No other school's records ever appear, and theirs never appear anywhere else.",
  },
  {
    id: "campus",
    label: "Campus",
    summary: "Each campus keeps its own sessions, classes, students, staff, fee settings, templates and branding.",
    keepsIn: ["That campus's sessions, classes and students", "Its own fee structures, receipts and templates"],
    keepsOut: ["Other campuses' records, unless someone is given access there too"],
    example: "An accountant at the Whitefield campus records payments there. Jayanagar's ledgers stay out of view.",
  },
  {
    id: "role",
    label: "Role",
    summary: "What a person can open follows the job they do: administration, accounts, the exam cell or teaching.",
    keepsIn: ["The areas their work needs, such as fees for accounts or results for the exam cell"],
    keepsOut: ["Areas outside their responsibility"],
    example: "The exam coordinator manages marks and report cards but does not record fee payments.",
  },
  {
    id: "class",
    label: "Class & section",
    summary: "A teacher's academic work can be limited to the classes and sections assigned to them.",
    keepsIn: ["Marks, attendance and exam work for their assigned sections"],
    keepsOut: ["Sections taught by someone else"],
    example: "Ms. Anjali Rao enters Science marks for 8 A and 8 B. 8 C stays with its own teacher.",
  },
  {
    id: "student",
    label: "Student",
    summary: "Students and families sign in separately from staff and see only that student's own information.",
    keepsIn: ["Their own results, timetable, fee ledger and notices"],
    keepsOut: ["Every other student's records, including classmates'"],
    example: "Aarav's family sees his receipts and report card, never a classmate's.",
  },
];

/** Ring radii in the 400 × 400 viewBox, outermost first (same order as `rings`). */
const RADII = [194, 156, 118, 80, 42] as const;

type RingState = "active" | "inside" | "outside";

function ringState(index: number, activeIndex: number): RingState {
  if (index === activeIndex) return "active";
  return index > activeIndex ? "inside" : "outside";
}

/**
 * Concentric circles (decorative). Circles inside the selected boundary stay
 * solid, those outside turn dashed and faint. The keyed pulse circle remounts
 * on every selection so its ripple replays without an effect.
 */
function RingsArt({ activeIndex }: { activeIndex: number }) {
  return (
    <svg className="pg-sec-rings-art" viewBox="0 0 400 400" aria-hidden="true">
      {RADII.map((radius, index) => (
        <circle key={radius} cx="200" cy="200" r={radius} data-state={ringState(index, activeIndex)} />
      ))}
      <circle key={activeIndex} className="pg-sec-rings-pulse" cx="200" cy="200" r={RADII[activeIndex]} />
    </svg>
  );
}

/** Ring labels sit on the top edge of their circle; `--y` is that edge as a % of the diagram height. */
function labelPosition(index: number) {
  return { "--y": `${((200 - RADII[index]) / 400) * 100}%` } as React.CSSProperties;
}

/**
 * Up/Left and Down/Right move the selection (and focus) between rings, Home
 * and End jump to the outermost and innermost. Tab still reaches every button.
 */
function useRingKeys(activeIndex: number, onSelect: (index: number) => void) {
  return (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[event.key];
    const target = event.key === "Home" ? 0 : event.key === "End" ? rings.length - 1 : step === undefined ? null : activeIndex + step;
    if (target === null || target < 0 || target >= rings.length) return;
    event.preventDefault();
    onSelect(target);
    event.currentTarget.querySelectorAll("button")[target]?.focus();
  };
}

function RingButtons({ activeIndex, onSelect }: { activeIndex: number; onSelect: (index: number) => void }) {
  const onKeyDown = useRingKeys(activeIndex, onSelect);
  return (
    <div className="pg-sec-ring-buttons" role="group" aria-label="Choose a boundary" onKeyDown={onKeyDown}>
      {rings.map((ring, index) => (
        <button
          key={ring.id}
          type="button"
          aria-pressed={index === activeIndex}
          data-state={ringState(index, activeIndex)}
          style={labelPosition(index)}
          onClick={() => onSelect(index)}
        >
          {ring.label}
        </button>
      ))}
    </div>
  );
}

function RingsDiagram({ activeIndex, onSelect }: { activeIndex: number; onSelect: (index: number) => void }) {
  return (
    <div className="pg-sec-diagram">
      <RingsArt activeIndex={activeIndex} />
      <span className="pg-sec-diagram-core" aria-hidden="true"><User /></span>
      <RingButtons activeIndex={activeIndex} onSelect={onSelect} />
    </div>
  );
}

function BoundaryList({ kind, items }: { kind: "in" | "out"; items: readonly string[] }) {
  const Icon = kind === "in" ? Check : Minus;
  return (
    <div className="pg-sec-keeps" data-kind={kind}>
      <h4>{kind === "in" ? "Keeps in" : "Keeps out"}</h4>
      <ul>
        {items.map((item) => (
          <li key={item}><Icon aria-hidden="true" />{item}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Explanation for the selected ring. The live region itself stays mounted so
 * screen readers announce each new boundary; the inner body is keyed by ring
 * so its fade-in replays on every selection.
 */
function RingDetail({ ring, index }: { ring: Ring; index: number }) {
  return (
    <div className="pg-sec-detail" aria-live="polite">
      <div key={ring.id} className="pg-sec-detail-body">
        <small className="pg-sec-detail-step">Boundary {index + 1} of {rings.length}</small>
        <h3>{ring.label}</h3>
        <p className="pg-sec-detail-summary">{ring.summary}</p>
        <div className="pg-sec-keeps-row">
          <BoundaryList kind="in" items={ring.keepsIn} />
          <BoundaryList kind="out" items={ring.keepsOut} />
        </div>
        <p className="pg-sec-example"><CircleDot aria-hidden="true" /><span><b>Illustrative example.</b> {ring.example}</span></p>
      </div>
    </div>
  );
}

/**
 * Nested boundary rings: School group → Campus → Role → Class & section →
 * Student. Selecting a ring (buttons with `aria-pressed`, arrow keys supported)
 * explains what that boundary keeps in and out, with an illustrative example.
 */
export function BoundaryRingsSection() {
  const [activeIndex, setActiveIndex] = useState(3);
  const ring = rings[activeIndex];
  return (
    <Section id="boundaries" labelledBy="pg-sec-rings-title" className="pg-sec-rings-section">
      <SectionIntro
        id="pg-sec-rings-title"
        eyebrow="Five boundaries"
        eyebrowIcon={CircleDot}
        title="Boundaries inside boundaries."
        description="Access in CampusPilot is shaped by five nested boundaries. Pick one to see what it keeps in and what it keeps out."
      />
      <div className="pg-sec-rings">
        <RingsDiagram activeIndex={activeIndex} onSelect={setActiveIndex} />
        <RingDetail ring={ring} index={activeIndex} />
      </div>
    </Section>
  );
}
