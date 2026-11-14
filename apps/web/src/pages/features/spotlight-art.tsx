/**
 * Small spotlight illustrations, one per feature, so the seven detail pages
 * share a template without looking identical. Each is decorative
 * (`aria-hidden`); the spotlight copy beside it says the same thing in words.
 * Fictional school and student, illustrative values only.
 *
 * Motion: parts with `--i` rise or fill in when the illustration itself scrolls
 * into view (`[data-inview]` from `playOnView` on the frame), so on phones,
 * where it sits below the copy, it does not play off-screen. Base styles are
 * the finished state.
 */
import { BadgeCheck, Bell, CalendarDays, Camera, Check, FileText, IdCard, Lock, MessageCircle, MessagesSquare, Printer, Receipt, ShieldCheck, Smartphone, Stamp, UserRound } from "lucide-react";
import type { ComponentType } from "react";

import type { FeatureSlug } from "@/site/content/catalog";

import { playOnView, staggerStyle } from "./reveal";

function SpotFrame({ kind, title, children }: { kind: string; title: string; children: React.ReactNode }) {
  return (
    <div className={`pg-features-spot-art pg-features-spot-${kind}`} aria-hidden="true" ref={playOnView}>
      <p className="pg-features-spot-title">{title}</p>
      {children}
    </div>
  );
}

/* ----------------------------------------------------------- admissions */

const recordRows = [
  ["Admission no.", "2025015"],
  ["Class", "Class 8 A"],
  ["Session", "2026–27"],
  ["Father's name", "Rajesh Sharma"],
  ["Fee account", "Opened"],
] as const;

