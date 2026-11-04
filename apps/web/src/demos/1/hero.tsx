import {
  ArrowRight,
  Check,
  ChevronRight,
  ClipboardCheck,
  FileText,
  GraduationCap,
  IndianRupee,
  LayoutDashboard,
  Megaphone,
  MousePointer2,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router";

/* ------------------------------------------------------------------ copy */

function HeroCopy() {
  return (
    <div className="d1-hero-copy">
      <Link className="d1-pill d1-pill-link" to="/ai-ready">
        <span className="d1-pill-dot" aria-hidden="true" />
        AI-ready school management
        <ChevronRight aria-hidden="true" />
      </Link>
      <h1 className="d1-hero-title" id="d1-hero-title">
        School admin, done once.
        <span> Ready for AI.</span>
      </h1>
      <p className="d1-hero-lede">
        CampusPilot connects admissions, fees, marks and report cards for Indian schools. Repeated work is
        entered once and flows on — and the AI assistants your team already uses answer from live records,
        seeing only what each person is allowed to see.
      </p>
      <div className="d1-hero-actions">
        <Link className="d1-btn d1-btn-dark d1-btn-lg" to="/book-demo">
          Book a demo <ArrowRight aria-hidden="true" />
        </Link>
        <a className="d1-btn d1-btn-light d1-btn-lg" href="#how-it-works">
          See how it works <ChevronRight aria-hidden="true" />
        </a>
      </div>
      <p className="d1-hero-note">Nursery to Class 12 · Fees in ₹ · Single and multi-campus schools</p>
    </div>
  );
}

/* --------------------------------------------------------------- console */

const sidebarIcons: readonly LucideIcon[] = [LayoutDashboard, Users, UserPlus, GraduationCap, ClipboardCheck, FileText, Wallet, Megaphone];

function ConsoleSidebar() {
  return (
    <div className="d1-console-sidebar">
      {sidebarIcons.map((Icon, index) => (
        <span key={index} className={index === 0 ? "is-active" : undefined}>
          <Icon />
        </span>
      ))}
    </div>
  );
}

function ConsoleTopBar() {
  return (
    <div className="d1-console-top">
      <span className="d1-console-dots">
        <i />
        <i />
        <i />
      </span>
      <b>Riverview Public School</b>
      <span className="d1-console-session">Session 2026–27</span>
    </div>
  );
}

function CollectionTile() {
  return (
    <div className="d1-tile">
      <small>Session collections</small>
      <b>₹2,02,878</b>
      <span className="d1-progress">
        <i />
      </span>
      <small className="d1-tile-foot">42.96% realized · ₹2,50,028 due</small>
    </div>
  );
}

function AdmissionsTile() {
  return (
    <div className="d1-tile">
      <small>Admissions</small>
      <b>85</b>
      <span className="d1-tile-chip">
        <Check /> 83 registered
      </span>
      <small className="d1-tile-foot">Students 83 · 8 classes</small>
    </div>
  );
}

/** Billed vs collected, as relative bar heights (illustrative). */
const collectionBars = [
  ["Jul", 78, 64],
  ["Aug", 56, 40],
  ["Sep", 70, 52],
  ["Oct", 48, 30],
  ["Nov", 62, 22],
] as const;

function CollectionChart() {
  return (
    <div className="d1-chart">
      <div className="d1-chart-head">
        <small>Fee collection</small>
        <span className="d1-live">Live</span>
      </div>
      <div className="d1-chart-bars">
        {collectionBars.map(([month, billed, collected], index) => (
          <span key={month} className="d1-bar-pair" style={{ "--d1-i": index } as React.CSSProperties}>
            <i style={{ height: `${billed}%` }} />
            <i style={{ height: `${collected}%` }} />
            <small>{month}</small>
          </span>
        ))}
      </div>
    </div>
  );
}

const quickJobs: readonly [LucideIcon, string][] = [
  [UserPlus, "New admission"],
  [IndianRupee, "Record payment"],
  [ClipboardCheck, "Enter results"],
  [Megaphone, "Create notice"],
];

/**
 * The second job ("Record payment") is the one the simulated cursor presses on
 * each loop; the cursor lives inside that button so it lands correctly at any size.
 */
function QuickJobs() {
  return (
    <div className="d1-jobs">
      {quickJobs.map(([Icon, label], index) => (
        <span key={label} className={index === 1 ? "d1-job is-target" : "d1-job"}>
          <Icon />
          {label}
          {index === 1 ? <MousePointer2 className="d1-cursor" /> : null}
        </span>
      ))}
    </div>
  );
}

function ReceiptToast() {
  return (
    <div className="d1-toast">
      <span className="d1-toast-icon">
        <Check />
      </span>
      <span>
        <b>Payment recorded</b>
        <small>Receipt R-0412 ready · ledger updated</small>
      </span>
    </div>
  );
}

function ConsoleMain() {
  return (
    <div className="d1-console-main">
      <div className="d1-console-heading">
        <small>Welcome back</small>
        <b>Session overview</b>
      </div>
      <div className="d1-tiles">
        <CollectionTile />
        <AdmissionsTile />
      </div>
      <CollectionChart />
      <QuickJobs />
      <ReceiptToast />
    </div>
  );
}

function ConsoleWindow() {
  return (
    <div className="d1-console">
      <ConsoleTopBar />
      <div className="d1-console-body">
        <ConsoleSidebar />
        <ConsoleMain />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ assistant */

function AssistantHeader() {
  return (
    <div className="d1-ai-head">
      <span className="d1-ai-avatar">
        <Sparkles />
      </span>
      <b>Assistant</b>
      <span className="d1-ai-role">Ms. Rao · Class teacher, 8-A</span>
    </div>
  );
}

function AssistantAnswer() {
  return (
    <div className="d1-ai-answer">
      <span className="d1-typing">
        <i />
        <i />
        <i />
      </span>
      <p>
        Mathematics marks are pending for <b>3 students</b> in 8-A: Aarav S., Diya M. and Kabir N.
      </p>
    </div>
  );
}

/** Shows a permission-scoped answer: the teacher's question only reaches her own class. */
function AssistantCard() {
  return (
    <div className="d1-ai-card">
      <AssistantHeader />
      <p className="d1-ai-question">Whose First Term marks are still missing in my class?</p>
      <AssistantAnswer />
      <p className="d1-ai-scope">
        <ShieldCheck /> Only classes assigned to you
      </p>
    </div>
  );
}

function HeroVisual() {
  return (
    <div className="d1-hero-visual" aria-hidden="true">
      <ConsoleWindow />
      <AssistantCard />
    </div>
  );
}

export function Hero() {
  return (
    <section className="d1-hero" aria-labelledby="d1-hero-title">
      <div className="d1-hero-panel">
        <HeroCopy />
        <HeroVisual />
      </div>
    </section>
  );
}
