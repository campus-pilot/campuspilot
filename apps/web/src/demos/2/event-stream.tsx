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
  Repeat2,
  ShieldCheck,
  Sparkles,
  Ticket,
  UserPlus,
  Waypoints,
} from "lucide-react";

type StreamItem = { icon: typeof Bot; label: string; meta: string };

/** Everyday school events entering the system. Two per lane, four lanes. */
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

const LANES = 4;
/** Seconds one chip needs to cross its zone; delays are negative so the stream starts full. */
const CROSSING_SECONDS = 9;

export function EventStreamSection() {
  return (
    <section className="d2-section d2-why" id="d2-why" aria-labelledby="d2-why-title">
      <div className="d2-container">
        <header className="d2-section-head">
          <p className="d2-kicker">Why choose CampusPilot</p>
          <h2 id="d2-why-title" className="d2-section-title">The whole school day comes in.<br /><em>Finished work goes out.</em></h2>
          <p className="d2-section-lead">
            Every enquiry, payment and mark is taken in once, organised, connected to the right
            student and checked against who is allowed to see it — then turned into the receipts,
            ledgers, report cards and answers people were waiting for.
          </p>
        </header>
        <StreamStage />
        <ReasonGrid />
      </div>
    </section>
  );
}

function StreamStage() {
  return (
    <div
      className="d2-stage"
      role="img"
      aria-label="Animation: school events such as admission enquiries, fee payments and marks stream into CampusPilot and come out as receipts, ledgers, report cards, notices, dashboards and permission-aware AI answers."
    >
      <StreamZone items={inbound} direction="in" title="The school day" />
      <StreamCore />
      <StreamZone items={outbound} direction="out" title="Finished work" />
    </div>
  );
}

function StreamZone({ items, direction, title }: { items: readonly StreamItem[]; direction: "in" | "out"; title: string }) {
  const lanes = Array.from({ length: LANES }, (_, lane) => items.filter((_, index) => index % LANES === lane));
  return (
    <div className="d2-zone" data-direction={direction} aria-hidden="true">
      <p className="d2-zone-title">{title}</p>
      {lanes.map((laneItems, lane) => (
        <StreamLane key={lane} items={laneItems} lane={lane} direction={direction} />
      ))}
    </div>
  );
}

/**
 * Each chip runs the same keyframes; a negative `animation-delay` spreads chips across the
 * lane so the stream is already populated on first paint. Outbound lanes are offset by half
 * a crossing so outcomes visibly follow the events.
 */
function StreamLane({ items, lane, direction }: { items: readonly StreamItem[]; lane: number; direction: "in" | "out" }) {
  const offset = direction === "out" ? CROSSING_SECONDS / 2 : 0;
  return (
    <div className="d2-lane">
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
    <span className="d2-chip" style={{ animationDelay: `${delay}s` }}>
      <span className="d2-chip-icon"><Icon /></span>
      <span className="d2-chip-text"><b>{item.label}</b><small>{item.meta}</small></span>
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
    <div className="d2-core" aria-hidden="true">
      <span className="d2-core-ring" />
      <span className="d2-core-logo"><img src="/icon.svg" alt="" width={36} height={36} /></span>
      <b className="d2-core-name">CampusPilot</b>
      <ul className="d2-core-steps">
        {coreSteps.map(([Icon, label], index) => (
          <li key={label} style={{ "--i": index } as React.CSSProperties}><Icon />{label}</li>
        ))}
      </ul>
    </div>
  );
}

const reasons = [
  {
    icon: Repeat2,
    title: "Done once, flows on",
    body: "A payment recorded at the counter updates the receipt, the ledger and the dashboard. No re-typing into registers.",
  },
  {
    icon: Link2,
    title: "One clean source of truth",
    body: "Admissions, classes, fees and exams share the same student record, session after session.",
  },
  {
    icon: ShieldCheck,
    title: "Only the right people see it",
    body: "Role, campus and classroom permissions decide what each principal, accountant, teacher or family sees.",
  },
  {
    icon: Sparkles,
    title: "AI-ready on your real data",
    body: "Works with the AI assistants your team already uses — answering from live records, within that person's access.",
  },
] as const;

function ReasonGrid() {
  return (
    <ul className="d2-reasons">
      {reasons.map(({ icon: Icon, title, body }) => (
        <li key={title} className="d2-reason">
          <span className="d2-icon-tile"><Icon aria-hidden="true" /></span>
          <h3>{title}</h3>
          <p>{body}</p>
        </li>
      ))}
    </ul>
  );
}
