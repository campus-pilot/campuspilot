export {
  DOCUMENT_MARKETPLACE,
  NOTICE_DEFAULT_TEMPLATE_SLUG,
} from "./document.catalog.marketplace";
import type { DocumentType } from "./document.dto";
import type { QuestionPaperContext } from "../question-paper/question-paper.context";
import { QUESTION_PAPER_SLOT } from "../question-paper/question-paper.slot";
import { withReportModeLayout } from "./document.report-modes";

/** Synthetic editor data never reads another school's students or results. */
const SAMPLE_DOCUMENT_SOURCE = {
  school: {
    name: "Greenwood Public School",
    location: "School Road, Bengaluru",
    registrationNo: "SCH-2026",
    logoUrl:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAACsUlEQVR4nO2dPVIDMQyFHYaeM3AhSg6TA+QwlFyIE1BQUYaC2cHsbOI/SU+y39czsd9nyesA69P1+/OaCIwH9ABWhwLAUAAYCgBDAWAoAAwFgHlED6CWy+tz88+c3z4URiLLyetBrCfwEh6FuBKgEfotvMiAC7AM/RZIGTABHoLfgxBhLsBj8HssRZg+hkYIPyXbcZpUQJTgj9CuBvUKiBx+SvrjVxUQPfwNzXmotKBZgj9CuiWJV8DM4ackPz9RAbOHvyE5TzEBq4S/ITVffh0NRkQAcvWf379gny0x72EBHsKPLGHoMRQV/r3ALy9PhiP5o/fxNNweUFrtyGrooVsAYvXXhouQ0JtHVwuyDn8kUOuW1NqK3Leg0dXsvSU1V4DV6tcIzqoaWqrAZQVorVqP1dAkwGL1a4dkIaElJzd/mGW5OrfPQp0Zcly0IFRr8NCSqgVotR90CFqfX5sXrAWhg89BtiRIC/IUfg5iXFXnAKn24zX4I6SqoXQmMKuASOGnZDdeEwHRwt+wGLfqJhw1+BztDbpYAb39f4bwc3rnU8pPrQL2KyaiEIvHUhcn4ZWhADAUAIYCwLj5OrqGlk0xyqbPCgBDAWAoAAwFgKEAMBQApijAy0stouLmFzLkGAoAQwFgqgRwH+ijJjdWABgKAFMtgG2ojdq8WAFgKABMkwC2oTrC/4vSSjQLYBXcZ7p/U52d7ndFrPZ+oBp6ukN3BbAV/WeZl3XMxpAAVsEvIzkMV8DqEkbnL9KCVpUgMW/uAWDEBKxWBVLzFa2AVSRIzlO8Bc0uQXp+qvcHzHRa1lpYqpvwLNWgOQ/1p6DoErTHb3qJT6SWZLVwTM8BUarBcpy8RyxjiXvE9ngQseRNekfwLklH8DZVZ/A+YaICv44GQwFgKAAMBYChADAUAOYHGv05csL2gJ8AAAAASUVORK5CYII=",
  },
  session: { startYear: 2026, endYear: 2027 },
  exam: { name: "Term I Examination", slug: "term-1", order: 1 },
  student: {
    name: "Aarav Sharma",
    admissionNo: "2026-0142",
    rollNo: "12",
    className: "Grade 8",
    sectionName: "A",
    fatherName: "Raj Sharma",
    motherName: "Meera Sharma",
    dob: "2013-06-15",
    phoneNo: "+91 98765 43210",
    whatsappNo: "+91 98765 43210",
    address: "School Road, Bengaluru",
    photoUrl: null,
  },
  subjects: [
    {
      name: "Mathematics",
      total: 88,
      totalMarks: 100,
      percentage: 88,
      grade: "A",
      marks: { written: 88 },
      modeConfig: {
        written: { name: "Written", percentage: 100, maxMarks: 100 },
      },
      attendance: { daysAttended: 82, totalWorkingDays: 90 },
      coScholastics: { art: { areaName: "Art", grade: "A" } },
    },
    {
      name: "English",
      slug: "english",
      marks: { written: 92 },
      modeConfig: {
        written: { name: "Written", percentage: 100, maxMarks: 100 },
      },
      total: 92,
      totalMarks: 100,
      percentage: 92,
      grade: "A+",
    },
  ],
  grandTotal: 180,
  grandMaxMarks: 200,
  overallPercentage: 90,
  overallGrade: "A+",
  gradingScale: { a: { label: "A", minScore: 80 } },
  attendanceEnabled: true,
  assessmentApproved: true,
  attendance: { daysAttended: 82, totalWorkingDays: 90, percentage: 91.1 },
  coScholastics: { art: { areaName: "Art & Craft", grade: "A" } },
  coScholasticAreas: { art: { name: "Art & Craft" } },
  reportSections: {
    includeModeMarks: true,
    includeAttendance: true,
    includeCoScholastics: true,
    includeGradingScale: true,
  },
  timetable: [
    {
      date: "2026-10-20",
      displayDate: "20 Oct 2026",
      dayOfWeek: "Tuesday",
      displayStartTime: "9:00 AM",
      displayEndTime: "12:00 PM",
      startTime: "09:00",
      endTime: "12:00",
      subjectName: "Mathematics",
      modeName: "Written",
    },
  ],
  columns: [{ classId: "sample-class", label: "Grade 8" }],
  rows: [
    {
      date: "2026-10-20",
      displayDate: "20 Oct 2026",
      dayOfWeek: "Tuesday",
      displayStartTime: "9:00 AM",
      displayEndTime: "12:00 PM",
      startTime: "09:00",
      endTime: "12:00",
      cells: {
        "sample-class": { subjectName: "Mathematics", modeName: "Written" },
      },
      entries: [
        { subjects: [{ subjectName: "Mathematics", modeName: "Written" }] },
      ],
    },
  ],
  generatedAt: "2026-10-15T09:00:00.000Z",
  admission: { name: "Aarav Sharma", number: "2026-0142", fatherName: "Raj Sharma", motherName: "Meera Sharma", classLabel: "Grade 8", sectionLabel: "A", rollNumber: "12" },
  currency: { code: "INR", exponent: 2 },
  bill: { id: "sample-bill", number: "B/2026/000001", issueDate: "2026-10-01", periodKey: "2026-10", total: "2500.00", totalMinor: "250000" },
  lines: [{ slug: "tuition", name: "Tuition fee", amount: "2500.00", amountMinor: "250000", pricingSource: "session" }],
  balanceBefore: "500.00",
  balanceAfter: "3000.00",
  payment: { id: "sample-payment", receiptNumber: "R/2026/000001", receivedAt: "2026-10-15T09:00:00.000Z", amount: "1500.00", amountMinor: "150000", method: "cash", externalReference: null, payerName: "Raj Sharma", note: null },
  transaction: { kind: "payment", isRefund: false, id: "sample-payment", documentNumber: "R/2026/000001" },
  previousBalance: "3000.00",
  remainingBalance: "1500.00",
  statement: { periodStartDate: "2026-10-01", throughDate: "2026-10-20", asOfSequence: "12", openingBalance: "3000.00", openingBalanceMinor: "300000", closingBalance: "1500.00", closingBalanceMinor: "150000" },
  entries: [{ sequence: "12", effectiveAt: "2026-10-15", reference: "R/2026/000001", description: "Payment", debit: "", credit: "1500.00", balance: "1500.00" }],
};
/** The sample carries the same derived report mode columns as live contexts. */
export const SAMPLE_DOCUMENT_CONTEXT = withReportModeLayout(SAMPLE_DOCUMENT_SOURCE);

