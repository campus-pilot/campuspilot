/**
 * EventStream: everyday school events flow in from the left, pass through the
 * CampusPilot core ("Organised → Connected → Permission-checked") and leave on
 * the right as finished work.
 *
 * - `EventStream` ({ variant?: "full" | "compact", label? }):
 *   `full` (4 lanes, 8 events each side) for `/product`;
 *   `compact` (2 lanes, 4 each side, shorter) for home.
 * - `EventStreamSection` ({ id?, eyebrow?, title?, description?, variant?, children? }):
 *   a `cp-section` with a `SectionIntro`; `children` render under the stream.
 *
 * The stage is one labelled image. With reduced motion every lane becomes a
 * static, wrapped list of chips (see `signature.css`).
 */
import {
  BookOpenCheck,
  Bot,
  CalendarCheck,
  FileText,
  IdCard,
  IndianRupee,
  LayoutDashboard,
  Link2,
  Megaphone,
  MessageSquareText,
  PenLine,
  Receipt,
  ReceiptText,
  ShieldCheck,
  Ticket,
  UserPlus,
  Waypoints,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import { Section, SectionIntro } from "@/site/ui/section";

import { stagger } from "./shared";

type StreamItem = { icon: LucideIcon; label: string; meta: string };

/** Everyday school events entering the system. */
const inbound: readonly StreamItem[] = [
  { icon: UserPlus, label: "Admission enquiry", meta: "UKG · Diya Iyer" },
  { icon: IndianRupee, label: "Fee payment", meta: "₹12,500 · Class 8 A" },
  { icon: CalendarCheck, label: "Attendance marked", meta: "Class 3 B · 32 of 34" },
  { icon: PenLine, label: "Marks entered", meta: "Science · First Term" },
  { icon: Receipt, label: "Receipt request", meta: "Parent · Kabir Singh" },
  { icon: MessageSquareText, label: "Report card request", meta: "Parent · Class 5 A" },
  { icon: Bot, label: "Teacher asks AI", meta: "“Whose marks are pending?”" },
  { icon: Megaphone, label: "Notice drafted", meta: "PTM · Saturday" },
];

/** Finished outcomes leaving the system. */
const outbound: readonly StreamItem[] = [
  { icon: IdCard, label: "Student record", meta: "Admission no. 2025016" },
  { icon: ReceiptText, label: "Receipt issued", meta: "RCP-2026-0418" },
  { icon: BookOpenCheck, label: "Ledger updated", meta: "Balance ₹0 due" },
  { icon: FileText, label: "Report card", meta: "Ready for approval" },
  { icon: LayoutDashboard, label: "Dashboard", meta: "42.96% realized" },
  { icon: Ticket, label: "Admit cards", meta: "Class 10 · 64 generated" },
  { icon: ShieldCheck, label: "AI answer", meta: "Scoped to 8 A only" },
  { icon: Megaphone, label: "Notice published", meta: "Families of Class 5" },
];

/** Positions of the events/outcomes that the compact variant keeps (pairs still line up). */
const compactPicks = [0, 1, 3, 6] as const;

type Variant = "full" | "compact";

const variants: Record<Variant, { lanes: number; inbound: readonly StreamItem[]; outbound: readonly StreamItem[] }> = {
  full: { lanes: 4, inbound, outbound },
  compact: {
    lanes: 2,
    inbound: compactPicks.map((index) => inbound[index]),
    outbound: compactPicks.map((index) => outbound[index]),
  },
};

/** Seconds one chip needs to cross its lane; delays are negative so the stream starts full. */
const CROSSING_SECONDS = 9;

const DEFAULT_LABEL =
  "Animation: school events such as admission enquiries, fee payments and marks stream into CampusPilot, are organised, connected and permission-checked, and come out as receipts, ledgers, report cards, notices, dashboards and permission-aware AI answers.";

type EventStreamProps = { variant?: Variant; label?: string };

export function EventStream({ variant = "full", label = DEFAULT_LABEL }: EventStreamProps) {
  const config = variants[variant];
  return (
    <div className="cp-es" data-variant={variant} role="img" aria-label={label}>
      <StreamZone items={config.inbound} lanes={config.lanes} direction="in" title="The school day" />
      <StreamCore />
      <StreamZone items={config.outbound} lanes={config.lanes} direction="out" title="Finished work" />
    </div>
  );
}

type Direction = "in" | "out";

function StreamZone({ items, lanes, direction, title }: { items: readonly StreamItem[]; lanes: number; direction: Direction; title: string }) {
  const grouped = Array.from({ length: lanes }, (_, lane) => items.filter((_, index) => index % lanes === lane));
  return (
    <div className="cp-es-zone" data-direction={direction}>
      <p className="cp-es-zone-title">{title}</p>
      {grouped.map((laneItems, lane) => (
        <StreamLane key={lane} items={laneItems} lane={lane} direction={direction} />
      ))}
    </div>
  );
}

/**
 * Each chip runs the same keyframes; a negative `animation-delay` spreads chips
 * across the lane so the stream is already populated on first paint. Outbound
 * lanes are offset by half a crossing so outcomes visibly follow the events.
 */
function StreamLane({ items, lane, direction }: { items: readonly StreamItem[]; lane: number; direction: Direction }) {
  const offset = direction === "out" ? CROSSING_SECONDS / 2 : 0;
  return (
    <div className="cp-es-lane">
      {items.map((item, index) => {
        const delay = -((lane * 2.1 + index * (CROSSING_SECONDS / items.length) + offset) % CROSSING_SECONDS);
        return <StreamChip key={item.label} item={item} delay={delay} />;
      })}
    </div>
  );
}

function StreamChip({ item, delay }: { item: StreamItem; delay: number }) {
  const Icon = item.icon;
  return (
    <span className="cp-es-chip" style={{ animationDelay: `${delay}s` }}>
      <span className="cp-es-chip-icon"><Icon /></span>
      <span className="cp-es-chip-text"><b>{item.label}</b><small>{item.meta}</small></span>
    </span>
  );
}

const coreSteps = [
  [Waypoints, "Organised"],
  [Link2, "Connected"],
  [ShieldCheck, "Permission-checked"],
] as const;

function StreamCore() {
  return (
    <div className="cp-es-core">
      <span className="cp-es-ring" />
      <span className="cp-es-logo"><img src="/icon.svg" alt="" width={40} height={40} /></span>
      <b className="cp-es-name">CampusPilot</b>
      <ul className="cp-es-steps">
        {coreSteps.map(([Icon, text], index) => (
          <li key={text} style={stagger(index)}><Icon />{text}</li>
        ))}
      </ul>
    </div>
  );
}

type EventStreamSectionProps = EventStreamProps & {
  id?: string;
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Rendered under the stream (e.g. a page's own reason cards). */
  children?: React.ReactNode;
};

export function EventStreamSection({
  id = "event-stream",
  eyebrow = "Why CampusPilot",
  title = "The whole school day comes in. Finished work goes out.",
  description = "Every enquiry, payment and mark is taken in once, organised, connected to the right student and checked against who may see it, then turned into the receipts, ledgers, report cards and answers people were waiting for.",
  variant,
  label,
  children,
}: EventStreamSectionProps) {
  const headingId = `${id}-title`;
  return (
    <Section id={id} labelledBy={headingId}>
      <SectionIntro id={headingId} eyebrow={eyebrow} eyebrowIcon={Workflow} title={title} description={description} />
      <EventStream variant={variant} label={label} />
      {children}
    </Section>
  );
}
