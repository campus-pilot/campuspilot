/**
 * DotsNetwork: the "everything connected" motif, drawn in clean /1/1 lines.
 * A hub sits in the centre with nodes on an ellipse around it; spokes draw
 * themselves when the diagram scrolls into view and small dots travel along them.
 *
 * - `<DotsNetwork mode="people" nodes? label? />`: the CampusPilot hub joined
 *   to school roles (Principal … Office staff), each with a short note. A node
 *   with `href` renders as a link (used on `/solutions`). Placement: home,
 *   `/product`, `/solutions`.
 * - `<DotsNetwork mode="ai" initialRole? label? />`: an assistant in the centre
 *   joined to school record areas. The hub cycles on its own through
 *   Principal / Class teacher / Accountant / Parent (see `RoleTicker`); the
 *   areas that role may reach light up in primary, the rest dim and show a
 *   lock, and a caption says what the assistant can reach. Placement:
 *   `/ai-ready` and home.
 *
 * Two geometries are rendered (landscape for wide screens, tall for phones)
 * and CSS shows the right one; node cards read matching `--wx/--wy` or
 * `--tx/--ty` percentages. Reduced motion: lines are simply drawn.
 */
import {
  Backpack,
  BadgeCheck,
  Bot,
  Building2,
  CalendarCheck,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  FileText,
  HeartHandshake,
  IndianRupee,
  Lock,
  Megaphone,
  PenLine,
  ScrollText,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { SrOnly, revealOnView } from "./shared";

/* ───────────── Geometry ───────────── */

type Layout = { w: number; h: number; rx: number; ry: number; bulge: number };

const wide: Layout = { w: 1000, h: 600, rx: 395, ry: 222, bulge: 46 };
const tall: Layout = { w: 400, h: 760, rx: 132, ry: 296, bulge: 28 };

/** Node `index` of `count`, clockwise from the top of the ellipse. */
function pointAt(layout: Layout, index: number, count: number) {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
  return { x: layout.w / 2 + layout.rx * Math.cos(angle), y: layout.h / 2 + layout.ry * Math.sin(angle) };
}

const round = (value: number) => Math.round(value * 10) / 10;

function spokePath(layout: Layout, index: number, count: number) {
  const end = pointAt(layout, index, count);
  return `M${layout.w / 2} ${layout.h / 2} L${round(end.x)} ${round(end.y)}`;
}

/** A shallow arc between two neighbouring nodes, bowed away from the hub. */
function peerPath(layout: Layout, from: number, to: number, count: number) {
  const a = pointAt(layout, from, count);
  const b = pointAt(layout, to, count);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const dx = mid.x - layout.w / 2;
  const dy = mid.y - layout.h / 2;
  const length = Math.hypot(dx, dy) || 1;
  const cx = mid.x + (dx / length) * layout.bulge;
  const cy = mid.y + (dy / length) * layout.bulge;
  return `M${round(a.x)} ${round(a.y)} Q${round(cx)} ${round(cy)} ${round(b.x)} ${round(b.y)}`;
}

/**
 * Nodes in the upper part of the ellipse put their label above the dot, so
 * spokes arriving from the hub never cross text.
 */
function isAbove(index: number, count: number) {
  return Math.sin(-Math.PI / 2 + (index * Math.PI * 2) / count) < -0.5;
}

function nodePosition(index: number, count: number) {
  const w = pointAt(wide, index, count);
  const t = pointAt(tall, index, count);
  return {
    "--wx": `${round((w.x / wide.w) * 100)}%`,
    "--wy": `${round((w.y / wide.h) * 100)}%`,
    "--tx": `${round((t.x / tall.w) * 100)}%`,
    "--ty": `${round((t.y / tall.h) * 100)}%`,
    "--i": index,
  } as React.CSSProperties;
}

/* ───────────── Lines ───────────── */

type LinesProps = {
  layout: Layout;
  count: number;
  /** Indexes whose spokes get the primary overlay. */
  lit: readonly number[];
  /** Indexes whose spokes carry a travelling dot. */
  pulses: readonly number[];
  /** Changing it remounts the overlay so the lit spokes draw in again. */
  litKey: string;
  peers?: readonly (readonly [number, number])[];
};

function NetworkLines({ layout, count, lit, pulses, litKey, peers = [] }: LinesProps) {
  const spokes = Array.from({ length: count }, (_, index) => index);
  return (
    <svg className={`cp-dots-lines cp-dots-lines-${layout === wide ? "wide" : "tall"}`} viewBox={`0 0 ${layout.w} ${layout.h}`} aria-hidden="true">
      {peers.map(([from, to], index) => (
        <path key={`${from}-${to}`} className="cp-dots-peer" pathLength={1} d={peerPath(layout, from, to, count)} style={{ "--i": index } as React.CSSProperties} />
      ))}
      {spokes.map((index) => (
        <path key={index} className="cp-dots-spoke" pathLength={1} d={spokePath(layout, index, count)} style={{ "--i": index } as React.CSSProperties} />
      ))}
      <g key={litKey}>
        {lit.map((index, order) => (
          <path key={index} className="cp-dots-lit" pathLength={1} d={spokePath(layout, index, count)} style={{ "--i": order } as React.CSSProperties} />
        ))}
        {pulses.map((index, order) => (
          <path key={`dot-${index}`} className="cp-dots-pulse" pathLength={1} d={spokePath(layout, index, count)} style={{ "--i": order } as React.CSSProperties} />
        ))}
      </g>
    </svg>
  );
}

function BothLines(props: Omit<LinesProps, "layout">) {
  return (
    <>
      <NetworkLines layout={wide} {...props} />
      <NetworkLines layout={tall} {...props} />
    </>
  );
}

/* ───────────── People mode ───────────── */

export type PeopleNode = {
  label: string;
  note: string;
  icon: LucideIcon;
  /** Turns the node into a link (e.g. the matching `/solutions/...` page). */
  href?: string;
};

export const peopleNodes: readonly PeopleNode[] = [
  { label: "Principal", note: "approves and sees it all", icon: ClipboardCheck },
  { label: "Management", note: "every campus, one view", icon: Building2 },
  { label: "Accounts", note: "fees, receipts, ledgers", icon: IndianRupee },
  { label: "Families", note: "receipts, results, notices", icon: HeartHandshake },
  { label: "Students", note: "timetables and results", icon: Backpack },
  { label: "Teachers", note: "marks for their classes", icon: PenLine },
  { label: "Exam cell", note: "plans to report cards", icon: ScrollText },
  { label: "Office staff", note: "admissions and records", icon: ClipboardList },
];

/** Neighbouring nodes in the lower half also hand work to each other (thin arcs). */
function lowerPeers(count: number) {
  return Array.from({ length: count }, (_, index) => [index, (index + 1) % count] as const).filter(
    ([from, to]) => !isAbove(from, count) && !isAbove(to, count),
  );
}

/** Dot + label + note. `badge` sits on the dot's corner (the AI mode's lock). */
function NodeFace({ icon: Icon, label, note, badge }: { icon: LucideIcon; label: string; note: string; badge?: React.ReactNode }) {
  return (
    <>
      <span className="cp-dots-dot"><Icon aria-hidden="true" />{badge}</span>
      <b>{label}</b>
      <small>{note}</small>
    </>
  );
}

function PeopleNodeItem({ node, index, count }: { node: PeopleNode; index: number; count: number }) {
  return (
    <li className="cp-dots-node" data-above={isAbove(index, count)} style={nodePosition(index, count)}>
      {node.href ? (
        <Link className="cp-dots-face cp-dots-face-link" to={node.href}>
          <NodeFace icon={node.icon} label={node.label} note={node.note} />
        </Link>
      ) : (
        <span className="cp-dots-face">
          <NodeFace icon={node.icon} label={node.label} note={node.note} />
        </span>
      )}
    </li>
  );
}

type HubProps = {
  dark?: boolean;
  title: string;
  icon?: LucideIcon;
  /** Second line under the title: a note, or (AI mode) the role picker. */
  children: React.ReactNode;
};

function Hub({ dark, title, icon, children }: HubProps) {
  const Icon = icon;
  return (
    <div className="cp-dots-hub" data-dark={dark ?? false}>
      {Icon ? <span className="cp-dots-hub-icon"><Icon aria-hidden="true" /></span> : <img src="/icon.svg" alt="" width={40} height={40} />}
      <b>{title}</b>
      {children}
    </div>
  );
}

function PeopleNetwork({ nodes = peopleNodes, label = "People CampusPilot connects" }: { nodes?: readonly PeopleNode[]; label?: string }) {
  const count = nodes.length;
  const all = nodes.map((_, index) => index);
  return (
    <div className="cp-dots" data-mode="people" ref={revealOnView}>
      <div className="cp-dots-stage">
        <BothLines count={count} lit={[]} pulses={all} litKey="people" peers={lowerPeers(count)} />
        <Hub title="CampusPilot">
          <small>one connected record</small>
        </Hub>
        <ul className="cp-dots-nodes" aria-label={label}>
          {nodes.map((node, index) => <PeopleNodeItem key={node.label} node={node} index={index} count={count} />)}
        </ul>
      </div>
    </div>
  );
}

/* ───────────── AI mode ───────────── */

type AreaId = "admissions" | "fees" | "marks" | "attendance" | "timetables" | "notices" | "staff" | "documents";

const areas: readonly { id: AreaId; label: string; icon: LucideIcon }[] = [
  { id: "admissions", label: "Admissions", icon: UserPlus },
  { id: "fees", label: "Fees & ledgers", icon: IndianRupee },
  { id: "marks", label: "Marks & results", icon: PenLine },
  { id: "attendance", label: "Attendance", icon: CalendarCheck },
  { id: "timetables", label: "Timetables", icon: CalendarDays },
  { id: "notices", label: "Notices", icon: Megaphone },
  { id: "staff", label: "Staff records", icon: BadgeCheck },
  { id: "documents", label: "Documents", icon: FileText },
];

export type AiRoleId = "principal" | "class-teacher" | "accountant" | "parent";

type AiRole = {
  id: AiRoleId;
  label: string;
  caption: string;
  /** Reachable areas with the scope shown under each; areas left out are locked. */
  access: Partial<Record<AreaId, string>>;
};

const aiRoles: readonly AiRole[] = [
  {
    id: "principal",
    label: "Principal",
    caption: "A principal's assistant reaches every record area across the school.",
    access: {
      admissions: "whole school",
      fees: "whole school",
      marks: "whole school",
      attendance: "whole school",
      timetables: "whole school",
      notices: "whole school",
      staff: "whole school",
      documents: "whole school",
    },
  },
  {
    id: "class-teacher",
    label: "Class teacher",
    caption: "A class teacher's assistant reaches only their assigned classes: marks, attendance, timetables and notices. No fees, no staff records.",
    access: {
      marks: "assigned classes",
      attendance: "assigned classes",
      timetables: "assigned classes",
      notices: "their classes",
    },
  },
  {
    id: "accountant",
    label: "Accountant",
    caption: "An accountant's assistant reaches fees, ledgers and receipts. Marks and staff records stay out of reach.",
    access: {
      fees: "all ledgers",
      documents: "receipts only",
    },
  },
  {
    id: "parent",
    label: "Parent",
    caption: "A parent's assistant reaches only their own child's results, fees, timetable and notices.",
    access: {
      marks: "own child only",
      fees: "own child only",
      timetables: "own child's class",
      notices: "own child's class",
    },
  },
];

/**
 * Muted "Role: …" line inside the Assistant hub, plus the autoplay clock: a
 * thin bar along the hub's bottom edge whose CSS fill animation
 * (`--cp-dots-autoplay` in `signature.css`) fires `animationend` to move to the
 * next role. Keyed by role, so it restarts each time. It runs only once the
 * network is in view, pauses while a mouse rests on the diagram, and never runs
 * under reduced motion, where the first role simply stays.
 */
function RoleTicker({ role, onAdvance }: { role: AiRole; onAdvance: () => void }) {
  return (
    <>
      <small className="cp-dots-role">
        Role: <span>{role.label}</span>
      </small>
      <span key={role.id} className="cp-dots-timer" aria-hidden="true" onAnimationEnd={onAdvance} />
    </>
  );
}

function AreaNode({ index, scope }: { index: number; scope: string | undefined }) {
  const area = areas[index];
  const reachable = scope !== undefined;
  return (
    <li className="cp-dots-node" data-above={isAbove(index, areas.length)} data-on={reachable} style={nodePosition(index, areas.length)}>
      <span className="cp-dots-face">
        <NodeFace icon={area.icon} label={area.label} note={scope ?? "no access"} badge={reachable ? null : <LockedMark />} />
        <SrOnly>{reachable ? "(reachable)" : "(locked)"}</SrOnly>
      </span>
    </li>
  );
}

function LockedMark() {
  return <Lock className="cp-dots-lock" aria-hidden="true" />;
}

function AiNetwork({ initialRole = "class-teacher", label = "School record areas the assistant can reach" }: { initialRole?: AiRoleId; label?: string }) {
  const [roleId, setRoleId] = useState<AiRoleId>(initialRole);
  const role = aiRoles.find((candidate) => candidate.id === roleId) ?? aiRoles[0];

  function advance() {
    setRoleId((current) => aiRoles[(aiRoles.findIndex((candidate) => candidate.id === current) + 1) % aiRoles.length].id);
  }

  const lit = areas.flatMap((area, index) => (role.access[area.id] !== undefined ? [index] : []));
  return (
    <div className="cp-dots" data-mode="ai" ref={revealOnView}>
      <div className="cp-dots-stage">
        <BothLines count={areas.length} lit={lit} pulses={lit} litKey={roleId} />
        <Hub dark title="Assistant" icon={Bot}>
          <RoleTicker role={role} onAdvance={advance} />
        </Hub>
        <ul className="cp-dots-nodes" aria-label={label}>
          {areas.map((area, index) => <AreaNode key={area.id} index={index} scope={role.access[area.id]} />)}
        </ul>
      </div>
      {/* Not a live region: the role changes on its own every few seconds and would chatter. */}
      <p className="cp-dots-caption">{role.caption}</p>
    </div>
  );
}

/* ───────────── Public component ───────────── */

export type DotsNetworkProps =
  | { mode: "people"; nodes?: readonly PeopleNode[]; label?: string }
  | { mode: "ai"; initialRole?: AiRoleId; label?: string };

export function DotsNetwork(props: DotsNetworkProps) {
  if (props.mode === "ai") return <AiNetwork initialRole={props.initialRole} label={props.label} />;
  return <PeopleNetwork nodes={props.nodes} label={props.label} />;
}