/**
 * Synthetic notice data. A notice context holds school, session and notice
 * facts only (no student, exam or finance data), so notice templates are
 * previewed and validated against exactly the shape they are rendered with
 * (`buildNoticeContext` in `routers/school/notice`).
 */
export const SAMPLE_NOTICE_CONTEXT = {
  school: SAMPLE_DOCUMENT_SOURCE.school,
  session: SAMPLE_DOCUMENT_SOURCE.session,
  generatedAt: SAMPLE_DOCUMENT_SOURCE.generatedAt,
  /**
   * The paper the notice is printed on (`notice.page_size`), so one design
   * can adapt to both sizes, for example with a class such as
   * `notice--{{print.size}}`. Widened to both values: the sample renders at
   * full size, and save-time checks render it at half size too.
   */
  print: { size: "full" as "full" | "half" },
  notice: {
    title: "Annual Sports Day",
    issuedOn: "2026-10-15",
    issuedOnDisplay: "15 October 2026",
    paragraphs: [
      "The Annual Sports Day will be held on Saturday, 24 October 2026, on the school grounds. Students should report by 8:00 AM in their house uniform.",
      "Parents are warmly invited to attend. Kindly be seated by 8:30 AM.\nRefreshments will be served after the prize distribution.",
    ],
  },
};

