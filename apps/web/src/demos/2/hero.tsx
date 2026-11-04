import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  CreditCard,
  FileText,
  LayoutDashboard,
  Megaphone,
  Repeat2,
  School,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Link } from "react-router";

export function Hero() {
  return (
    <section className="d2-hero" aria-labelledby="d2-hero-title">
      <div className="d2-hero-backdrop" aria-hidden="true" />
      <div className="d2-container d2-hero-grid">
        <HeroCopy />
        <HeroVisual />
      </div>
    </section>
  );
}

function HeroCopy() {
  return (
    <div className="d2-hero-copy">
      <p className="d2-eyebrow"><span className="d2-pulse-dot" aria-hidden="true" />School management software for India</p>
      <h1 id="d2-hero-title" className="d2-hero-title">
        Admin work, done <em>once.</em>
        <span>School data, ready for AI.</span>
      </h1>
      <p className="d2-hero-lead">
        Admissions, fees, receipts, marks and report cards repeat every day, term and session.
        CampusPilot connects them, so each step is done once, correctly, and flows on — into one
        record your team, and the AI assistants they already use, can trust.
      </p>
      <div className="d2-hero-actions">
        <Link className="d2-btn d2-btn-primary d2-btn-lg" to="/book-demo">
          Book a demo <ArrowRight aria-hidden="true" />
        </Link>
        <a className="d2-btn d2-btn-ghost d2-btn-lg" href="#d2-why">
          See how it flows <ArrowDown aria-hidden="true" />
        </a>
      </div>
      <HeroPromises />
    </div>
  );
}

function HeroPromises() {
  return (
    <ul className="d2-hero-promises">
      <li><Repeat2 aria-hidden="true" /><span><b>Repeated work, done once</b> — records flow to receipts, ledgers and report cards.</span></li>
      <li><ShieldCheck aria-hidden="true" /><span><b>AI-ready, permissions intact</b> — an assistant only sees what that person may see.</span></li>
    </ul>
  );
}

/** Illustrative composition: console window plus two floating cards carrying the two messages. */
function HeroVisual() {
  return (
    <div
      className="d2-hero-visual"
      role="img"
      aria-label="Illustration: the CampusPilot console with a fee payment recorded once and flowing to four places, and an AI assistant answering within the asker's permissions."
    >
      <ConsoleWindow />
      <OnceCard />
      <AssistantCard />
    </div>
  );
}

const sidebarIcons = [LayoutDashboard, Users, School, BookOpen, FileText, CreditCard, Megaphone];

function ConsoleWindow() {
  return (
    <div className="d2-console" aria-hidden="true">
      <div className="d2-console-bar">
        <span className="d2-dots"><i /><i /><i /></span>
        <b>Campus Pilot Public School, Bengaluru</b>
        <span className="d2-tag">2026–27</span>
      </div>
      <div className="d2-console-body">
        <ul className="d2-console-side">
          {sidebarIcons.map((Icon, index) => (
            <li key={index} data-active={index === 0}><Icon /></li>
          ))}
        </ul>
        <ConsoleMain />
      </div>
    </div>
  );
}

function ConsoleMain() {
  return (
    <div className="d2-console-main">
      <p className="d2-console-hello"><b>Welcome back</b><small>Session dashboard</small></p>
      <div className="d2-stat-row">
        <ConsoleStat label="Session collections" value="₹2,02,878" note="42.96% realized" meter={43} />
        <ConsoleStat label="Admissions" value="85" note="83 registered" />
        <ConsoleStat label="Students" value="83" note="8 classes" />
      </div>
      <CollectionChart />
    </div>
  );
}

function ConsoleStat({ label, value, note, meter }: { label: string; value: string; note: string; meter?: number }) {
  return (
    <div className="d2-stat">
      <small>{label}</small>
      <b>{value}</b>
      <span>{note}</span>
      {meter !== undefined && <i className="d2-meter" style={{ "--d2-meter": `${meter}%` } as React.CSSProperties} />}
    </div>
  );
}

/** Billed vs net collected, Jul–Nov. Heights are illustrative percentages. */
const chartMonths = [
  ["Jul", 82, 61],
  ["Aug", 64, 40],
  ["Sep", 58, 30],
  ["Oct", 70, 34],
  ["Nov", 46, 18],
] as const;

function CollectionChart() {
  return (
    <div className="d2-chart">
      <p className="d2-chart-head"><b>Fee collection</b><span><i className="d2-key-billed" />Billed <i className="d2-key-net" />Net collected</span></p>
      <ul className="d2-chart-bars">
        {chartMonths.map(([month, billed, net], index) => (
          <li key={month} style={{ "--i": index } as React.CSSProperties}>
            <span className="d2-bar d2-bar-billed" style={{ "--h": `${billed}%` } as React.CSSProperties} />
            <span className="d2-bar d2-bar-net" style={{ "--h": `${net}%` } as React.CSSProperties} />
            <small>{month}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

const onceOutputs = ["Receipt RCP-2026-0418", "Student ledger", "Session dashboard", "Family view"];

/** The four checks light up one after another on a CSS loop (see `d2-once-check`). */
function OnceCard() {
  return (
    <div className="d2-float d2-once" aria-hidden="true">
      <p className="d2-float-label"><Repeat2 /> Recorded once</p>
      <p className="d2-once-title"><b>Fee payment · ₹12,500</b><small>Aarav Sharma · Class 8 A</small></p>
      <ul className="d2-once-list">
        {onceOutputs.map((output, index) => (
          <li key={output} style={{ "--i": index } as React.CSSProperties}>
            <span className="d2-once-check"><Check /></span>
            {output}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AssistantCard() {
  return (
    <div className="d2-float d2-assistant" aria-hidden="true">
      <p className="d2-float-label"><Bot /> Your team's AI assistant</p>
      <p className="d2-assistant-q">How much is still due for Class 8 this term?</p>
      <p className="d2-assistant-a"><b>₹1,48,200 across 11 students.</b> From live billing records.</p>
      <p className="d2-assistant-scope"><ShieldCheck /> Answered with Priya's access · Accounts</p>
    </div>
  );
}
