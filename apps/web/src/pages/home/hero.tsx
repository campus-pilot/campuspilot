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

import { LoginButton } from "@/site/shell/login-dialog";

/* ------------------------------------------------------------------ copy */

function HeroCopy() {
  return (
    <div className="cp-hero-copy">
      <Link className="cp-pill cp-pill-link" to="/ai-ready">
        <span className="cp-pill-dot" aria-hidden="true" />
        AI-ready school management
        <ChevronRight aria-hidden="true" />
      </Link>
      <h1 className="cp-hero-title" id="cp-hero-title">
        School admin, done once.
        <span> Ready for AI.</span>
      </h1>
      <p className="cp-hero-lede">
        CampusPilot connects admissions, fees, marks and report cards for Indian schools. Repeated work is
        entered once and flows on — and the AI assistants your team already uses answer from live records,
        seeing only what each person is allowed to see.
      </p>
      <div className="cp-hero-actions">
        <Link className="cp-btn cp-btn-primary cp-btn-lg" to="/book-demo">
          Book a demo <ArrowRight aria-hidden="true" />
        </Link>
        <a className="cp-btn cp-btn-light cp-btn-lg" href="#how-it-works">
          See how it works <ChevronRight aria-hidden="true" />
        </a>
      </div>
      <LoginButton className="cp-hero-note cp-hero-login">Log in</LoginButton>
    </div>
  );
}

/* --------------------------------------------------------------- console */

const sidebarIcons: readonly LucideIcon[] = [LayoutDashboard, Users, UserPlus, GraduationCap, ClipboardCheck, FileText, Wallet, Megaphone];

function ConsoleSidebar() {
  return (
    <div className="cp-console-sidebar">
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
    <div className="cp-console-top">
      <span className="cp-console-dots">
        <i />
        <i />
        <i />
      </span>
      <b>Riverview Public School</b>
      <span className="cp-console-session">Session 2026–27</span>
    </div>
  );
}

function CollectionTile() {
  return (
    <div className="cp-tile">
      <small>Session collections</small>
      <b>₹2,02,878</b>
      <span className="cp-progress">
        <i />
      </span>
      <small className="cp-tile-foot">42.96% realized · ₹2,50,028 due</small>
    </div>
  );
}

function AdmissionsTile() {
  return (
    <div className="cp-tile">
      <small>Admissions</small>
      <b>85</b>
      <span className="cp-tile-chip">
        <Check /> 83 registered
      </span>
      <small className="cp-tile-foot">Students 83 · 8 classes</small>
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
    <div className="cp-chart">
      <div className="cp-chart-head">
        <small>Fee collection</small>
        <span className="cp-live">Live</span>
      </div>
      <div className="cp-chart-bars">
        {collectionBars.map(([month, billed, collected], index) => (
          <span key={month} className="cp-bar-pair" style={{ "--cp-i": index } as React.CSSProperties}>
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
    <div className="cp-jobs">
      {quickJobs.map(([Icon, label], index) => (
        <span key={label} className={index === 1 ? "cp-job is-target" : "cp-job"}>
          <Icon />
          {label}
          {index === 1 ? <MousePointer2 className="cp-cursor" /> : null}
        </span>
      ))}
    </div>
  );
}

function ReceiptToast() {
  return (
    <div className="cp-toast">
      <span className="cp-toast-icon">
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
    <div className="cp-console-main">
      <div className="cp-console-heading">
        <small>Welcome back</small>
        <b>Session overview</b>
      </div>
      <div className="cp-tiles">
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
    <div className="cp-console">
      <ConsoleTopBar />
      <div className="cp-console-body">
        <ConsoleSidebar />
        <ConsoleMain />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ assistant */

function AssistantHeader() {
  return (
    <div className="cp-ai-head">
      <span className="cp-ai-avatar">
        <Sparkles />
      </span>
      <b>Assistant</b>
      <span className="cp-ai-role">Ms. Rao · Class teacher, 8-A</span>
    </div>
  );
}

function AssistantAnswer() {
  return (
    <div className="cp-ai-answer">
      <span className="cp-typing">
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
    <div className="cp-ai-card">
      <AssistantHeader />
      <p className="cp-ai-question">Whose First Term marks are still missing in my class?</p>
      <AssistantAnswer />
      <p className="cp-ai-scope">
        <ShieldCheck /> Only classes assigned to you
      </p>
    </div>
  );
}

function HeroVisual() {
  return (
    <div className="cp-hero-visual" aria-hidden="true">
      <ConsoleWindow />
      <AssistantCard />
    </div>
  );
}

export function Hero() {
  return (
    <section className="cp-hero" aria-labelledby="cp-hero-title">
      <div className="cp-hero-panel">
        <HeroCopy />
        <HeroVisual />
      </div>
    </section>
  );
}