/**
 * Synthetic question paper data: school, session, exam and paper facts only,
 * exactly the shape of a real render (`QuestionPaperContext`). `bodyHtml` is
 * the slot placeholder, as in every real render; the previews substitute a
 * sample body for it.
 */
export const SAMPLE_QUESTION_PAPER_CONTEXT = {
  school: SAMPLE_DOCUMENT_SOURCE.school,
  session: SAMPLE_DOCUMENT_SOURCE.session,
  generatedAt: SAMPLE_DOCUMENT_SOURCE.generatedAt,
  exam: { name: "Half Yearly Examination", slug: "half-yearly", order: 2 },
  questionPaper: {
    className: "Class 8",
    subjectName: "Science",
    subjectSlug: "science",
    modeName: "Theory",
    modeSlug: "theory",
    maxMarks: 20,
    totalMarks: null,
    timeAllowed: null,
    language: null,
    script: null,
    direction: "ltr",
    versionNo: 1,
    bodyHtml: QUESTION_PAPER_SLOT,
  },
} satisfies QuestionPaperContext;

/** The synthetic context a template of `documentType` is previewed with. */
export function sampleDocumentContext(documentType: DocumentType): object {
  if (documentType === "notice") return SAMPLE_NOTICE_CONTEXT;
  if (documentType === "question_paper") return SAMPLE_QUESTION_PAPER_CONTEXT;
  return SAMPLE_DOCUMENT_CONTEXT;
}

