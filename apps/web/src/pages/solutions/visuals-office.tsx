import { BadgeCheck, Check, IdCard, Receipt, ScrollText } from "lucide-react";

import { ConsoleFrame, Meter, rise } from "./console-frame";

/* ───────────── Finance teams: collections and dues in ₹ ───────────── */

/** Billed − discounts = collected + due (₹4,72,247 − ₹19,341 = ₹2,02,878 + ₹2,50,028). */
const moneyTiles = [
  { label: "Billed", value: "₹4,72,247", tone: "neutral" },
  { label: "Collected", value: "₹2,02,878", tone: "good" },
  { label: "Discounts", value: "₹19,341", tone: "neutral" },
  { label: "Due", value: "₹2,50,028", tone: "due" },
] as const;

const receipts = [
  { number: "R-0412", name: "Aarav Sharma", group: "8 A", amount: "₹6,500" },
  { number: "R-0411", name: "Meera Nair", group: "LKG A", amount: "₹4,200" },
  { number: "R-0410", name: "Kabir Singh", group: "3 A", amount: "₹5,800" },
] as const;

function MoneyTiles() {
  return (
    <ul className="pg-sol-money">
      {moneyTiles.map((tile, index) => (
        <li key={tile.label} className="pg-sol-rise" data-tone={tile.tone} style={rise(index + 1)}>
          <small>{tile.label}</small>
          <b>{tile.value}</b>
        </li>
      ))}
    </ul>
  );
}

function ReceiptRow({ receipt, index }: { receipt: (typeof receipts)[number]; index: number }) {
  return (
    <li className="pg-sol-receipt" data-new={index === 0} style={rise(index + 6)}>
      <code>{receipt.number}</code>
      <span>{receipt.name}<small>{receipt.group}</small></span>
      <b>{receipt.amount}</b>
    </li>
  );
}

function ReceiptsCard() {
  return (
    <div className="pg-sol-card pg-sol-rise" style={rise(5)}>
      <p className="pg-sol-card-head"><b>Payments today</b><span>receipt + ledger</span></p>
      <ul className="pg-sol-receipts">
        {receipts.map((receipt, index) => <ReceiptRow key={receipt.number} receipt={receipt} index={index} />)}
      </ul>
      <p className="pg-sol-toast"><Receipt aria-hidden="true" />Receipt R-0412 issued · Aarav's ledger updated</p>
    </div>
  );
}

/** Accountant: the session's money at a glance, and payments that issue receipts as they land. */
export function FinanceConsole() {
  return (
    <ConsoleFrame
      name="finance"
      title="Billing · 2026–27"
      scope="Accountant · fees and ledgers"
      label="Illustration: an accountant's billing view for 2026–27 with ₹4,72,247 billed, ₹2,02,878 collected, ₹19,341 in discounts and ₹2,50,028 due, and today's payments each issuing a receipt and updating the student's ledger."
    >
      <MoneyTiles />
      <ReceiptsCard />
    </ConsoleFrame>
  );
}

/* ───────────── Exam teams: lifecycle statuses ───────────── */

type ExamStatus = "active" | "completed" | "approved";

const statusLabel: Record<ExamStatus, string> = { active: "Active", completed: "Completed", approved: "Approved" };

const lifecycle: readonly { status: ExamStatus; count: number }[] = [
  { status: "active", count: 2 },
  { status: "completed", count: 1 },
  { status: "approved", count: 5 },
];

const examRows: readonly { group: string; status: ExamStatus; progress?: [number, number] }[] = [
  { group: "Class 1 A", status: "approved" },
  { group: "Class 3 B", status: "completed" },
  { group: "Class 4 A", status: "active", progress: [28, 32] },
  { group: "Class 5 A", status: "active", progress: [19, 30] },
];

function LifecycleStrip() {
  return (
    <ol className="pg-sol-lifecycle pg-sol-rise" style={rise(1)}>
      <li data-status="plan"><span />Plan</li>
      {lifecycle.map(({ status, count }) => (
        <li key={status} data-status={status}><span />{statusLabel[status]}<b>{count}</b></li>
      ))}
    </ol>
  );
}

function ExamRow({ row, index }: { row: (typeof examRows)[number]; index: number }) {
  const [done, total] = row.progress ?? [0, 0];
  return (
    <li className="pg-sol-exam-row pg-sol-rise" style={rise(index + 2)}>
      <b>{row.group}</b>
      <span className="pg-sol-exam-progress">
        {row.progress ? <><small>Marks {done} of {total}</small><Meter value={Math.round((done / total) * 100)} /></> : <small>Results {statusLabel[row.status].toLowerCase()}</small>}
      </span>
      <span className="pg-sol-status" data-status={row.status}>{statusLabel[row.status]}</span>
    </li>
  );
}

function ExamOutputs() {
  return (
    <ul className="pg-sol-outputs pg-sol-rise" style={rise(7)}>
      <li><IdCard aria-hidden="true" />Admit cards<small><Check aria-hidden="true" />generated</small></li>
      <li><ScrollText aria-hidden="true" />Report cards<small><BadgeCheck aria-hidden="true" />after approval</small></li>
    </ul>
  );
}

/** Exam cell: one plan's lifecycle, class-by-class status and the official outputs. */
export function ExamConsole() {
  return (
    <ConsoleFrame
      name="exams"
      title="First Term Examination"
      scope="Exam coordinator"
      label="Illustration: an exam coordinator's First Term plan across 8 classes, with 2 active, 1 completed and 5 approved; Class 4 A has 28 of 32 marks entered, admit cards are generated and report cards follow approval."
    >
      <LifecycleStrip />
      <ul className="pg-sol-card pg-sol-exam-rows">
        {examRows.map((row, index) => <ExamRow key={row.group} row={row} index={index} />)}
        <li className="pg-sol-exam-more">+ 4 more classes approved</li>
      </ul>
      <ExamOutputs />
    </ConsoleFrame>
  );
}
