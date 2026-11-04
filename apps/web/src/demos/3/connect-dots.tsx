import {
  Backpack,
  Building2,
  ClipboardCheck,
  ClipboardList,
  HeartHandshake,
  IndianRupee,
  PenLine,
  ScrollText,
  type LucideIcon,
} from "lucide-react";

import { DoodleArrow, ScribbleCircle, Tape, revealOnView } from "./doodles";

type Role = { label: string; note: string; icon: LucideIcon };

/** Clockwise from the top of the diagram. The order decides which neighbours get a peer line. */
const roles: readonly Role[] = [
  { label: "Principal", note: "approves & sees it all", icon: ClipboardCheck },
  { label: "Management", note: "every campus, one view", icon: Building2 },
  { label: "Accounts", note: "fees, receipts, ledgers", icon: IndianRupee },
  { label: "Families", note: "receipts, results, notices", icon: HeartHandshake },
  { label: "Students", note: "timetables & results", icon: Backpack },
  { label: "Teachers", note: "marks for their classes", icon: PenLine },
  { label: "Exam cell", note: "plans to report cards", icon: ScrollText },
  { label: "Office staff", note: "admissions & records", icon: ClipboardList },
];

/**
 * Neighbouring roles that also hand work directly to each other (drawn as orange arcs).
 * The top roles are skipped on purpose: their labels sit above the dot, where an outward arc would cross them.
 */
const peerPairs = [[2, 3], [3, 4], [4, 5], [5, 6], [6, 7]] as const;

type Layout = { w: number; h: number; rx: number; ry: number; bulge: number };

/**
 * Two geometries for the same diagram: a landscape ellipse for wide screens and
 * a tall one for phones. Both SVGs are rendered and CSS shows the right one;
 * the HTML role cards read matching `--wx/--wy` or `--tx/--ty` percentages.
 */
const wide: Layout = { w: 1000, h: 600, rx: 395, ry: 222, bulge: 58 };
const tall: Layout = { w: 400, h: 760, rx: 132, ry: 296, bulge: 34 };

function pointAt(layout: Layout, index: number) {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / roles.length;
  return { x: layout.w / 2 + layout.rx * Math.cos(angle), y: layout.h / 2 + layout.ry * Math.sin(angle) };
}

const round = (value: number) => Math.round(value * 10) / 10;

/** A spoke from the hub to a role, bent slightly (alternating sides) so it reads as hand-drawn. */
function spokePath(layout: Layout, index: number) {
  const start = { x: layout.w / 2, y: layout.h / 2 };
  const end = pointAt(layout, index);
  const bend = (index % 2 === 0 ? 1 : -1) * 0.09;
  const cx = (start.x + end.x) / 2 - (end.y - start.y) * bend;
  const cy = (start.y + end.y) / 2 + (end.x - start.x) * bend;
  return `M${round(start.x)} ${round(start.y)} Q${round(cx)} ${round(cy)} ${round(end.x)} ${round(end.y)}`;
}

/** An arc between two neighbouring roles, bowed away from the hub. */
function peerPath(layout: Layout, from: number, to: number) {
  const a = pointAt(layout, from);
  const b = pointAt(layout, to);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const dx = mid.x - layout.w / 2;
  const dy = mid.y - layout.h / 2;
  const length = Math.hypot(dx, dy) || 1;
  const cx = mid.x + (dx / length) * layout.bulge;
  const cy = mid.y + (dy / length) * layout.bulge;
  return `M${round(a.x)} ${round(a.y)} Q${round(cx)} ${round(cy)} ${round(b.x)} ${round(b.y)}`;
}

function percent(value: number, total: number) {
  return `${round((value / total) * 100)}%`;
}

function DiagramLines({ layout, className }: { layout: Layout; className: string }) {
  return (
    <svg className={`d3-dots-lines ${className}`} viewBox={`0 0 ${layout.w} ${layout.h}`} aria-hidden="true">
      <g className="d3-pencil-art">
        {roles.map((role, index) => (
          <path key={role.label} className="d3-spoke" pathLength={1} d={spokePath(layout, index)} style={{ "--i": index } as React.CSSProperties} />
        ))}
        {roles.map((role, index) => (
          <path key={`pulse-${role.label}`} className="d3-pulse" pathLength={1} d={spokePath(layout, index)} style={{ "--i": index } as React.CSSProperties} />
        ))}
        {peerPairs.map(([from, to], index) => (
          <path key={`${from}-${to}`} className="d3-peer" pathLength={1} d={peerPath(layout, from, to)} style={{ "--i": index } as React.CSSProperties} />
        ))}
      </g>
    </svg>
  );
}

