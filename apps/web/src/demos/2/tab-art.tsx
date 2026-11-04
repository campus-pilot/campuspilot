import { BadgeCheck, Bot, Check, Clock3, IdCard, Lock, Printer, ShieldCheck, Sparkles, Stamp } from "lucide-react";

/** `--i` drives the staggered entrance delay of `.d2-rise` children inside the active panel. */
function stagger(index: number) {
  return { "--i": index } as React.CSSProperties;
}

/* ───────────── Admissions ───────────── */

const admissionSteps = ["Enquiry", "Registration", "Class allocation", "Student record"];

const admissionRows = [
  ["Diya Iyer", "2025016", "UKG B", "Suresh Iyer"],
  ["Aarav Sharma", "2025015", "Class 8 A", "Rajesh Sharma"],
  ["Kabir Singh", "2025014", "Class 3 A", "Harpreet Singh"],
  ["Meera Nair", "2025013", "LKG A", "Anil Nair"],
] as const;

export function AdmissionsArt() {
  return (
    <div className="d2-art d2-art-admissions" aria-hidden="true">
      <ol className="d2-steps d2-rise" style={stagger(1)}>
        {admissionSteps.map((step, index) => (
          <li key={step} style={stagger(index)}><span className="d2-step-dot" />{step}</li>
        ))}
      </ol>
      <div className="d2-table d2-rise" style={stagger(2)}>
        <p className="d2-table-caption"><b>Admissions</b><span>85 · 83 currently registered</span></p>
        <div className="d2-row d2-row-head"><span>Name</span><span>Admission no.</span><span>Class</span><span>Father's name</span></div>
        {admissionRows.map((row, index) => (
          <div className="d2-row" data-new={index === 0} key={row[1]} style={stagger(index + 3)}>
            {row.map((cell) => <span key={cell}>{cell}</span>)}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────── Fees & receipts ───────────── */

/** Billed − discounts = payments + due (₹4,72,247 − ₹19,341 = ₹2,02,878 + ₹2,50,028). */
const billingTiles = [
  ["Billed", "₹4,72,247"],
  ["Payments", "₹2,02,878"],
  ["Discounts", "₹19,341"],
  ["Due", "₹2,50,028"],
] as const;

export function FeesArt() {
  return (
    <div className="d2-art d2-art-fees" aria-hidden="true">
      <ul className="d2-tiles d2-rise" style={stagger(1)}>
        {billingTiles.map(([label, value]) => (
          <li key={label} data-tone={label.toLowerCase()}><small>{label}</small><b>{value}</b></li>
        ))}
      </ul>
      <div className="d2-fees-row">
        <ReceiptCard />
        <LedgerCard />
      </div>
    </div>
  );
}

function ReceiptCard() {
  return (
    <div className="d2-receipt d2-rise" style={stagger(2)}>
      <p className="d2-receipt-head"><b>Fee receipt</b><span>RCP-2026-0418</span></p>
      <p className="d2-receipt-line"><span>Tuition · Term 2</span><b>₹10,500</b></p>
      <p className="d2-receipt-line"><span>Transport · Term 2</span><b>₹2,000</b></p>
      <p className="d2-receipt-line d2-receipt-total"><span>Total paid</span><b>₹12,500</b></p>
      <p className="d2-receipt-foot"><Printer /> Ready to print</p>
      <span className="d2-stamp"><Stamp /> Paid</span>
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
    <div className="d2-ledger d2-rise" style={stagger(3)}>
      <p className="d2-ledger-head"><b>Student ledger</b><small>Aarav Sharma · 8 A</small></p>
      <ul>
        {ledgerLines.map(([label, amount], index) => (
          <li key={label} style={stagger(index + 4)}><span>{label}</span><b>{amount}</b></li>
        ))}
      </ul>
    </div>
  );
}

/* ───────────── Examinations ───────────── */

const exams = [
  ["First Term Examination", "8 classes · 45 subject plans", "Completed"],
  ["Second Term Examination", "8 classes · marks entry open", "In progress"],
  ["Annual Examination", "Timetable drafted", "Planned"],
] as const;

const marks = [
  ["Riya D.", 92],
  ["Arjun S.", 78],
  ["Kavya N.", 85],
  ["Rohan T.", 96],
] as const;

export function ExamsArt() {
  return (
    <div className="d2-art d2-art-exams" aria-hidden="true">
      <ul className="d2-exam-list d2-rise" style={stagger(1)}>
        {exams.map(([name, detail, status]) => (
          <li key={name} data-status={status}><span><b>{name}</b><small>{detail}</small></span><em>{status}</em></li>
        ))}
      </ul>
      <MarksCard />
    </div>
  );
}

function MarksCard() {
  return (
    <div className="d2-marks d2-rise" style={stagger(2)}>
      <p className="d2-marks-head"><b>Marks entry</b><small>Class 8 A · Science · out of 100</small></p>
      <ul>
        {marks.map(([name, score], index) => (
          <li key={name} style={{ ...stagger(index), "--score": `${score}%` } as React.CSSProperties}>
            <span>{name}</span><i className="d2-mark-bar" /><b>{score}</b>
          </li>
        ))}
      </ul>
      <span className="d2-approved"><BadgeCheck /> Approved · report cards ready</span>
    </div>
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

export function DocumentsArt() {
  return (
    <div className="d2-art d2-art-documents" aria-hidden="true">
      <div className="d2-doc-stack d2-rise" style={stagger(1)}>
        <span className="d2-sheet d2-sheet-back"><IdCard /> ID card</span>
        <span className="d2-sheet d2-sheet-mid"><Clock3 /> Admit card</span>
        <ReportSheet />
      </div>
      <ul className="d2-doc-kinds d2-rise" style={stagger(2)}>
        {docKinds.map((kind, index) => <li key={kind} style={stagger(index)}><Check />{kind}</li>)}
      </ul>
    </div>
  );
}

function ReportSheet() {
  return (
    <div className="d2-sheet d2-sheet-front">
      <p className="d2-sheet-school"><b>Riverview Public School</b><small>Half-yearly examination · 2026–27</small></p>
      <p className="d2-sheet-meta"><span>Aarav Sharma</span><span>Class 8 A</span><span>Roll 14</span></p>
      <ul className="d2-sheet-table">
        {reportRows.map(([subject, score, grade]) => (
          <li key={subject}><span>{subject}</span><span>{score}</span><b>{grade}</b></li>
        ))}
      </ul>
      <p className="d2-sheet-foot"><span>Generated from live records</span><BadgeCheck /></p>
    </div>
  );
}

/* ───────────── AI-ready ───────────── */

export function AiArt() {
  return (
    <div className="d2-art d2-art-ai" aria-hidden="true">
      <div className="d2-chat d2-rise" style={stagger(1)}>
        <p className="d2-chat-who"><Bot /> Assistant for <b>Ms. Anjali Rao</b> · Class teacher, 8 A</p>
        <p className="d2-bubble d2-bubble-q" style={stagger(0)}>Whose Science marks are still pending?</p>
        <p className="d2-bubble d2-bubble-a" style={stagger(1)}><b>3 students in 8 A:</b> Ishaan R., Sana K. and Vivaan M.<small><ShieldCheck /> Within your assigned classrooms</small></p>
        <p className="d2-bubble d2-bubble-q" style={stagger(2)}>And the fee dues for the whole school?</p>
        <p className="d2-bubble d2-bubble-denied" style={stagger(3)}><Lock /> That is outside your access, so I can't see it. Ask the accounts office.</p>
      </div>
      <div className="d2-agent d2-rise" style={stagger(2)}>
        <p className="d2-agent-head"><Sparkles /> Prepared for review <em>Roadmap</em></p>
        <p className="d2-agent-task"><b>Fee-reminder list · Class 8</b><small>11 families · draft, waiting for Accounts to approve</small></p>
      </div>
    </div>
  );
}
