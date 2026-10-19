import type { DocumentType } from "./document.dto";

const schoolHeader = `<header>{{#if school.logoUrl}}<img class="logo" src="{{school.logoUrl}}" alt="School logo">{{/if}}<div><h1>{{school.name}}</h1><p>{{school.location}}</p>{{#if school.registrationNo}}<p>{{school.registrationNo}}</p>{{/if}}</div></header>`;
const student = `<section class="identity">{{#if student.photoUrl}}<img class="photo" src="{{student.photoUrl}}" alt="Student photograph">{{/if}}<div><h2>{{student.name}}</h2><p>Admission {{student.admissionNo}} · {{student.className}} {{student.sectionName}}</p>{{#if student.rollNo}}<p>Roll no. {{student.rollNo}}</p>{{/if}}<p>{{student.fatherName}} · {{student.motherName}}</p></div></section>`;
const schedule = `<table><thead><tr><th>Date</th><th>Time</th><th>Subject</th><th>Mode</th></tr></thead><tbody>{{#each timetable}}<tr><td>{{displayDate}}<br>{{dayOfWeek}}</td><td>{{displayStartTime}}–{{displayEndTime}}</td><td>{{subjectName}}</td><td>{{modeName}}</td></tr>{{/each}}</tbody></table>`;
const bodies: Record<DocumentType, string> = {
  report_card: `${schoolHeader}<div class="title"><span>ACADEMIC REPORT</span><h2>{{exam.name}}</h2><p>Session {{session.startYear}}–{{session.endYear}}</p></div>${student}<p>Date of birth: {{student.dob}}</p><table><thead><tr><th>Subject</th>{{#if reportSections.includeModeMarks}}<th>Assessments</th>{{/if}}<th>Maximum</th><th>Obtained</th><th>%</th><th>Grade</th></tr></thead><tbody>{{#each subjects}}<tr><td><strong>{{name}}</strong></td>{{#if ../reportSections.includeModeMarks}}<td>{{#each modeConfig}}<div>{{name}}: {{lookup ../marks @key}} / {{maxMarks}}</div>{{/each}}</td>{{/if}}<td>{{totalMarks}}</td><td>{{total}}</td><td>{{percentage}}</td><td>{{grade}}</td></tr>{{/each}}</tbody></table><section class="total"><strong>{{grandTotal}} / {{grandMaxMarks}}</strong><span>{{overallPercentage}}% · {{overallGrade}}</span></section>{{#if reportSections.includeCoScholastics}}{{#if coScholastics}}<h3>Co-scholastic areas</h3><table><thead><tr><th>Area</th><th>Grade</th></tr></thead><tbody>{{#each coScholastics}}<tr><td>{{areaName}}</td><td>{{grade}}</td></tr>{{/each}}</tbody></table>{{/if}}{{/if}}{{#if reportSections.includeAttendance}}{{#if attendanceEnabled}}{{#if attendance}}<h3>Attendance</h3><section class="total"><span>Days attended: {{attendance.daysAttended}} / {{attendance.totalWorkingDays}}</span><strong>{{attendance.percentage}}%</strong></section>{{/if}}{{/if}}{{/if}}{{#if reportSections.includeGradingScale}}<h3>Grading scale</h3><p>{{#each gradingScale}}{{label}}: {{minScore}}% &amp; above{{#unless @last}} · {{/unless}}{{else}}No grading scale configured.{{/each}}</p>{{/if}}<footer><span>Class teacher</span><span>Parent / guardian</span><span>Principal</span></footer><p class="small">Generated {{generatedAt}}</p>`,
  id_card: `${schoolHeader}<div class="title"><span>STUDENT IDENTITY</span></div>${student}<p class="small">DOB {{student.dob}} · {{student.phoneNo}}</p><p class="small">{{student.address}}</p><div class="total"><span>{{session.startYear}}–{{session.endYear}}</span><strong>Authorized signatory</strong></div>`,
  admit_card: `${schoolHeader}<div class="title"><span>EXAMINATION ADMIT CARD</span><h2>{{exam.name}}</h2><p>{{session.startYear}}–{{session.endYear}}</p></div>${student}{{#if timetable}}<h3>Examination schedule</h3>${schedule}{{/if}}<p>Please bring this card to each examination.</p><footer><span>Student signature</span><span>Principal</span></footer>`,
  timetable: `${schoolHeader}<div class="title"><span>EXAMINATION SCHEDULE</span><h2>{{exam.name}}</h2><p>{{session.startYear}}–{{session.endYear}}</p></div><table><thead><tr><th>Date / time</th>{{#each columns}}<th>{{label}}</th>{{/each}}</tr></thead><tbody>{{#each rows}}<tr><td>{{displayDate}}<br>{{dayOfWeek}}<br>{{displayStartTime}}–{{displayEndTime}}</td>{{#each entries}}<td>{{#each subjects}}<strong>{{subjectName}}</strong><br>{{modeName}}{{#unless @last}}<br>{{/unless}}{{/each}}</td>{{/each}}</tr>{{/each}}</tbody></table>`,
};
type CatalogStyle = {
  slug: "modern" | "classic" | "minimal" | "crest";
  name: string;
  description: string;
  accent: string;
  font: string;
  border: string;
  surface: string;
};

