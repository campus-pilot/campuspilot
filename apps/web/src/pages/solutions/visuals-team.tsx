import { ArrowUpRight, Check, CircleAlert, FileText, Lock, PenLine, Users } from "lucide-react";

import { ConsoleFrame, Meter, rise } from "./console-frame";

/* ───────────── School leaders: cross-school status ───────────── */

type PulseTile = { label: string; value: string; note: string; tone: "good" | "watch"; meter?: number };

const pulseTiles: readonly PulseTile[] = [
  { label: "Admissions", value: "85", note: "83 registered", tone: "good" },
  { label: "Collections", value: "₹2,02,878", note: "42.96% realized", tone: "watch", meter: 43 },
  { label: "Students", value: "83", note: "8 classes", tone: "good" },
  { label: "First Term", value: "Completed", note: "45 subject plans", tone: "good" },
];

const attention = [
  { text: "₹2,50,028 outstanding", area: "Billing" },
  { text: "2 admissions awaiting registration", area: "Admission" },
  { text: "First Term results ready to approve", area: "Examinations" },
] as const;

function PulseTileItem({ tile, index }: { tile: PulseTile; index: number }) {
  return (
    <li className="pg-sol-tile pg-sol-rise" data-tone={tile.tone} style={rise(index + 1)}>
      <small>{tile.label}</small>
      <b>{tile.value}</b>
      <span className="pg-sol-tile-note">{tile.note}</span>
      {tile.meter ? <Meter value={tile.meter} /> : null}
    </li>
  );
}

function AttentionList() {
  return (
    <div className="pg-sol-card pg-sol-rise" style={rise(5)}>
      <p className="pg-sol-card-head"><b>Needs attention</b><span>across the school</span></p>
      <ul className="pg-sol-attention">
        {attention.map((item) => (
          <li key={item.text}>
            <CircleAlert aria-hidden="true" />
            <span>{item.text}</span>
            <small>{item.area}<ArrowUpRight aria-hidden="true" /></small>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Principal: every module's status for the session, plus what needs a decision. */
export function LeaderConsole() {
  return (
    <ConsoleFrame
      name="leaders"
      title="Riverview Public School · 2026–27"
      scope="Principal · whole school"
      label="Illustration: a principal's session dashboard with admissions, collections, students and First Term status across the whole school, plus a short list of items that need attention."
    >
      <ul className="pg-sol-tiles">
        {pulseTiles.map((tile, index) => <PulseTileItem key={tile.label} tile={tile} index={index} />)}
      </ul>
      <AttentionList />
    </ConsoleFrame>
  );
}

/* ───────────── Administrators: student journeys ───────────── */

const journeyStages = ["Enquiry", "Registered", "Class allocated", "Student record"] as const;

const journeys = [
  { name: "Anaya Bose", group: "Nursery", stage: 0 },
  { name: "Ira Kapoor", group: "LKG", stage: 1 },
  { name: "Vihaan Rao", group: "Class 1", stage: 1 },
  { name: "Diya Iyer", group: "UKG B", stage: 3 },
] as const;

function JourneyTrack({ stage }: { stage: number }) {
  return (
    <ol className="pg-sol-track" aria-hidden="true">
      {journeyStages.map((name, index) => <li key={name} data-done={index <= stage} />)}
    </ol>
  );
}

function JourneyRow({ name, group, stage, index }: { name: string; group: string; stage: number; index: number }) {
  return (
    <li className="pg-sol-journey pg-sol-rise" style={rise(index + 1)}>
      <span className="pg-sol-who"><b>{name}</b><small>{group}</small></span>
      <JourneyTrack stage={stage} />
      <span className="pg-sol-stage" data-final={stage === journeyStages.length - 1}>{journeyStages[stage]}</span>
    </li>
  );
}

function BulkJob() {
  return (
    <div className="pg-sol-card pg-sol-job pg-sol-rise" style={rise(6)}>
      <span className="pg-sol-job-icon"><FileText aria-hidden="true" /></span>
      <span className="pg-sol-job-text"><b>ID cards · Class 1 A</b><small>16 of 16 generated · print-ready PDF</small></span>
      <Meter value={100} />
    </div>
  );
}

/** Administrator: each admission's place in the journey, and a bulk document run. */
export function AdminConsole() {
  return (
    <ConsoleFrame
      name="admins"
      title="Admissions · 2026–27"
      scope="Administrator"
      label="Illustration: an administrator's admissions view where each student moves from enquiry to registration, class allocation and a student record, with a finished bulk run of ID cards for Class 1 A."
    >
      <ul className="pg-sol-journeys">
        {journeys.map((row, index) => <JourneyRow key={row.name} {...row} index={index} />)}
      </ul>
      <BulkJob />
    </ConsoleFrame>
  );
}

/* ───────────── Teachers: only assigned classes ───────────── */

const assigned = [
  { name: "Class 3 B", duty: "Class teacher", note: "Attendance marked · 29 of 30 present", icon: Users },
  { name: "Class 4 A", duty: "Mathematics", note: "First Term marks · 28 of 32", icon: PenLine, meter: 88 },
] as const;

const unassigned = ["3 A", "4 B", "5 A", "5 B", "6 A"] as const;

function AssignedClass({ item, index }: { item: (typeof assigned)[number]; index: number }) {
  const Icon = item.icon;
  return (
    <li className="pg-sol-card pg-sol-class pg-sol-rise" style={rise(index + 1)}>
      <p className="pg-sol-class-head"><Icon aria-hidden="true" /><b>{item.name}</b><span>{item.duty}</span></p>
      <small><Check aria-hidden="true" />{item.note}</small>
      {"meter" in item ? <Meter value={item.meter} /> : null}
    </li>
  );
}

function LockedClasses() {
  return (
    <div className="pg-sol-locked pg-sol-rise" style={rise(3)}>
      <small>Not assigned · stays closed</small>
      <ul>
        {unassigned.map((name) => <li key={name}><Lock aria-hidden="true" />{name}</li>)}
      </ul>
    </div>
  );
}

/** Teacher: two assigned classes open, every other class locked. */
export function TeacherConsole() {
  return (
    <ConsoleFrame
      name="teachers"
      title="Ms. Kavita Rao"
      scope="Teacher · 2 assigned classes"
      label="Illustration: a teacher's workspace showing only her assigned classes, Class 3 B as class teacher and Class 4 A for mathematics with marks 28 of 32 entered, while other classes stay locked."
    >
      <ul className="pg-sol-classes">
        {assigned.map((item, index) => <AssignedClass key={item.name} item={item} index={index} />)}
      </ul>
      <LockedClasses />
    </ConsoleFrame>
  );
}
