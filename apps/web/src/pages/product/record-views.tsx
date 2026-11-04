/**
 * "One record, many views": the same fictional student as seen by the
 * principal, the class teacher, the accountant and the family. A role switcher
 * (toggle buttons with `aria-pressed`) re-renders the record card; areas the
 * role may not see collapse into a locked placeholder.
 */
import {
  ArrowRight,
  BookUser,
  Bot,
  CalendarCheck,
  ClipboardCheck,
  FileText,
  FolderLock,
  HeartHandshake,
  IndianRupee,
  Lock,
  PenLine,
  School,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { Section, SectionIntro } from "@/site/ui/section";

type RoleId = "principal" | "class-teacher" | "accountant" | "family";

type Role = { id: RoleId; label: string; person: string; icon: LucideIcon; caption: string };

const roles: readonly Role[] = [
  {
    id: "principal",
    label: "Principal",
    person: "Ms. Anjali Desai",
    icon: ClipboardCheck,
    caption: "The principal sees the whole record and is the one who approves the report card.",
  },
  {
    id: "class-teacher",
    label: "Class teacher",
    person: "Ms. Kavya Rao · Class 3 B",
    icon: PenLine,
    caption: "Ms. Rao sees attendance and marks for her own class. The fee ledger and admission file stay out of her view.",
  },
  {
    id: "accountant",
    label: "Accountant",
    person: "Mr. Suresh Nair",
    icon: IndianRupee,
    caption: "The accountant sees the fee ledger and who to contact about it. Attendance and marks are not his to see.",
  },
  {
    id: "family",
    label: "Family",
    person: "Rajesh Menon · father",
    icon: HeartHandshake,
    caption: "The family sees their own child's receipts, attendance and approved report card. Marks still being entered stay with the school.",
  },
];

type RecordField = { icon: LucideIcon; label: string; value: string; visibleTo: readonly RoleId[] };

const everyone: readonly RoleId[] = ["principal", "class-teacher", "accountant", "family"];

/** Illustrative visibility for the mockup; real access follows each school's role setup. */
const fields: readonly RecordField[] = [
  { icon: UserRound, label: "Student", value: "Meera Menon · Adm. no. 2025016", visibleTo: everyone },
  { icon: School, label: "Class", value: "Class 3 · Section B · 2026–27", visibleTo: everyone },
  { icon: BookUser, label: "Guardian", value: "Rajesh Menon, father", visibleTo: everyone },
  { icon: IndianRupee, label: "Fee ledger", value: "₹18,400 billed · ₹0 due", visibleTo: ["principal", "accountant", "family"] },
  { icon: CalendarCheck, label: "Attendance", value: "94% present this term", visibleTo: ["principal", "class-teacher", "family"] },
  { icon: PenLine, label: "Marks in progress", value: "First Term · 5 of 6 subjects entered", visibleTo: ["principal", "class-teacher"] },
  { icon: FileText, label: "Report card", value: "First Term · approved", visibleTo: ["principal", "class-teacher", "family"] },
  { icon: FolderLock, label: "Admission file", value: "Birth certificate and TC verified", visibleTo: ["principal"] },
];

function RoleButton({ role, pressed, onSelect }: { role: Role; pressed: boolean; onSelect: (id: RoleId) => void }) {
  const Icon = role.icon;
  return (
    <button type="button" className="pg-product-role" aria-pressed={pressed} onClick={() => onSelect(role.id)}>
      <span className="pg-product-role-icon" aria-hidden="true">
        <Icon />
      </span>
      <span className="pg-product-role-text">
        <b>{role.label}</b>
        <small>{role.person}</small>
      </span>
    </button>
  );
}

function RoleSwitch({ selected, onSelect }: { selected: RoleId; onSelect: (id: RoleId) => void }) {
  return (
    <div className="pg-product-roles" role="group" aria-label="View Meera's record as">
      {roles.map((role) => (
        <RoleButton key={role.id} role={role} pressed={role.id === selected} onSelect={onSelect} />
      ))}
    </div>
  );
}

function FieldRow({ field, visible, index }: { field: RecordField; visible: boolean; index: number }) {
  const Icon = visible ? field.icon : Lock;
  return (
    <li className="pg-product-field" data-visible={visible} style={{ "--pg-i": index } as React.CSSProperties}>
      <span className="pg-product-field-icon" aria-hidden="true">
        <Icon />
      </span>
      <span className="pg-product-field-label">{field.label}</span>
      {visible ? (
        <b className="pg-product-field-value">{field.value}</b>
      ) : (
        <span className="pg-product-field-hidden">Not in this view</span>
      )}
    </li>
  );
}

/** Keyed by role in the parent, so the rows replay their entrance on every switch. */
function RecordSheet({ role }: { role: Role }) {
  const visibleCount = fields.filter((field) => field.visibleTo.includes(role.id)).length;
  return (
    <div className="pg-product-sheet">
      <div className="pg-product-sheet-head">
        <span>
          Viewing as <b>{role.label}</b>
        </span>
        <span className="pg-product-sheet-count">
          {visibleCount} of {fields.length} areas
        </span>
      </div>
      <ul className="pg-product-fields">
        {fields.map((field, index) => (
          <FieldRow key={field.label} field={field} visible={field.visibleTo.includes(role.id)} index={index} />
        ))}
      </ul>
    </div>
  );
}

function AssistantNote() {
  return (
    <p className="pg-product-views-note">
      <Bot aria-hidden="true" />
      <span>An AI assistant asked on someone's behalf gets exactly that person's view, never more.</span>
      <Link className="cp-text-link" to="/ai-ready">
        How AI-ready works <ArrowRight aria-hidden="true" />
      </Link>
    </p>
  );
}

function RecordViews() {
  const [selected, setSelected] = useState<RoleId>("principal");
  const role = roles.find((entry) => entry.id === selected) ?? roles[0];
  return (
    <div className="pg-product-views">
      <div className="pg-product-views-side">
        <RoleSwitch selected={selected} onSelect={setSelected} />
        <p className="pg-product-views-caption" aria-live="polite">
          {role.caption}
        </p>
      </div>
      <RecordSheet key={role.id} role={role} />
    </div>
  );
}

export function RecordViewsSection() {
  return (
    <Section id="one-record" labelledBy="one-record-title">
      <SectionIntro
        id="one-record-title"
        eyebrow="One record, many views"
        eyebrowIcon={UserRound}
        title="One student. Everyone sees their part."
        description="There is one Meera in CampusPilot, not four copies in four files. The principal, her class teacher, the accountant and her family open the same record, and each sees only what their role allows."
      />
      <RecordViews />
      <AssistantNote />
    </Section>
  );
}