/** A catalog family applies intentionally to every supported document type.
 * Published slugs become artifact provenance, so style slugs must remain stable.
 */
const catalogStyles: CatalogStyle[] = [
  {
    slug: "modern",
    name: "Modern",
    description: "Clear typography, forest accents, and generous spacing.",
    accent: "#146b56",
    font: "Arial,sans-serif",
    border: "1px solid #d9e0e9",
    surface: "#f2f5f9",
  },
  {
    slug: "classic",
    name: "Classic",
    description: "Traditional serif typography with a structured navy layout.",
    accent: "#253d68",
    font: "Georgia,serif",
    border: "1px solid #9ca8bb",
    surface: "#eef2f7",
  },
  {
    slug: "minimal",
    name: "Minimal",
    description: "A compact, ink-friendly layout inspired by the original school app.",
    accent: "#334155",
    font: "Arial,sans-serif",
    border: "1px solid #cbd5e1",
    surface: "#f8fafc",
  },
  {
    slug: "crest",
    name: "Crest",
    description: "A logo-forward ceremonial layout with warm heritage accents.",
    accent: "#854d0e",
    font: "Georgia,serif",
    border: "3px double #a16207",
    surface: "#fffbeb",
  },
];

/** Builds self-contained, network-free source. Rendering safety is still
 * enforced by document.render.ts; catalog HTML must not rely on sanitization to
 * remove unsafe or externally hosted content.
 */
