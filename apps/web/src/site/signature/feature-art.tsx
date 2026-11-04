/**
 * Feature artworks: small animated, illustrative product-UI scenes in the /1/1
 * light style (white cards on a soft dotted plate, ink text, primary accents).
 *
 * Each artwork is self-contained and framed, so it works in three places:
 * - inside `WorkflowTabs` (Admissions, Fees, Exams, Documents, AI-ready panels),
 * - as a feature page hero visual: `<PageHero visual={<FeesArt />} />`,
 * - looked up by slug through `featureArt[slug]` on `/features/:slug`.
 *
 * Props: `label?: string`. Without it the art is decorative (`aria-hidden`);
 * with it the art becomes one labelled image (`role="img"`).
 *
 * Motion: children with `.cp-wt-rise` rise in (staggered by `--i`) whenever the
 * art is mounted or un-hidden, so tab switches replay them. Base styles are the
 * finished state; reduced motion simply shows the finished scene.
 */
import {
  BadgeCheck,
  BellRing,
  BookOpen,
  Bot,
  CalendarDays,
  Check,
  Clock3,
  IdCard,
  Layers3,
  Lock,
  Printer,
  ShieldCheck,
  Sparkles,
  Stamp,
  UserRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType } from "react";

import type { FeatureSlug } from "@/site/content/catalog";

import { artA11y, stagger } from "./shared";

export type ArtProps = {
  /** Accessible description; omit to keep the artwork decorative. */
  label?: string;
};

function ArtFrame({ name, label, children }: { name: string; label?: string; children: React.ReactNode }) {
  return (
    <div className={`cp-wt-art cp-wt-art-${name}`} {...artA11y(label)}>
      {children}
    </div>
  );
}

/* ───────────── Admissions ───────────── */

const admissionSteps = ["Enquiry", "Registration", "Class allocation", "Student record"];

const admissionRows = [
  ["Diya Iyer", "2025016", "UKG B", "Suresh Iyer"],
  ["Aarav Sharma", "2025015", "Class 8 A", "Rajesh Sharma"],
  ["Kabir Singh", "2025014", "Class 3 A", "Harpreet Singh"],
  ["Meera Nair", "2025013", "LKG A", "Anil Nair"],
] as const;

/** The four steps light up in turn on a CSS loop (`cp-wt-step-on`). */
function StepTrack({ steps }: { steps: readonly string[] }) {
  return (
    <ol className="cp-wt-steps cp-wt-rise" style={stagger(1)}>
      {steps.map((step, index) => (
        <li key={step} style={{ "--step": index, "--steps": steps.length } as React.CSSProperties}>
          <span className="cp-wt-step-dot" />
          {step}
        </li>
      ))}
    </ol>
  );
}

