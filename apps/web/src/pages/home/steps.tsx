import { ArrowRight, Check, ChevronRight, Receipt, Sparkles, UserPlus, Workflow, type LucideIcon } from "lucide-react";
import { Link } from "react-router";

/* ----------------------------------------------------- 01 · set up once */

const setupRows = [
  ["Nursery", "A · B"],
  ["LKG", "A · B"],
  ["UKG", "A · B"],
  ["Class 1", "A · B · C"],
  ["Fees", "Monthly + term structure"],
] as const;

function SetupRow({ label, detail, index }: { label: string; detail: string; index: number }) {
  return (
    <div className="cp-setup-row" style={{ "--cp-i": index } as React.CSSProperties}>
      <span className="cp-switch">
        <i />
      </span>
      <b>{label}</b>
      <small>{detail}</small>
    </div>
  );
}

/** Mini session-setup window whose switches turn on one after another, then reset. */
function SetupArt() {
  return (
    <div className="cp-art-window">
      <div className="cp-art-window-head">
        <b>Session 2026–27</b>
        <span className="cp-badge">Active</span>
      </div>
      <div className="cp-setup-rows">
        {setupRows.map(([label, detail], index) => (
          <SetupRow key={label} label={label} detail={detail} index={index} />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------- 02 · it flows on */

const flowNodes: readonly [LucideIcon, string, string][] = [
  [UserPlus, "Admission confirmed", "Ananya Iyer · Class 3-B"],
  [Receipt, "Term 1 fee billed", "₹18,400 · added to ledger"],
  [Check, "Payment recorded", "Receipt R-0412 · balance ₹0"],
];

function FlowNode({ icon: Icon, title, detail, index }: { icon: LucideIcon; title: string; detail: string; index: number }) {
  return (
    <div className="cp-flow-node" style={{ "--cp-i": index } as React.CSSProperties}>
      <span className="cp-flow-icon">
        <Icon />
      </span>
      <span className="cp-flow-text">
        <b>{title}</b>
        <small>{detail}</small>
      </span>
    </div>
  );
}

/** A pulse travels down the track; each record lights up as the pulse reaches it. */
function FlowArt() {
  return (
    <div className="cp-flow">
      <span className="cp-flow-track">
        <i />
      </span>
      {flowNodes.map(([icon, title, detail], index) => (
        <FlowNode key={title} icon={icon} title={title} detail={detail} index={index} />
      ))}
    </div>
  );
}

/* ------------------------------------- 03 · records and answers follow */

const reportRows = [
  ["English", "94", 94],
  ["Mathematics", "88", 88],
  ["Science", "91", 91],
] as const;

function ReportCardSheet() {
  return (
    <div className="cp-sheet">
      <div className="cp-sheet-head">
        <b>Riverview Public School</b>
        <small>First Term · 2026–27</small>
      </div>
      <span className="cp-sheet-student">Aarav Sharma · Class 8-A</span>
      {reportRows.map(([subject, marks, width], index) => (
        <div key={subject} className="cp-sheet-row" style={{ "--cp-i": index, "--cp-w": `${width}%` } as React.CSSProperties}>
          <small>{subject}</small>
          <span className="cp-sheet-bar">
            <i />
          </span>
          <b>{marks}</b>
        </div>
      ))}
      <span className="cp-stamp">
        <Check /> Approved
      </span>
    </div>
  );
}

function OutputsArt() {
  return (
    <div className="cp-outputs">
      <span className="cp-paper cp-paper-back">Admit card</span>
      <span className="cp-paper cp-paper-mid">Fee receipt</span>
      <ReportCardSheet />
      <span className="cp-answer-chip">
        <Sparkles /> Answers within each person’s access
      </span>
    </div>
  );
}

/* --------------------------------------------------------------- layout */

type Step = {
  art: React.ReactNode;
  body: string;
  number: string;
  title: string;
};

const steps: readonly Step[] = [
  {
    number: "01",
    title: "Set up your session once",
    body: "Classes from Nursery to Class 12, sections, subjects, teachers and fee structures — configured once for 2026–27.",
    art: <SetupArt />,
  },
  {
    number: "02",
    title: "Enter each thing once",
    body: "An admission becomes a student record and a bill. A payment becomes a receipt and a ledger entry. Marks become results.",
    art: <FlowArt />,
  },
  {
    number: "03",
    title: "Documents and answers follow",
    body: "Report cards, admit cards and receipts come from live records — and AI assistants answer within each person’s permissions.",
    art: <OutputsArt />,
  },
];

function StepCard({ step }: { step: Step }) {
  return (
    <li className="cp-step">
      <span className="cp-step-number">{step.number}</span>
      <h3>{step.title}</h3>
      <p>{step.body}</p>
      <div className="cp-step-art" aria-hidden="true">{step.art}</div>
    </li>
  );
}

function StepsIntro() {
  return (
    <div className="cp-section-intro">
      <span className="cp-pill">
        <Workflow aria-hidden="true" /> How it works
      </span>
      <h2 id="cp-steps-title">With CampusPilot, the daily admin is done once</h2>
      <p>Set the school up once. Every admission, payment and mark then flows into the records, documents and answers that depend on it.</p>
      <div className="cp-hero-actions">
        <Link className="cp-btn cp-btn-primary" to="/book-demo">
          Book a demo <ArrowRight aria-hidden="true" />
        </Link>
        <a className="cp-btn cp-btn-light" href="#faq">
          Read the FAQ <ChevronRight aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}

export function StepsSection() {
  return (
    <section className="cp-section" id="how-it-works" aria-labelledby="cp-steps-title">
      <StepsIntro />
      <ol className="cp-steps">
        {steps.map((step) => (
          <StepCard key={step.number} step={step} />
        ))}
      </ol>
    </section>
  );
}
