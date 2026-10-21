export { DOCUMENT_MARKETPLACE } from "./document.catalog.marketplace";

/** Synthetic editor data never reads another school's students or results. */
export const SAMPLE_DOCUMENT_CONTEXT = {
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
    phoneNo: "9876543210",
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
export const DOCUMENT_CONTEXT_HELP = `All documents: school.{name,location,registrationNo,logoUrl}, session.{startYear,endYear}, generatedAt.
Student documents: student.{name,admissionNo,rollNo,className,sectionName,dob,fatherName,motherName,address,phoneNo,photoUrl}.
Examination documents: exam.{name,slug,order,status,startedAt,completedAt}; unknown historical lifecycle/timestamps are null.
Report cards: subjects[] with slug,name,total,totalMarks,percentage,grade,marks[modeSlug],modeConfig[modeSlug].{name,percentage,maxMarks}; grandTotal,grandMaxMarks,overallPercentage,overallGrade; gradingScale[gradeKey].{label,minScore}, sorted highest threshold first.
Exam-wide assessment: attendanceEnabled is the session configuration flag; attendance is nullable or {daysAttended,totalWorkingDays,percentage}; coScholastics[areaSlug].{areaName,grade} is nullable; coScholasticAreas[areaSlug].{name} holds configured definitions; assessmentApproved is true/false/null. Missing values stay null; zero attendance/marks remain zero. Shared values come only from the approved student exam assessment and exam working-day settings. Never infer shared values from legacy subject metadata.
Report printing flags: reportSections.{includeModeMarks,includeAttendance,includeCoScholastics,includeGradingScale}. Templates must honor these independent print choices; they do not change configuration, grading, or approval facts. Subjects may retain legacy per-subject attendance/coScholastics for older templates; these are not the exam-wide values.
Admit cards: exam, timetable[] with date (ISO),displayDate,dayOfWeek,startTime,endTime (HH:mm),displayStartTime,displayEndTime,subjectSlug,subjectName,modeSlug,modeName; may be empty.
Timetables: columns[] with classId,label; rows[] with date,displayDate,dayOfWeek,startTime,endTime,displayStartTime,displayEndTime. rows[].entries[] follows column order, each with classId,subjects[] of subjectSlug,subjectName,modeSlug,modeName. Unscheduled cells have an empty subjects array. For v1 template compatibility, rows[].cells[classId] is a resolved single subject, an array preserving all subjects/modes, or null. Calendar formatting never shifts dates through the host timezone.
Finance documents: admission.{name,number,fatherName,motherName,classLabel,sectionLabel,rollNumber}; currency.{code,exponent}. Bills expose bill.{id,number,issueDate,periodKey,total,totalMinor}, lines[].{slug,name,amount,amountMinor,pricingSource}, balanceBefore and balanceAfter. Receipts expose transaction.{kind,isRefund,id,documentNumber}, payment.{id,receiptNumber,receivedAt,amount,amountMinor,method,externalReference,payerName,note}, previousBalance and remainingBalance. Payments are admission-account credits and receipts never expose bill allocations. Refund contexts set transaction.isRefund and the payment fields describe returned funds. Statements expose statement.{periodStartDate,throughDate,asOfSequence,openingBalance,openingBalanceMinor,closingBalance,closingBalanceMinor} and period entries[].{sequence,effectiveAt,reference,description,debit,credit,balance}. Bill and receipt balances are pinned to the source fact's effective-date ledger position; statement balances are pinned to the reviewed cutoff. They never use current projections.
Use standard Handlebars each/if/unless/with/lookup helpers and the finite-numeric add helper (for example add columns.length 2). Images use provided data URIs. No scripts, forms, links, external URLs/fonts or network assets. Self-contained CSS is allowed. ID cards fit 86mm by 54mm; timetables use landscape A4; report cards use full portrait A4. Admit cards, bills, receipts, and statements use the selected template revision's explicit full-A4 or half-A4 footprint; half-A4 revisions are imposed two per portrait A4 sheet.`;
