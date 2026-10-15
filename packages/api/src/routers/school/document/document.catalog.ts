import type { DocumentType } from './document.dto';

const schoolHeader = `<header>{{#if school.logoUrl}}<img class="logo" src="{{school.logoUrl}}" alt="School logo">{{/if}}<div><h1>{{school.name}}</h1><p>{{school.location}}</p>{{#if school.registrationNo}}<p>{{school.registrationNo}}</p>{{/if}}</div></header>`;
const student = `<section class="identity">{{#if student.photoUrl}}<img class="photo" src="{{student.photoUrl}}" alt="Student photograph">{{/if}}<div><h2>{{student.name}}</h2><p>Admission {{student.admissionNo}} · {{student.className}} {{student.sectionName}}</p>{{#if student.rollNo}}<p>Roll no. {{student.rollNo}}</p>{{/if}}<p>{{student.fatherName}} · {{student.motherName}}</p></div></section>`;
const schedule = `<table><thead><tr><th>Date</th><th>Time</th><th>Subject</th><th>Mode</th></tr></thead><tbody>{{#each timetable}}<tr><td>{{displayDate}}</td><td>{{startTime}}–{{endTime}}</td><td>{{subjectName}}</td><td>{{modeName}}</td></tr>{{/each}}</tbody></table>`;
const bodies: Record<DocumentType, string> = {
  report_card: `${schoolHeader}<div class="title"><span>ACADEMIC REPORT</span><h2>{{exam.name}}</h2><p>{{session.startYear}}–{{session.endYear}}</p></div>${student}<table><thead><tr><th>Subject</th><th>Score</th><th>Maximum</th><th>Grade</th></tr></thead><tbody>{{#each subjects}}<tr><td>{{name}}</td><td>{{total}}</td><td>{{totalMarks}}</td><td>{{grade}}</td></tr>{{/each}}</tbody></table><section class="total"><strong>{{grandTotal}} / {{grandMaxMarks}}</strong><span>{{overallPercentage}}% · {{overallGrade}}</span></section><p>Attendance and co-scholastic assessments by subject</p>{{#each subjects}}<p>{{name}}{{#if attendance}} · Attendance {{attendance.daysAttended}} / {{attendance.totalWorkingDays}}{{/if}}{{#each coScholastics}} · {{areaName}}: {{grade}}{{/each}}</p>{{/each}}<footer><span>Class teacher</span><span>Principal</span></footer>`,
  id_card: `${schoolHeader}<div class="title"><span>STUDENT IDENTITY</span></div>${student}<p class="small">DOB {{student.dob}} · {{student.phoneNo}}</p><p class="small">{{student.address}}</p><div class="total"><span>{{session.startYear}}–{{session.endYear}}</span><strong>Authorized signatory</strong></div>`,
  admit_card: `${schoolHeader}<div class="title"><span>EXAMINATION ADMIT CARD</span><h2>{{exam.name}}</h2><p>{{session.startYear}}–{{session.endYear}}</p></div>${student}{{#if timetable}}<h3>Examination schedule</h3>${schedule}{{/if}}<p>Please bring this card to each examination.</p><footer><span>Student signature</span><span>Principal</span></footer>`,
  timetable: `${schoolHeader}<div class="title"><span>EXAMINATION SCHEDULE</span><h2>{{exam.name}}</h2><p>{{session.startYear}}–{{session.endYear}}</p></div><table><thead><tr><th>Date / time</th>{{#each columns}}<th>{{label}}</th>{{/each}}</tr></thead><tbody>{{#each rows}}<tr><td>{{displayDate}}<br>{{startTime}}–{{endTime}}</td>{{#each entries}}<td>{{#each subjects}}<strong>{{subjectName}}</strong><br>{{modeName}}{{#unless @last}}<br>{{/unless}}{{/each}}</td>{{/each}}</tr>{{/each}}</tbody></table>`,
};
function content(type: DocumentType, accent: string, classic: boolean) {
  const page = type === 'timetable' ? 'A4 landscape' : 'A4';
  const card = type === 'id_card';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><style>
 @page{size:${page};margin:12mm}*{box-sizing:border-box}body{margin:0;font-family:${classic ? 'Georgia,serif' : 'Arial,sans-serif'};color:#172033;font-size:${card ? '8px' : '12px'}}
 .document{${card ? 'width:86mm;height:54mm;padding:3mm;overflow:hidden;' : 'padding:8mm;'}border:1px solid #d9e0e9;border-top:5px solid ${accent};border-radius:8px}header{display:flex;align-items:center;gap:12px;border-bottom:1px solid #e4e8ef;padding-bottom:${card ? '3px' : '16px'}}h1{margin:0;color:${accent};font-size:${card ? '12px' : '24px'}}h2{margin:4px 0;font-size:${card ? '10px' : '20px'}}p{margin:4px 0;color:#526077}header p{font-size:${card ? '7px' : '11px'}}.logo{width:${card ? '24px' : '54px'};height:${card ? '24px' : '54px'};object-fit:contain}.title{margin:${card ? '4px 0' : '24px 0'}}.title span{font-size:${card ? '7px' : '10px'};letter-spacing:1.5px;color:${accent}}.identity{display:flex;gap:16px;align-items:center;margin:${card ? '4px 0' : '20px 0'}}.photo{width:${card ? '35px' : '62px'};height:${card ? '42px' : '76px'};object-fit:cover;border-radius:4px}table{border-collapse:collapse;width:100%;margin:18px 0}th{text-align:left;background:${accent};color:white;padding:10px}td{border-bottom:1px solid #e4e8ef;padding:10px}tr{break-inside:avoid}.total{display:flex;justify-content:space-between;gap:8px;background:#f2f5f9;padding:${card ? '4px' : '16px'};border-radius:4px}.small{font-size:7px}footer{display:flex;justify-content:space-between;margin-top:60px;border-top:1px solid #d9e0e9;padding-top:12px}
 </style></head><body><main class="document">${bodies[type]}</main></body></html>`;
}
const types: DocumentType[] = [
  'report_card',
  'id_card',
  'admit_card',
  'timetable',
];
const nouns: Record<DocumentType, string> = {
  report_card: 'Report card',
  id_card: 'Student ID',
  admit_card: 'Admit card',
  timetable: 'Exam timetable',
};
/** Catalog content is server-owned. Selecting a slug never accepts replacement
 * HTML from the client; custom content is saved through the editor explicitly.
 */
export const DOCUMENT_MARKETPLACE = types.flatMap((documentType) => [
  {
    slug: `${documentType}-modern`,
    documentType,
    name: `${nouns[documentType]} · Modern`,
    description: 'Clear typography, forest accents, and generous spacing.',
    content: content(documentType, '#146b56', false),
  },
  {
    slug: `${documentType}-classic`,
    documentType,
    name: `${nouns[documentType]} · Classic`,
    description: 'Traditional serif typography with a structured navy layout.',
    content: content(documentType, '#253d68', true),
  },
]);

/** Synthetic editor data never reads another school's students or results. */
export const SAMPLE_DOCUMENT_CONTEXT = {
  school: {
    name: 'Greenwood Public School',
    location: 'School Road, Bengaluru',
    registrationNo: 'SCH-2026',
    logoUrl: null,
  },
  session: { startYear: 2026, endYear: 2027 },
  exam: { name: 'Term I Examination', slug: 'term-1', order: 1 },
  student: {
    name: 'Aarav Sharma',
    admissionNo: '2026-0142',
    rollNo: '12',
    className: 'Grade 8',
    sectionName: 'A',
    fatherName: 'Raj Sharma',
    motherName: 'Meera Sharma',
    dob: '2013-06-15',
    phoneNo: '9876543210',
    address: 'School Road, Bengaluru',
    photoUrl: null,
  },
  subjects: [
    {
      name: 'Mathematics',
      total: 88,
      totalMarks: 100,
      percentage: 88,
      grade: 'A',
      marks: { written: 88 },
      modeConfig: {
        written: { name: 'Written', percentage: 100, maxMarks: 100 },
      },
      attendance: { daysAttended: 82, totalWorkingDays: 90 },
      coScholastics: { art: { areaName: 'Art', grade: 'A' } },
    },
    {
      name: 'English',
      total: 92,
      totalMarks: 100,
      percentage: 92,
      grade: 'A+',
    },
  ],
  grandTotal: 180,
  grandMaxMarks: 200,
  overallPercentage: 90,
  overallGrade: 'A+',
  gradingScale: { a: { label: 'A', minScore: 80 } },
  attendanceEnabled: true,
  timetable: [
    {
      displayDate: '2026-10-20',
      startTime: '09:00',
      endTime: '12:00',
      subjectName: 'Mathematics',
      modeName: 'Written',
    },
  ],
  columns: [{ classId: 'sample-class', label: 'Grade 8' }],
  rows: [
    {
      displayDate: '2026-10-20',
      startTime: '09:00',
      endTime: '12:00',
      entries: [
        { subjects: [{ subjectName: 'Mathematics', modeName: 'Written' }] },
      ],
    },
  ],
  generatedAt: '2026-10-15T09:00:00.000Z',
};
export const DOCUMENT_CONTEXT_HELP = `All documents: school.{name,location,registrationNo,logoUrl}, session.{startYear,endYear}, generatedAt.
Student documents: student.{name,admissionNo,rollNo,className,sectionName,dob,fatherName,motherName,address,phoneNo,photoUrl}.
Report cards: exam.{name,slug,order}, subjects[] with name, total, totalMarks, percentage, grade, marks[modeSlug], modeConfig[modeSlug].{name,percentage,maxMarks}, attendance.{daysAttended,totalWorkingDays,percentage} (nullable), coScholastics[areaSlug].{areaName,grade}; grandTotal, grandMaxMarks, overallPercentage, overallGrade, gradingScale, attendanceEnabled.
Admit cards: exam, timetable[] with displayDate,startTime,endTime,subjectName,modeName (may be empty).
Timetables: exam, columns[] with classId,label; rows[] with displayDate,startTime,endTime,entries[] in column order, each with subjects[] of subjectName,modeName. Unscheduled cells have an empty subjects array.
Use standard Handlebars each/if/unless/lookup helpers. Images use provided data URIs. No scripts, forms, links, external URLs, external fonts, or network assets. Self-contained CSS is allowed. Attendance and co-scholastic grades belong to each subject; do not invent a single overall assessment. ID cards must fit an 86mm by 54mm card. Timetables use landscape A4; other documents use portrait A4.`;