function content(type: DocumentType, style: CatalogStyle) {
  const page = type === "timetable" ? "A4 landscape" : "A4";
  const card = type === "id_card";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><style>
 @page{size:${page};margin:12mm}*{box-sizing:border-box}body{margin:0;font-family:${style.font};color:#172033;font-size:${card ? "8px" : "12px"}}
 .document{${card ? "width:86mm;height:54mm;padding:3mm;overflow:hidden;" : "padding:8mm;"}border:${style.border};border-top:5px solid ${style.accent};border-radius:${style.slug === "minimal" ? "2px" : "8px"}}header{display:flex;align-items:center;${style.slug === "crest" ? "justify-content:center;text-align:center;" : ""}gap:12px;border-bottom:1px solid #e4e8ef;padding-bottom:${card ? "3px" : "16px"}}h1{margin:0;color:${style.accent};font-size:${card ? "12px" : "24px"}}h2{margin:4px 0;font-size:${card ? "10px" : "20px"}}p{margin:4px 0;color:#526077}header p{font-size:${card ? "7px" : "11px"}}.logo{width:${card ? "24px" : style.slug === "crest" ? "68px" : "54px"};height:${card ? "24px" : style.slug === "crest" ? "68px" : "54px"};object-fit:contain}.title{margin:${card ? "4px 0" : style.slug === "minimal" ? "14px 0" : "24px 0"};${style.slug === "crest" ? "text-align:center" : ""}}.title span{font-size:${card ? "7px" : "10px"};letter-spacing:1.5px;color:${style.accent}}.identity{display:flex;gap:16px;align-items:center;margin:${card ? "4px 0" : "20px 0"}}.photo{width:${card ? "35px" : "62px"};height:${card ? "42px" : "76px"};object-fit:cover;border-radius:4px}table{border-collapse:collapse;width:100%;margin:18px 0}th{text-align:left;background:${style.accent};color:white;padding:10px}td{border-bottom:1px solid #e4e8ef;padding:10px}tr{break-inside:avoid}.total{display:flex;justify-content:space-between;gap:8px;background:${style.surface};padding:${card ? "4px" : "16px"};border-radius:4px}.small{font-size:7px}footer{display:flex;justify-content:space-between;margin-top:60px;border-top:1px solid #d9e0e9;padding-top:12px}
 ${type === "report_card" ? ".document{padding:6mm}header{padding-bottom:10px}h1{font-size:22px}h2{font-size:18px}.title{margin:14px 0}.identity{margin:12px 0}table{margin:12px 0}th,td{padding:7px}.total{padding:10px}h3{margin:14px 0 8px}footer{margin-top:36px}" : ""}
 </style></head><body><main class="document">${bodies[type]}</main></body></html>`;
}
const types: DocumentType[] = [
  "report_card",
  "id_card",
  "admit_card",
  "timetable",
];
const nouns: Record<DocumentType, string> = {
  report_card: "Report card",
  id_card: "Student ID",
  admit_card: "Admit card",
  timetable: "Exam timetable",
};
/** Catalog content is server-owned. Selecting a slug never accepts replacement
 * HTML from the client; custom content is saved through the editor explicitly.
 */
export const DOCUMENT_MARKETPLACE = types.flatMap((documentType) =>
  catalogStyles.map((style) => ({
    slug: `${documentType}-${style.slug}`,
    documentType,
    name: `${nouns[documentType]} · ${style.name}`,
    description: style.description,
    content: content(documentType, style),
  })),
);

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
};
export const DOCUMENT_CONTEXT_HELP = `All documents: school.{name,location,registrationNo,logoUrl}, session.{startYear,endYear}, generatedAt.
Student documents: student.{name,admissionNo,rollNo,className,sectionName,dob,fatherName,motherName,address,phoneNo,photoUrl}.
Examination documents: exam.{name,slug,order,status,startedAt,completedAt}; unknown historical lifecycle/timestamps are null.
Report cards: subjects[] with slug,name,total,totalMarks,percentage,grade,marks[modeSlug],modeConfig[modeSlug].{name,percentage,maxMarks}; grandTotal,grandMaxMarks,overallPercentage,overallGrade; gradingScale[gradeKey].{label,minScore}, sorted highest threshold first.
Exam-wide assessment: attendanceEnabled is the session configuration flag; attendance is nullable or {daysAttended,totalWorkingDays,percentage}; coScholastics[areaSlug].{areaName,grade} is nullable; coScholasticAreas[areaSlug].{name} holds configured definitions; assessmentApproved is true/false/null. Missing values stay null; zero attendance/marks remain zero. Shared values come only from the approved student exam assessment and exam working-day settings. Never infer shared values from legacy subject metadata.
Report printing flags: reportSections.{includeModeMarks,includeAttendance,includeCoScholastics,includeGradingScale}. Templates must honor these independent print choices; they do not change configuration, grading, or approval facts. Subjects may retain legacy per-subject attendance/coScholastics for older templates; these are not the exam-wide values.
Admit cards: exam, timetable[] with date (ISO),displayDate,dayOfWeek,startTime,endTime (HH:mm),displayStartTime,displayEndTime,subjectSlug,subjectName,modeSlug,modeName; may be empty.
Timetables: columns[] with classId,label; rows[] with date,displayDate,dayOfWeek,startTime,endTime,displayStartTime,displayEndTime. rows[].entries[] follows column order, each with classId,subjects[] of subjectSlug,subjectName,modeSlug,modeName. Unscheduled cells have an empty subjects array. For v1 template compatibility, rows[].cells[classId] is a resolved single subject, an array preserving all subjects/modes, or null. Calendar formatting never shifts dates through the host timezone.
Use standard Handlebars each/if/unless/with/lookup helpers and the finite-numeric add helper (for example add columns.length 2). Images use provided data URIs. No scripts, forms, links, external URLs/fonts or network assets. Self-contained CSS is allowed. ID cards fit 86mm by 54mm; timetables use landscape A4; other documents use portrait A4.`;
