/**
 * ConsoleStage: the session-dashboard console with two floating cards that
 * carry the two core messages:
 * - "Recorded once": one fee payment, with checks lighting up for receipt →
 *   ledger → dashboard → family view (CSS loop; base state is all checked).
 * - The AI answer card: answered with the asker's own access.
 *
 * Placement: the `/product` page hero visual, `<PageHero visual={<ConsoleStage />} />`.
 * It stays inside the hero's visual column on desktop and stacks (console,
 * then the two cards) on phones.
 *
 * Props: `label?: string` overrides the image description.
 */
import {
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

import { CollectionChart } from "./feature-art";
import { stagger } from "./shared";

const DEFAULT_LABEL =
  "Illustration: the CampusPilot session dashboard, a fee payment recorded once that updates the receipt, ledger, dashboard and family view, and an AI assistant answering within the asker's permissions.";

export function ConsoleStage({ label = DEFAULT_LABEL }: { label?: string }) {
  return (
    <div className="cp-cs" role="img" aria-label={label}>
      <ConsoleWindow />
      <OnceCard />
      <AssistantCard />
    </div>
  );
}

const sidebarIcons = [LayoutDashboard, Users, School, BookOpen, FileText, CreditCard, Megaphone];

function ConsoleWindow() {
  return (
    <div className="cp-cs-console">
      <div className="cp-cs-bar">
        <span className="cp-cs-dots"><i /><i /><i /></span>
        <b>Campus Pilot Public School, Bengaluru</b>
        <span className="cp-cs-tag">2026–27</span>
      </div>
      <div className="cp-cs-body">
        <ul className="cp-cs-side">
          {sidebarIcons.map((Icon, index) => (
            <li key={index} data-active={index === 0}><Icon /></li>
          ))}
        </ul>
        <ConsoleMain />
      </div>
    </div>
  );
}

type Stat = { label: string; value: string; note: string; meter?: number };

const stats: readonly Stat[] = [
  { label: "Session collections", value: "₹2,02,878", note: "42.96% realized", meter: 43 },
  { label: "Admissions", value: "85", note: "83 registered" },
  { label: "Students", value: "83", note: "8 classes" },
];

function ConsoleMain() {
  return (
    <div className="cp-cs-main">
      <p className="cp-cs-hello"><small>Welcome back</small><b>Session dashboard</b></p>
      <ul className="cp-cs-stats">
        {stats.map((stat) => (
          <li key={stat.label}>
            <small>{stat.label}</small>
            <b>{stat.value}</b>
            <span>{stat.note}</span>
            {stat.meter !== undefined ? <i className="cp-wt-meter" style={{ "--score": `${stat.meter}%` } as React.CSSProperties} /> : null}
          </li>
        ))}
      </ul>
      <CollectionChart />
    </div>
  );
}

const onceOutputs = ["Receipt RCP-2026-0418", "Student ledger", "Session dashboard", "Family view"];

/** The four checks light up one after another on a CSS loop (`cp-cs-check`). */
function OnceCard() {
  return (
    <div className="cp-cs-float cp-cs-once">
      <p className="cp-cs-label"><Repeat2 /> Recorded once</p>
      <p className="cp-cs-once-title"><b>Fee payment · ₹12,500</b><small>Aarav Sharma · Class 8 A</small></p>
      <ul className="cp-cs-once-list">
        {onceOutputs.map((output, index) => (
          <li key={output} style={stagger(index)}>
            <span className="cp-cs-check"><Check /></span>
            {output}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AssistantCard() {
  return (
    <div className="cp-cs-float cp-cs-assistant">
      <p className="cp-cs-label"><span className="cp-cs-avatar"><Bot /></span> Your team's AI assistant</p>
      <p className="cp-cs-q">How much is still due for Class 8 this term?</p>
      <p className="cp-cs-a"><b>₹1,48,200 across 11 students.</b> From live billing records.</p>
      <p className="cp-cs-scope"><ShieldCheck /> Answered with Priya's access · Accounts</p>
    </div>
  );
}