function RoleNode({ role, index }: { role: Role; index: number }) {
  const w = pointAt(wide, index);
  const t = pointAt(tall, index);
  const Icon = role.icon;
  const position = {
    "--wx": percent(w.x, wide.w),
    "--wy": percent(w.y, wide.h),
    "--tx": percent(t.x, tall.w),
    "--ty": percent(t.y, tall.h),
    "--i": index,
  } as React.CSSProperties;
  return (
    <li className="d3-node" style={position}>
      <span className="d3-node-number d3-hand" aria-hidden="true">{index + 1}</span>
      <span className="d3-node-dot"><Icon aria-hidden="true" strokeWidth={1.8} /></span>
      <b>{role.label}</b>
      <span className="d3-node-note d3-hand">{role.note}</span>
    </li>
  );
}

function Hub() {
  return (
    <div className="d3-hub">
      <img src="/icon.svg" alt="" width={44} height={44} />
      <b>CampusPilot</b>
      <span className="d3-hand">one place for everything</span>
    </div>
  );
}

/**
 * The centrepiece: every role in a school joined to one hub, plus the direct
 * hand-offs between neighbours. Lines "draw themselves" once the diagram scrolls
 * into view (see `revealOnView`); with reduced motion they are simply drawn.
 */
function DotsDiagram() {
  return (
    <div className="d3-dots" ref={revealOnView}>
      <DiagramLines layout={wide} className="d3-dots-wide" />
      <DiagramLines layout={tall} className="d3-dots-tall" />
      <Hub />
      <ul className="d3-dots-roles" aria-label="People CampusPilot connects">
        {roles.map((role, index) => <RoleNode key={role.label} role={role} index={index} />)}
      </ul>
      <p className="d3-dots-margin d3-hand" aria-hidden="true">
        every line = one less register, phone call or re-typed sheet
        <DoodleArrow />
      </p>
    </div>
  );
}

const flows = [
  {
    steps: ["Admission", "student record", "class seat", "fee account"],
    body: "Enter a student once at admission. Their class, fee account and documents follow — nobody re-types the form.",
  },
  {
    steps: ["Marks", "approval", "report card", "family"],
    body: "Teachers enter marks for their own classes, the principal approves, and report cards come from the same record.",
  },
  {
    steps: ["Payment", "receipt", "ledger", "dashboard"],
    body: "The counter records a payment; the receipt is issued, the ledger updates and management sees collections live.",
  },
] as const;

function FlowNote({ steps, body, index }: { steps: readonly string[]; body: string; index: number }) {
  return (
    <li className="d3-sticky d3-flow" style={{ "--i": index } as React.CSSProperties}>
      <Tape className="d3-tape-top" />
      <p className="d3-flow-steps d3-hand">{steps.join(" → ")}</p>
      <p>{body}</p>
    </li>
  );
}

function ConnectIntro() {
  return (
    <header className="d3-section-head" ref={revealOnView}>
      <p className="d3-chapter d3-hand">chapter 1</p>
      <h2 id="d3-connect-title">
        Connect the <span className="d3-nowrap"><span className="d3-circled">dots<ScribbleCircle /></span>.</span>
      </h2>
      <p>
        Most schools still run on registers, spreadsheets, phone calls and memory. Every hand-over is a place where
        work gets repeated — or lost. CampusPilot puts everyone on the same page.
      </p>
    </header>
  );
}

export function ConnectDots() {
  return (
    <section id="connect" className="d3-section d3-connect" aria-labelledby="d3-connect-title">
      <div className="d3-wrap">
        <ConnectIntro />
        <DotsDiagram />
        <ol className="d3-flows" ref={revealOnView} aria-label="Work that flows on by itself">
          {flows.map((flow, index) => <FlowNote key={flow.steps[0]} steps={flow.steps} body={flow.body} index={index} />)}
        </ol>
      </div>
    </section>
  );
}
