import { BookOpen, FileText, IndianRupee, Lock, School, UserPlus, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { ConsoleFrame, rise } from "./console-frame";

/* ───────────── Single campus: one record, read everywhere ───────────── */

const recordFlows: readonly { icon: LucideIcon; area: string; value: string }[] = [
  { icon: UserPlus, area: "Admission", value: "Registered · 2025016" },
  { icon: School, area: "Classroom", value: "UKG B · 2026–27" },
  { icon: IndianRupee, area: "Billing", value: "Ledger · ₹3,200 due" },
  { icon: BookOpen, area: "Examinations", value: "First Term · approved" },
  { icon: FileText, area: "Documents", value: "Report card · ID card" },
];

function RecordCard() {
  return (
    <div className="pg-sol-card pg-sol-record pg-sol-rise" style={rise(1)}>
      <span className="pg-sol-avatar" aria-hidden="true">DI</span>
      <span className="pg-sol-who"><b>Diya Iyer</b><small>UKG B · Adm. no. 2025016</small></span>
      <span className="pg-sol-once">Entered once</span>
    </div>
  );
}

function FlowRow({ flow, index }: { flow: (typeof recordFlows)[number]; index: number }) {
  const Icon = flow.icon;
  return (
    <li className="pg-sol-flow pg-sol-rise" style={rise(index + 2)}>
      <span className="pg-sol-flow-icon"><Icon aria-hidden="true" /></span>
      <b>{flow.area}</b>
      <small>{flow.value}</small>
    </li>
  );
}

/** Single campus: one student record that every module reads from. */
export function SingleCampusConsole() {
  return (
    <ConsoleFrame
      name="single"
      title="Riverview Public School"
      scope="One campus · one record"
      label="Illustration: one student record, Diya Iyer of UKG B, entered once and used by admission, classroom, billing, examinations and documents within one school."
    >
      <RecordCard />
      <ul className="pg-sol-flows">
        {recordFlows.map((flow, index) => <FlowRow key={flow.area} flow={flow} index={index} />)}
      </ul>
    </ConsoleFrame>
  );
}

/* ───────────── Multi-campus: a switcher with separate data ───────────── */

type CampusRow = { label: string; value: string; locked?: boolean };

type Campus = {
  id: "whitefield" | "jayanagar";
  short: string;
  name: string;
  role: string;
  rows: readonly CampusRow[];
};

const campuses: readonly Campus[] = [
  {
    id: "whitefield",
    short: "Whitefield",
    name: "Riverview Public School, Whitefield",
    role: "Principal",
    rows: [
      { label: "Students", value: "83 · 8 classes" },
      { label: "Collections", value: "₹2,02,878 collected" },
      { label: "First Term", value: "Completed" },
      { label: "Templates", value: "Whitefield letterhead" },
    ],
  },
  {
    id: "jayanagar",
    short: "Jayanagar",
    name: "Riverview Public School, Jayanagar",
    role: "Exam coordinator",
    rows: [
      { label: "Students", value: "64 · 6 classes" },
      { label: "Collections", value: "Not in your role here", locked: true },
      { label: "First Term", value: "Active · 3 of 6 approved" },
      { label: "Templates", value: "Jayanagar letterhead" },
    ],
  },
];

function CampusSwitch({ activeId, onSelect }: { activeId: Campus["id"]; onSelect: (id: Campus["id"]) => void }) {
  return (
    <div className="pg-sol-switch" role="group" aria-label="Choose campus">
      {campuses.map((campus) => (
        <button key={campus.id} type="button" aria-pressed={campus.id === activeId} onClick={() => onSelect(campus.id)}>
          {campus.short}
        </button>
      ))}
    </div>
  );
}

function CampusRowItem({ row, index }: { row: CampusRow; index: number }) {
  return (
    <li className="pg-sol-rise" data-locked={row.locked ?? false} style={rise(index + 1)}>
      <small>{row.label}</small>
      <b>{row.locked ? <Lock aria-hidden="true" /> : null}{row.value}</b>
    </li>
  );
}

/**
 * Keyed by campus id by the caller, so switching remounts the panel and its
 * rows rise in again: a visible "context changed", not a merged list. The
 * caller's stable wrapper is the live region, so the new campus is announced.
 */
function CampusPanel({ campus }: { campus: Campus }) {
  return (
    <div className="pg-sol-card pg-sol-campus">
      <p className="pg-sol-card-head"><b>{campus.name}</b><span className="pg-sol-role">{campus.role} here</span></p>
      <ul className="pg-sol-campus-rows">
        {campus.rows.map((row, index) => <CampusRowItem key={row.label} row={row} index={index} />)}
      </ul>
    </div>
  );
}

/** Multi-campus: one account, a campus switcher, and each campus's own data and role. */
export function MultiCampusConsole() {
  const [activeId, setActiveId] = useState<Campus["id"]>("whitefield");
  const campus = campuses.find((candidate) => candidate.id === activeId) ?? campuses[0];
  return (
    <ConsoleFrame
      name="multi"
      title="Ritu Sharma · one account"
      scope="2 campuses · separate roles"
      label="Illustrative campus switcher: one account with a separate role and separate records at each campus"
      interactive
    >
      <CampusSwitch activeId={activeId} onSelect={setActiveId} />
      <div className="pg-sol-campus-live" aria-live="polite">
        <CampusPanel key={campus.id} campus={campus} />
      </div>
      <p className="pg-sol-boundary-note"><Lock aria-hidden="true" />Switching changes the context. Records never merge.</p>
    </ConsoleFrame>
  );
}