export const DOCUMENT_CONTEXT_HELP = `All documents: school.{name,location,registrationNo,logoUrl}, session.{startYear,endYear}, generatedAt.
Student documents: student.{name,admissionNo,rollNo,className,sectionName,dob,fatherName,motherName,address,phoneNo,whatsappNo,photoUrl}; phoneNo and whatsappNo are display-formatted with the country code (+91 98765 43210), whatsappNo is null when there is none.
Examination documents: exam.{name,slug,order,status,startedAt,completedAt}; unknown historical lifecycle/timestamps are null.
Report cards: subjects[] with slug,name,total,totalMarks,percentage,grade,marks[modeSlug],modeConfig[modeSlug].{name,percentage,maxMarks}, modeCells[] aligned with modeColumns, each {slug,applicable,mark,maxMarks} (applicable is false and mark/maxMarks null when the subject has no such mode); modeColumns[] is the union of every subject's modes ordered by name then slug, each {slug,name,maxMarks} where maxMarks is null unless every subject with the mode shares one maximum. Build mode-mark tables from modeColumns and subjects[].modeCells, never from one subject's modeConfig; grandTotal,grandMaxMarks,overallPercentage,overallGrade; gradingScale[gradeKey].{label,minScore}, sorted highest threshold first.
Exam-wide assessment: attendanceEnabled is the session configuration flag; attendance is nullable or {daysAttended,totalWorkingDays,percentage}; coScholastics[areaSlug].{areaName,grade} is nullable; coScholasticAreas[areaSlug].{name} holds configured definitions; assessmentApproved is true/false/null. Missing values stay null; zero attendance/marks remain zero. Shared values come only from the approved student exam assessment and exam working-day settings. Never infer shared values from legacy subject metadata.
Report printing flags: reportSections.{includeModeMarks,includeAttendance,includeCoScholastics,includeGradingScale}. Templates must honor these independent print choices; they do not change configuration, grading, or approval facts. Subjects may retain legacy per-subject attendance/coScholastics for older templates; these are not the exam-wide values.
Admit cards: exam, timetable[] with date (ISO),displayDate,dayOfWeek,startTime,endTime (HH:mm),displayStartTime,displayEndTime,subjectSlug,subjectName,modeSlug,modeName; may be empty.
Timetables: columns[] with classId,label; rows[] with date,displayDate,dayOfWeek,startTime,endTime,displayStartTime,displayEndTime. rows[].entries[] follows column order, each with classId,subjects[] of subjectSlug,subjectName,modeSlug,modeName. Unscheduled cells have an empty subjects array. For v1 template compatibility, rows[].cells[classId] is a resolved single subject, an array preserving all subjects/modes, or null. Calendar formatting never shifts dates through the host timezone.
Finance documents: admission.{name,number,fatherName,motherName,classLabel,sectionLabel,rollNumber}; currency.{code,exponent}. Bills expose bill.{id,number,issueDate,periodKey,total,totalMinor}, lines[].{slug,name,amount,amountMinor,pricingSource}, balanceBefore and balanceAfter. Receipts expose transaction.{kind,isRefund,id,documentNumber}, payment.{id,receiptNumber,receivedAt,amount,amountMinor,method,externalReference,payerName,note}, previousBalance and remainingBalance. Payments are admission-account credits and receipts never expose bill allocations. Refund contexts set transaction.isRefund and the payment fields describe returned funds. Statements expose statement.{periodStartDate,throughDate,asOfSequence,openingBalance,openingBalanceMinor,closingBalance,closingBalanceMinor} and period entries[].{sequence,effectiveAt,reference,description,debit,credit,balance}. Bill and receipt balances are pinned to the source fact's effective-date ledger position; statement balances are pinned to the reviewed cutoff. They never use current projections.
Notices: only school, session, generatedAt, print.size and notice.{title,issuedOn,issuedOnDisplay,paragraphs[]} exist; there is no student, exam or finance data. issuedOn is an ISO date (the publication date; today for a draft) and issuedOnDisplay the same date in words. paragraphs[] holds the plain text of the notice split at blank lines, each a string that may contain line breaks: render each with {{this}} inside an element styled white-space:pre-wrap. print.size is the paper each notice chooses: "full" (portrait A4 pages, 16mm margin) or "half" (210mm x 148.5mm pages, 10mm margin, printed two copies per A4 sheet). One Notice design serves both sizes, so adapt to it with a class, for example <div class="notice notice--{{print.size}}"> with a .notice--half rule for a compact letterhead and smaller type. Notices flow over as many pages as they need: do not set a fixed height, overflow:hidden or outer page padding.
Question papers: school.{name,location,registrationNo,logoUrl}, session.{startYear,endYear}, generatedAt, exam.{name,slug,order}, questionPaper.{className,subjectName,subjectSlug,modeName,modeSlug,maxMarks,totalMarks,timeAllowed,language,script,direction,versionNo,bodyHtml}. maxMarks may be null; totalMarks, timeAllowed, language and script are always null (the paper is free HTML and nothing is read out of it) and direction is always ltr. The questions are NOT part of the template: put {{{questionPaper.bodyHtml}}} exactly once, in element content, where the questions belong (triple braces; it is a fixed placeholder that the system replaces with the printed questions after sanitising). Question papers flow over as many full A4 pages as needed: do not set a fixed height, overflow:hidden or outer page padding. Put the school heading in normal flow above the body and a footer in an element with position:fixed; bottom:0 (left:0; right:0; at most 12mm tall) so it repeats on every page; never use a negative bottom, which drops the footer from the first page. The system sets @page to A4 with margins 14mm 14mm 10mm and keeps a 14mm band free at the bottom of every page for the footer. The dir and lang attributes are not kept by the sanitiser: set direction with style="direction:{{questionPaper.direction}}" on the root element. Fonts: the question text carries its own script fonts; set font-family in the template only for the header and footer (Noto Sans and Noto Sans Devanagari/Bengali/Tamil/Telugu/Kannada/Malayalam/Gujarati/Gurmukhi/Oriya are installed).
Use standard Handlebars each/if/unless/with/lookup helpers and the finite-numeric add helper (for example add columns.length 2). Images use provided data URIs. No scripts, forms, links, external URLs/fonts or network assets. Self-contained CSS is allowed. ID cards fit 86mm by 54mm; timetables use landscape A4; report cards use full portrait A4. Admit cards, bills, receipts, and statements use the selected template revision's explicit full-A4 or half-A4 footprint; half-A4 revisions are imposed two per portrait A4 sheet.`;