function AdmissionsTable() {
  return (
    <div className="cp-wt-card cp-wt-table cp-wt-rise" style={stagger(2)}>
      <p className="cp-wt-card-head">
        <b>Admissions</b>
        <span>85 · 83 registered</span>
      </p>
      <div className="cp-wt-row cp-wt-row-head">
        <span>Name</span>
        <span>Admission no.</span>
        <span>Class</span>
        <span>Father's name</span>
      </div>
      {admissionRows.map((row, index) => (
        <div className="cp-wt-row" data-new={index === 0} key={row[1]} style={stagger(index + 3)}>
          {row.map((cell) => (
            <span key={cell}>{cell}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Enquiry → registration → class → student record, with the new record arriving at the top. */
export function AdmissionsArt({ label }: ArtProps) {
  return (
    <ArtFrame name="admissions" label={label}>
      <StepTrack steps={admissionSteps} />
      <AdmissionsTable />
    </ArtFrame>
  );
}

/* ───────────── Fees & receipts ───────────── */

/** Billed − discounts = payments + due (₹4,72,247 − ₹19,341 = ₹2,02,878 + ₹2,50,028). */
const billingTiles = [
  ["Billed", "₹4,72,247", "neutral"],
  ["Payments", "₹2,02,878", "good"],
  ["Discounts", "₹19,341", "neutral"],
  ["Due", "₹2,50,028", "due"],
] as const;

function BillingTiles() {
  return (
    <ul className="cp-wt-tiles cp-wt-rise" style={stagger(1)}>
      {billingTiles.map(([label, value, tone]) => (
        <li key={label} data-tone={tone}>
          <small>{label}</small>
          <b>{value}</b>
        </li>
      ))}
    </ul>
  );
}

function ReceiptCard() {
  return (
    <div className="cp-wt-receipt cp-wt-rise" style={stagger(2)}>
      <p className="cp-wt-receipt-head">
        <b>Fee receipt</b>
        <span>RCP-2026-0418</span>
      </p>
      <p className="cp-wt-line"><span>Tuition · Term 2</span><b>₹10,500</b></p>
      <p className="cp-wt-line"><span>Transport · Term 2</span><b>₹2,000</b></p>
      <p className="cp-wt-line cp-wt-line-total"><span>Total paid</span><b>₹12,500</b></p>
      <p className="cp-wt-receipt-foot"><Printer /> Ready to print</p>
      <span className="cp-wt-stamp"><Stamp /> Paid</span>
    </div>
  );
}

const ledgerLines = [
  ["Term 2 bill", "+₹12,500"],
  ["Payment", "−₹12,500"],
  ["Balance", "₹0"],
] as const;

function LedgerCard() {
  return (
    <div className="cp-wt-card cp-wt-ledger cp-wt-rise" style={stagger(3)}>
      <p className="cp-wt-card-head cp-wt-card-head-stack">
        <b>Student ledger</b>
        <span>Aarav Sharma · 8 A</span>
      </p>
      <ul>
        {ledgerLines.map(([label, amount], index) => (
          <li key={label} style={stagger(index + 4)}>
            <span>{label}</span>
            <b>{amount}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Session billing tiles, a stamped receipt and the ledger it updated. */
export function FeesArt({ label }: ArtProps) {
  return (
    <ArtFrame name="fees" label={label}>
      <BillingTiles />
      <div className="cp-wt-split">
        <ReceiptCard />
        <LedgerCard />
      </div>
    </ArtFrame>
  );
}

/* ───────────── Examinations ───────────── */

const exams = [
  ["First Term Examination", "8 classes · 45 subject plans", "Completed", "done"],
  ["Second Term Examination", "8 classes · marks entry open", "In progress", "live"],
  ["Annual Examination", "Timetable drafted", "Planned", "planned"],
] as const;

const marks = [
  ["Riya D.", 92],
  ["Arjun S.", 78],
  ["Kavya N.", 85],
  ["Rohan T.", 96],
] as const;

function ExamList() {
  return (
    <ul className="cp-wt-exams cp-wt-rise" style={stagger(1)}>
      {exams.map(([name, detail, status, tone]) => (
        <li key={name} data-tone={tone}>
          <span>
            <b>{name}</b>
            <small>{detail}</small>
          </span>
          <em>{status}</em>
        </li>
      ))}
    </ul>
  );
}

function MarksCard() {
  return (
    <div className="cp-wt-card cp-wt-marks cp-wt-rise" style={stagger(2)}>
      <p className="cp-wt-card-head">
        <b>Marks entry</b>
        <span>Class 8 A · Science · out of 100</span>
      </p>
      <ul>
        {marks.map(([name, score], index) => (
          <li key={name} style={{ ...stagger(index), "--score": `${score}%` } as React.CSSProperties}>
            <span>{name}</span>
            <i className="cp-wt-meter" />
            <b>{score}</b>
          </li>
        ))}
      </ul>
      <span className="cp-wt-approved"><BadgeCheck /> Approved · report cards ready</span>
    </div>
  );
}

/** Exam plans with status, then marks filling in and the approval stamp. */
export function ExamsArt({ label }: ArtProps) {
  return (
    <ArtFrame name="exams" label={label}>
      <ExamList />
      <MarksCard />
    </ArtFrame>
  );
}

/* ───────────── Documents ───────────── */

const docKinds = ["Report cards", "Admit cards", "ID cards", "Fee receipts", "Timetables", "Notices"];

const reportRows = [
  ["English", "94", "A+"],
  ["Mathematics", "91", "A+"],
  ["Science", "88", "A"],
  ["Hindi", "90", "A+"],
] as const;

function ReportSheet() {
  return (
    <div className="cp-wt-sheet cp-wt-sheet-front">
      <p className="cp-wt-sheet-school">
        <b>Riverview Public School</b>
        <small>Half-yearly examination · 2026–27</small>
      </p>
      <p className="cp-wt-sheet-meta"><span>Aarav Sharma</span><span>Class 8 A</span><span>Roll 14</span></p>
      <ul className="cp-wt-sheet-table">
        {reportRows.map(([subject, score, grade]) => (
          <li key={subject}><span>{subject}</span><span>{score}</span><b>{grade}</b></li>
        ))}
      </ul>
      <p className="cp-wt-sheet-foot"><span>Generated from live records</span><BadgeCheck /></p>
    </div>
  );
}

/** A report card fanned over an admit card and an ID card, plus the document kinds. */
export function DocumentsArt({ label }: ArtProps) {
  return (
    <ArtFrame name="documents" label={label}>
      <div className="cp-wt-doc-stack cp-wt-rise" style={stagger(1)}>
        <span className="cp-wt-sheet cp-wt-sheet-back"><IdCard /> ID card</span>
        <span className="cp-wt-sheet cp-wt-sheet-mid"><Clock3 /> Admit card</span>
        <ReportSheet />
      </div>
      <ul className="cp-wt-chips cp-wt-rise" style={stagger(2)}>
        {docKinds.map((kind, index) => (
          <li key={kind} style={stagger(index)}><Check />{kind}</li>
        ))}
      </ul>
    </ArtFrame>
  );
}

/* ───────────── AI-ready ───────────── */

function AssistantChat() {
  return (
    <div className="cp-wt-card cp-wt-chat cp-wt-rise" style={stagger(1)}>
      <p className="cp-wt-chat-who">
        <span className="cp-wt-avatar"><Bot /></span>
        Assistant for <b>Ms. Anjali Rao</b> · Class teacher, 8 A
      </p>
      <p className="cp-wt-bubble cp-wt-bubble-q" style={stagger(0)}>Whose Science marks are still pending?</p>
      <p className="cp-wt-bubble cp-wt-bubble-a" style={stagger(1)}>
        <b>3 students in 8 A:</b> Ishaan R., Sana K. and Vivaan M.
        <small><ShieldCheck /> Within your assigned classrooms</small>
      </p>
      <p className="cp-wt-bubble cp-wt-bubble-q" style={stagger(2)}>And the fee dues for the whole school?</p>
      <p className="cp-wt-bubble cp-wt-bubble-denied" style={stagger(3)}>
        <Lock /> That is outside your access, so I can't see it. Ask the accounts office.
      </p>
    </div>
  );
}

/** A teacher's assistant answering inside her access and declining outside it, plus the roadmap card. */
export function AiArt({ label }: ArtProps) {
  return (
    <ArtFrame name="ai" label={label}>
      <AssistantChat />
      <div className="cp-wt-agent cp-wt-rise" style={stagger(2)}>
        <p className="cp-wt-agent-head"><Sparkles /> Prepared for review <em>Roadmap</em></p>
        <p className="cp-wt-agent-task">
          <b>Fee-reminder list · Class 8</b>
          <small>11 families · draft, waiting for Accounts to approve</small>
        </p>
      </div>
    </ArtFrame>
  );
}

/* ───────────── Academics ───────────── */

const academicSteps = ["Session", "Classes & sections", "Subjects", "Teachers"];

const classRows = [
  ["Nursery", ["A", "B"]],
  ["Class 1", ["A", "B", "C"]],
  ["Class 8", ["A", "B"]],
  ["Class 10", ["A", "B", "C"]],
] as const;

const assignments = [
  ["English", "K. Menon", "KM"],
  ["Mathematics", "V. Joshi", "VJ"],
  ["Science", "A. Rao", "AR"],
  ["Hindi", "S. Verma", "SV"],
] as const;

function ClassesCard() {
  return (
    <div className="cp-wt-card cp-wt-classes cp-wt-rise" style={stagger(2)}>
      <p className="cp-wt-card-head">
        <b>Classes & sections</b>
        <span>2026–27 · Active</span>
      </p>
      <ul>
        {classRows.map(([name, sections], index) => (
          <li key={name} data-selected={name === "Class 8"} style={stagger(index)}>
            <span>{name}</span>
            <span className="cp-wt-sections">
              {sections.map((section) => <i key={section}>{section}</i>)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AssignmentsCard() {
  return (
    <div className="cp-wt-card cp-wt-assign cp-wt-rise" style={stagger(3)}>
      <p className="cp-wt-card-head">
        <b>Class 8 A · subjects</b>
        <span>Class teacher: A. Rao</span>
      </p>
      <ul>
        {assignments.map(([subject, teacher, initials], index) => (
          <li key={subject} style={stagger(index)}>
            <span>{subject}</span>
            <span className="cp-wt-teacher"><i>{initials}</i>{teacher}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Session → classes and sections → subjects → teacher assignments for one class. */
export function AcademicsArt({ label }: ArtProps) {
  return (
    <ArtFrame name="academics" label={label}>
      <StepTrack steps={academicSteps} />
      <div className="cp-wt-split cp-wt-split-even">
        <ClassesCard />
        <AssignmentsCard />
      </div>
    </ArtFrame>
  );
}

/* ───────────── Dashboards ───────────── */

/** Billed vs net collected, Jul–Nov. Heights are illustrative percentages. */
const chartMonths = [
  ["Jul", 82, 61],
  ["Aug", 64, 40],
  ["Sep", 58, 30],
  ["Oct", 70, 34],
  ["Nov", 46, 18],
] as const;

export function CollectionChart({ className = "" }: { className?: string }) {
  return (
    <div className={`cp-wt-card cp-wt-chart ${className}`.trim()}>
      <p className="cp-wt-card-head">
        <b>Fee collection</b>
        <span className="cp-wt-legend"><i data-key="billed" />Billed <i data-key="net" />Net collected</span>
      </p>
      <ul className="cp-wt-bars">
        {chartMonths.map(([month, billed, net], index) => (
          <li key={month} style={stagger(index)}>
            <i data-key="billed" style={{ "--h": `${billed}%` } as React.CSSProperties} />
            <i data-key="net" style={{ "--h": `${net}%` } as React.CSSProperties} />
            <small>{month}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

type DashTile = { label: string; value: string; note: string; meter?: number };

const dashTiles: readonly DashTile[] = [
  { label: "Session collections", value: "₹2,02,878", note: "42.96% realized", meter: 43 },
  { label: "Admissions", value: "85", note: "83 registered" },
  { label: "Students", value: "83", note: "8 classes" },
];

function DashTiles() {
  return (
    <ul className="cp-wt-dash-tiles cp-wt-rise" style={stagger(2)}>
      {dashTiles.map((tile) => (
        <li key={tile.label}>
          <small>{tile.label}</small>
          <b>{tile.value}</b>
          <span>{tile.note}</span>
          {tile.meter !== undefined ? <i className="cp-wt-meter" style={{ "--score": `${tile.meter}%` } as React.CSSProperties} /> : null}
        </li>
      ))}
    </ul>
  );
}

const dashRoles = [
  ["Principal", "Whole school"],
  ["Accounts", "Collections & dues"],
  ["Class teacher", "Own classes"],
] as const;

/** Which scope each role's dashboard covers; the principal's view (shown below) is selected. */
function RoleStrip() {
  return (
    <ul className="cp-wt-roles cp-wt-rise" style={stagger(1)}>
      {dashRoles.map(([role, scope], index) => (
        <li key={role} data-active={index === 0}>
          <b>{role}</b>
          <small>{scope}</small>
        </li>
      ))}
    </ul>
  );
}

/** A role-aware session dashboard: role scopes, headline tiles and the collection chart. */
export function DashboardsArt({ label }: ArtProps) {
  return (
    <ArtFrame name="dashboards" label={label}>
      <RoleStrip />
      <DashTiles />
      <CollectionChart className="cp-wt-rise" />
    </ArtFrame>
  );
}

/* ───────────── Student & family portal ───────────── */

type PortalBlock = { icon: LucideIcon; title: string; lines: readonly (readonly [string, string])[] };

const portalBlocks: readonly PortalBlock[] = [
  { icon: BookOpen, title: "Results", lines: [["First Term", "88% · A"], ["Science", "91"]] },
  { icon: CalendarDays, title: "Timetable", lines: [["09:00", "Maths"], ["09:45", "Science"]] },
  { icon: Wallet, title: "Fee ledger", lines: [["Term 2", "Paid"], ["Balance", "₹0"]] },
  { icon: BellRing, title: "Notices", lines: [["PTM", "Sat, 10 am"]] },
];

function PortalCard({ block, index }: { block: PortalBlock; index: number }) {
  const Icon = block.icon;
  return (
    <li className="cp-wt-portal-card" style={stagger(index)}>
      <p className="cp-wt-portal-title"><Icon />{block.title}</p>
      {block.lines.map(([left, right]) => (
        <p key={left} className="cp-wt-line"><span>{left}</span><b>{right}</b></p>
      ))}
    </li>
  );
}

function PortalPhone() {
  return (
    <div className="cp-wt-phone cp-wt-rise" style={stagger(1)}>
      <p className="cp-wt-phone-head">
        <span className="cp-wt-avatar cp-wt-avatar-light"><UserRound /></span>
        <span><b>Aarav Sharma</b><small>Class 8 A · Roll 14</small></span>
      </p>
      <ul className="cp-wt-portal">
        {portalBlocks.map((block, index) => <PortalCard key={block.title} block={block} index={index} />)}
      </ul>
    </div>
  );
}

const hiddenAreas = ["Other students", "Staff records", "School-wide fees"];

/** A family's phone view with only their own child's records; everything else stays out of reach. */
export function StudentPortalArt({ label }: ArtProps) {
  return (
    <ArtFrame name="portal" label={label}>
      <PortalPhone />
      <div className="cp-wt-scope cp-wt-rise" style={stagger(2)}>
        <p className="cp-wt-scope-head"><ShieldCheck /> Only Aarav's records</p>
        <ul>
          {hiddenAreas.map((area) => <li key={area}><Lock />{area}</li>)}
        </ul>
        <p className="cp-wt-scope-foot"><Layers3 /> Same records the school keeps, no copies</p>
      </div>
    </ArtFrame>
  );
}

/* ───────────── Lookup ───────────── */

/** Hero artwork per feature page. Billing reuses the fees scene. */
export const featureArt: Record<FeatureSlug, ComponentType<ArtProps>> = {
  admissions: AdmissionsArt,
  academics: AcademicsArt,
  billing: FeesArt,
  examinations: ExamsArt,
  documents: DocumentsArt,
  dashboards: DashboardsArt,
  "student-portal": StudentPortalArt,
};