function AdmissionSpot() {
  return (
    <SpotFrame kind="record" title="Student record">
      <p className="pg-features-spot-person">
        <UserRound /> Aarav Sharma
      </p>
      <dl className="pg-features-spot-dl">
        {recordRows.map(([label, value], index) => (
          <div key={label} style={staggerStyle(index)}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </SpotFrame>
  );
}

/* ------------------------------------------------------------ academics */

const classRows = [
  ["Nursery", ["A", "B"]],
  ["LKG", ["A", "B"]],
  ["UKG", ["A", "B"]],
  ["Class 1", ["A", "B", "C"]],
  ["Class 8", ["A", "B"]],
] as const;

function AcademicsSpot() {
  return (
    <SpotFrame kind="classes" title="Session 2026–27 · Classes and sections">
      <ul className="pg-features-spot-classes">
        {classRows.map(([name, sections], index) => (
          <li key={name} style={staggerStyle(index)}>
            <b>{name}</b>
            {sections.map((section) => (
              <span key={section}>{section}</span>
            ))}
          </li>
        ))}
      </ul>
    </SpotFrame>
  );
}

/* -------------------------------------------------------------- billing */

/** Shares of ₹4,72,261 billed: collected, discounts, outstanding (sum to 100). */
const billingParts = [
  { label: "Collected", amount: "₹2,02,878", share: 42.96, tone: "ink" },
  { label: "Discounts", amount: "₹19,355", share: 4.1, tone: "warm" },
  { label: "Outstanding", amount: "₹2,50,028", share: 52.94, tone: "line" },
] as const;

function BillingSpot() {
  return (
    <SpotFrame kind="billing" title="Session 2026–27 · Billed ₹4,72,261">
      <div className="pg-features-spot-bar">
        {billingParts.map((part, index) => (
          <i key={part.label} data-tone={part.tone} style={{ ...staggerStyle(index), flexGrow: part.share }} />
        ))}
      </div>
      <ul className="pg-features-spot-legend">
        {billingParts.map((part) => (
          <li key={part.label} data-tone={part.tone}>
            <span>{part.label}</span>
            <b>{part.amount}</b>
          </li>
        ))}
      </ul>
    </SpotFrame>
  );
}

/* --------------------------------------------------------- examinations */

const resultProgress = [
  ["Nursery", 100],
  ["LKG", 100],
  ["UKG", 75],
  ["Class 1", 50],
] as const;

function ExamsSpot() {
  return (
    <SpotFrame kind="progress" title="First Term · Results entered by class">
      <ul className="pg-features-spot-progress">
        {resultProgress.map(([name, value], index) => (
          <li key={name} style={{ ...staggerStyle(index), "--pg-v": `${value}%` } as React.CSSProperties}>
            <b>{name}</b>
            <span><i /></span>
            <small>{value === 100 ? <Check /> : `${value}%`}</small>
          </li>
        ))}
      </ul>
    </SpotFrame>
  );
}

/* ------------------------------------------------------------ documents */

const paperKinds = [
  { label: "Report card", icon: FileText },
  { label: "ID card", icon: IdCard },
  { label: "Admit card", icon: Stamp },
  { label: "Receipt", icon: Receipt },
] as const;

function DocumentsSpot() {
  return (
    <SpotFrame kind="papers" title="Riverview Public School · Branded once">
      <ul className="pg-features-spot-papers">
        {paperKinds.map(({ label, icon: Icon }, index) => (
          <li key={label} style={staggerStyle(index)}>
            <Icon />
            <b>{label}</b>
            <i />
            <i />
          </li>
        ))}
      </ul>
    </SpotFrame>
  );
}

/* ----------------------------------------------------------- dashboards */

const roleViews = [
  { role: "Principal", sees: ["Collections", "Admissions", "Exams"], hidden: [] },
  { role: "Accountant", sees: ["Collections"], hidden: ["Exams"] },
  { role: "Class teacher", sees: ["Class 8 A"], hidden: ["Fees"] },
] as const;

function DashboardsSpot() {
  return (
    <SpotFrame kind="roles" title="Same school, a view per role">
      <ul className="pg-features-spot-roles">
        {roleViews.map((view, index) => (
          <li key={view.role} style={staggerStyle(index)}>
            <b>{view.role}</b>
            {view.sees.map((item) => (
              <span key={item}>{item}</span>
            ))}
            {view.hidden.map((item) => (
              <span key={item} data-hidden="">
                <Lock /> {item}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </SpotFrame>
  );
}

/* ------------------------------------------------------- student portal */

const ownRecords = [
  { label: "Results", icon: BadgeCheck },
  { label: "Timetable", icon: CalendarDays },
  { label: "Fee ledger", icon: Receipt },
] as const;

const outOfBounds = ["Other students", "Staff workspace"] as const;

function PortalSpot() {
  return (
    <SpotFrame kind="portal" title="Aarav Sharma · Class 8 A">
      <ul className="pg-features-spot-own">
        {ownRecords.map(({ label, icon: Icon }, index) => (
          <li key={label} style={staggerStyle(index)}>
            <Icon /> {label}
          </li>
        ))}
      </ul>
      <p className="pg-features-spot-fence">
        <ShieldCheck /> Boundary
      </p>
      <ul className="pg-features-spot-out">
        {outOfBounds.map((label) => (
          <li key={label}>
            <Lock /> {label}
          </li>
        ))}
      </ul>
    </SpotFrame>
  );
}

/* ------------------------------------------------------ question papers */

const paperSteps = [
  { label: "Photos", icon: Camera },
  { label: "Chat edits", icon: MessagesSquare },
  { label: "Version 3", icon: FileText },
  { label: "PDF", icon: Printer },
] as const;

function QuestionPapersSpot() {
  return (
    <SpotFrame kind="papers" title="Science · Class 8 · every change a new version">
      <ul className="pg-features-spot-papers">
        {paperSteps.map(({ label, icon: Icon }, index) => (
          <li key={label} style={staggerStyle(index)}>
            <Icon />
            <b>{label}</b>
            <i />
            <i />
          </li>
        ))}
      </ul>
    </SpotFrame>
  );
}

/* --------------------------------------------------------------- notices */

const noticeStops = [
  { label: "In the app", icon: Bell },
  { label: "WhatsApp", icon: MessageCircle },
  { label: "Push", icon: Smartphone },
  { label: "Print", icon: Printer },
] as const;

function NoticesSpot() {
  return (
    <SpotFrame kind="papers" title="One notice · Classes 6 to 8 and staff">
      <ul className="pg-features-spot-papers">
        {noticeStops.map(({ label, icon: Icon }, index) => (
          <li key={label} style={staggerStyle(index)}>
            <Icon />
            <b>{label}</b>
            <i />
            <i />
          </li>
        ))}
      </ul>
    </SpotFrame>
  );
}

/* --------------------------------------------------------------- lookup */

type SpotlightVariant = {
  Art: ComponentType;
  /** Puts the illustration on the left, so neighbouring feature pages alternate. */
  artFirst: boolean;
};

export const spotlightArt: Record<FeatureSlug, SpotlightVariant> = {
  admissions: { Art: AdmissionSpot, artFirst: false },
  academics: { Art: AcademicsSpot, artFirst: true },
  billing: { Art: BillingSpot, artFirst: false },
  examinations: { Art: ExamsSpot, artFirst: true },
  documents: { Art: DocumentsSpot, artFirst: false },
  dashboards: { Art: DashboardsSpot, artFirst: true },
  "student-portal": { Art: PortalSpot, artFirst: false },
  "question-papers": { Art: QuestionPapersSpot, artFirst: true },
  notices: { Art: NoticesSpot, artFirst: false },
};
