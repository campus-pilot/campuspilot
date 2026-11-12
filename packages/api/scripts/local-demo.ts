/**
 * Persistent, repeatable local demo provisioning through the real application
 * procedures. Authentication uses real password sessions; no test actors or
 * platform-to-school role shortcuts are used. Run from apps/server for its .env.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { createRouterClient } from '@orpc/server';
import { CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { getS3Client } from '@campuspilot/s3/client';
import { auth } from '@campuspilot/auth/server';
import { env } from '@campuspilot/env/server';
import { db } from '@campuspilot/db';
import { user } from '@campuspilot/db/schema/auth';
import { admissionTable } from '@campuspilot/db/schema/admission';
import { schoolMemberTable } from '@campuspilot/db/schema/school-member';
import { schoolUserRoleTable } from '@campuspilot/db/schema/school-user-role';
import type { ClassConfig } from '@campuspilot/db/schema/jsonb/class-config';
import { createContextFromHeaders } from '../src/context';
import { appRouter } from '../src/routers';
import type { DocumentType, DocumentSource } from '../src/routers/school/document/document.dto';

const root = new URL('../../../', import.meta.url);
const local = new URL('tmp/local-demo/', root);
const credentials = z.object({
  platform: z.object({ email: z.email(), password: z.string().min(12) }),
  staffPassword: z.string().min(12),
}).parse(JSON.parse(await readFile(new URL('credentials.json', local), 'utf8')));

// Refuse to provision any remote or unrelated database, even if a shell happens
// to have DATABASE_URL set. The local setup owns only this dedicated stack.
const databaseUrl = new URL(env.DATABASE_URL);
assert(['localhost', '127.0.0.1'].includes(databaseUrl.hostname));
assert.equal(databaseUrl.port, '55432');
assert.equal(databaseUrl.pathname, '/campuspilot');
assert.equal(env.SYSTEM_ADMIN_EMAIL, credentials.platform.email);

async function clientFor(email: string, password: string, name: string) {
  const existing = await db.query.user.findFirst({ where: eq(user.email, email) });
  if (!existing) await auth.api.signUpEmail({ body: { email, password, name } });
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  assert(response.ok, `Password sign-in failed for ${email}`);
  const headers = new Headers({ cookie: response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ') });
  const context = await createContextFromHeaders(headers);
  assert(context.session, `No authenticated session for ${email}`);
  return { rpc: createRouterClient(appRouter, { context }), user: context.session.user };
}

const admin = await clientFor(credentials.platform.email, credentials.platform.password, 'Ayush Kaithwas');
assert.equal(admin.user.role, 'admin');
const schools = await admin.rpc.systemAdmin.listSchools({ searchQuery: 'Maple Grove Public School' });
let school = schools.items.find((item) => item.slug === 'maple-grove-public-school');
school ??= await admin.rpc.systemAdmin.addSchool({ slug: 'maple-grove-public-school', name: 'Maple Grove Public School', location: '24 Learning Lane, Bengaluru, Karnataka 560001 (Sample school)', registrationNo: 'DEMO-MGPS-2026' });
const schoolId = school.id;
console.log('SCHOOL_READY', schoolId);

const staff = [
  { email: 'principal@maplegrove.test', name: 'Dr. Meera Iyer', role: 'principal' },
  { email: 'manager@maplegrove.test', name: 'Arjun Nair', role: 'manager' },
  { email: 'accounts@maplegrove.test', name: 'Kavita Shah', role: 'accountant' },
  { email: 'exams@maplegrove.test', name: 'Rohan Menon', role: 'exam_coordinator' },
] as const;
const actors = new Map<string, Awaited<ReturnType<typeof clientFor>>>();
for (const person of staff) {
  const actor = await clientFor(person.email, credentials.staffPassword, person.name);
  const membership = await db.query.schoolMemberTable.findFirst({ where: and(eq(schoolMemberTable.schoolId, schoolId), eq(schoolMemberTable.userId, actor.user.id)) });
  if (!membership) await admin.rpc.school.inviteMember({ schoolId, email: person.email, roles: [{ role: person.role }] });
  actors.set(person.role, actor);
}
const rpc = actors.get('principal')!.rpc;
const accountant = actors.get('accountant')!.rpc;
const sessions = await rpc.school.listSessions({ schoolId });
let academicSession = sessions.items.find((item) => item.sessionStartYear === 2026 && item.sessionEndYear === 2027);
if (!academicSession) academicSession = await rpc.school.createSession({
  schoolId, sessionStartYear: 2026, sessionEndYear: 2027,
  sessionConfig: {
    examConfig: Object.fromEntries(['First', 'Second', 'Third', 'Fourth'].map((label, index) => [`semester-${index + 1}`, { name: `${label} Semester Examination`, order: index + 1 }])),
    gradingScale: { a_plus: { label: 'A+', minScore: 90 }, a: { label: 'A', minScore: 80 }, b_plus: { label: 'B+', minScore: 70 }, b: { label: 'B', minScore: 60 }, c: { label: 'C', minScore: 50 }, d: { label: 'D', minScore: 40 }, needs_support: { label: 'Needs support', minScore: 0 } },
    coScholasticAreas: { art: { name: 'Art & Craft' }, physical_education: { name: 'Physical Education' }, life_skills: { name: 'Life Skills & Participation' } },
    attendanceTracking: { enabled: true },
  },
});
const sessionId = academicSession.id;
if (!academicSession.isActive) await rpc.school.activateSession({ schoolId, sessionId });
const scope = { schoolId, sessionId };
await rpc.school.updateAdmissionSettings({ schoolId, settings: { documentTypes: [{ value: 'birth-certificate', label: 'Birth certificate' }, { value: 'address-proof', label: 'Parent / guardian address proof' }, { value: 'transfer-certificate', label: 'Transfer certificate (if applicable)' }] } });

const classDefinitions = [
  { slug: 'nursery', label: 'Nursery', teacher: 'Anita Rao', birthYear: 2022, tuition: 180000, students: ['Aarav Sharma', 'Diya Patel', 'Vihaan Reddy'] },
  { slug: 'lkg', label: 'LKG', teacher: 'Neha Kapoor', birthYear: 2021, tuition: 200000, students: ['Ananya Gupta', 'Ishaan Nair', 'Myra Joshi'] },
  { slug: 'ukg', label: 'UKG', teacher: 'Pooja Menon', birthYear: 2020, tuition: 220000, students: ['Advik Shah', 'Kiara Iyer', 'Reyansh Kumar'] },
  { slug: 'class-1', label: 'Class 1', teacher: 'Sanjay Verma', birthYear: 2019, tuition: 250000, students: ['Aanya Mehta', 'Kabir Singh', 'Sara Khan'] },
  { slug: 'class-2', label: 'Class 2', teacher: 'Ritu Desai', birthYear: 2018, tuition: 280000, students: ['Arjun Rao', 'Avni Das', 'Dhruv Bhat'] },
  { slug: 'class-3', label: 'Class 3', teacher: 'Vikram Sethi', birthYear: 2017, tuition: 300000, students: ['Ira Banerjee', 'Rudra Malhotra', 'Saanvi Kulkarni'] },
];
const classrooms: Array<Awaited<ReturnType<typeof rpc.school.getClass>> & { sectionId: string; definition: typeof classDefinitions[number] }> = [];
const enrolled = [];
for (const [classIndex, definition] of classDefinitions.entries()) {
  const preschool = classIndex < 3;
  const subjectDefinitions = preschool
    ? [['english', 'English Readiness'], ['hindi', 'Hindi Readiness'], ['math', 'Number Concepts'], ['general-awareness', 'General Awareness']]
    : [['english', 'English'], ['hindi', 'Hindi'], ['math', 'Mathematics'], ['evs', 'Environmental Studies'], ['computer', 'Computer Studies']];
  const examModes: ClassConfig['subjects'][string]['examModes'] = preschool
    ? { oral: { name: 'Oral', percentage: 60 }, activity: { name: 'Activity', percentage: 40 } }
    : { written: { name: 'Written', percentage: 80 }, oral: { name: 'Oral', percentage: 20 } };
  const config: ClassConfig = { subjects: Object.fromEntries(subjectDefinitions.map(([slug, name]) => [slug!, { name: name!, books: [{ title: `${definition.label} ${name} Workbook`, publication: 'Maple Grove sample curriculum' }], examModes }])) };
  let classroom: Awaited<ReturnType<typeof rpc.school.getClass>> | undefined = (await rpc.school.listClasses(scope)).find((item) => item.slug === definition.slug);
  if (!classroom) classroom = await rpc.school.createClass({ schoolId, slug: definition.slug, label: definition.label, config, sections: [{ slug: 'a', label: 'A' }] });
  const section = (await rpc.school.listSections({ schoolId, classId: classroom.id }))[0]!;
  classrooms.push({ ...classroom, sectionId: section.id, definition });
  const teacher = await clientFor(`${definition.slug}@maplegrove.test`, credentials.staffPassword, definition.teacher);
  const members = await rpc.school.listMembers({ schoolId, searchQuery: teacher.user.email });
  if (!members.items.length) await rpc.school.inviteMember({ schoolId, email: teacher.user.email, roles: [{ role: 'teacher', meta: { classIds: [classroom.id] } }] });
  for (const [studentIndex, name] of definition.students.entries()) {
    const admissionNo = `MGPS/2026/${String(classIndex * 3 + studentIndex + 1).padStart(3, '0')}`;
    let admission = await db.query.admissionTable.findFirst({ columns: { id: true }, where: and(eq(admissionTable.schoolId, schoolId), eq(admissionTable.admissionNo, admissionNo)) });
    if (!admission) admission = await rpc.school.createAdmission({ schoolId, name, admissionNo, admissionClassId: classroom.id, address: `${11 + classIndex * 3 + studentIndex}, Sample Garden Layout, Bengaluru 560001`, phoneNo: `55555000${String(classIndex * 3 + studentIndex + 1).padStart(2, '0')}`, whatsappSameAsPhone: true, email: `family-${classIndex * 3 + studentIndex + 1}@maplegrove.test`, dob: `${definition.birthYear}-${String(3 + studentIndex).padStart(2, '0')}-${String(10 + classIndex).padStart(2, '0')}`, fatherName: `${['Rajesh', 'Amit', 'Vivek'][studentIndex]} ${name.split(' ').at(-1)}`, motherName: `${['Sunita', 'Priya', 'Nisha'][studentIndex]} ${name.split(' ').at(-1)}` });
    let student = (await rpc.school.listStudents({ ...scope, filters: { admissionId: admission.id } })).items[0];
    student ??= await rpc.school.createStudent({ ...scope, admissionId: admission.id, sectionId: section.id, rollNo: studentIndex + 1 });
    enrolled.push({ ...student, name, classIndex, studentIndex, admissionId: admission.id });
  }
}
console.log('ACADEMICS_READY', { classes: classrooms.length, students: enrolled.length });

const finance = await accountant.school.getSessionFinance(scope);
if (!finance.financeConfig) await accountant.school.updateSessionFinance({
  ...scope,
  financeConfig: {
    currency: 'INR', timeZone: 'Asia/Kolkata', cycleStartMonth: 4, recurring: 'monthly',
    elements: {
      tuition: { name: 'Tuition Fee', scopes: ['school', 'class', 'student'], requiredAtLevel: 'class' },
      activity: { name: 'Activity Fee', scopes: ['school'], requiredAtLevel: 'school', defaultAmountMinor: 20000 },
      resources: { name: 'Learning Resources', scopes: ['school'], requiredAtLevel: 'school', defaultAmountMinor: 15000 },
      transport: { name: 'Optional School Transport', scopes: ['student'], requiredAtLevel: 'student', defaultAmountMinor: 0 },
      examination: { name: 'Examination Fee (when billed)', scopes: ['school', 'class'], requiredAtLevel: 'bill_generation' },
    },
  },
  classOverrides: Object.fromEntries(classDefinitions.map((item) => [item.slug, { tuition: item.tuition }])),
});
for (const student of enrolled) {
  const values = await accountant.school.getAdmissionFinanceValues({ ...scope, admissionId: student.admissionId });
  if (!Object.keys(values.values).length) await accountant.school.updateAdmissionFinanceValues({ ...scope, admissionId: student.admissionId, values: { transport: student.studentIndex === 0 ? 90000 : 0 } });
}

const examDates = ['2026-06-15', '2026-09-14', '2026-11-23', '2027-03-15'];
for (let examIndex = 0; examIndex < 4; examIndex++) {
  const exam = { ...scope, examSlug: `semester-${examIndex + 1}` };
  const overview = await rpc.school.getExamOverview(exam);
  if (overview.status === 'completed') continue;
  if (overview.planCount === 0) {
    const preview = await rpc.school.getExamPlanPreview(exam);
    await rpc.school.generateExamPlan({ ...exam, configurationVersion: preview.configurationVersion });
  }
  await rpc.school.updateExamAssessmentSettings({ ...exam, totalWorkingDays: [58, 60, 55, 57][examIndex]! });
  const existingTimetable = await rpc.school.getExamTimetable(exam);
  if (!existingTimetable) await rpc.school.saveExamTimetable({
    ...exam,
    config: {
      columns: classrooms.map((item) => item.id),
      rows: Array.from({ length: 10 }, (_, index) => {
        const date = new Date(`${examDates[examIndex]}T00:00:00Z`);
        date.setUTCDate(date.getUTCDate() + Math.floor(index / 2));
        return { id: `semester-${examIndex + 1}-slot-${index + 1}`, date: date.toISOString().slice(0, 10), startTime: index % 2 === 0 ? '09:00' : '11:00', endTime: index % 2 === 0 ? '10:00' : '11:30', cells: Object.fromEntries(classrooms.map((item) => {
          const subject = Object.entries(item.config.subjects)[Math.floor(index / 2)];
          if (!subject) return [item.id, null];
          const modeSlug = Object.keys(subject[1].examModes)[index % 2]!;
          return [item.id, { subjectSlug: subject[0], modeSlug }];
        })) };
      }),
    },
  });
  if (examIndex < 3 && overview.status !== 'active') await rpc.school.transitionExam({ ...exam, status: 'active' });
  if (examIndex < 2) {
    for (const student of enrolled) {
      const studentScope = { ...exam, classId: student.classId!, studentId: student.id };
      const workspace = await rpc.school.getStudentExam(studentScope);
      await rpc.school.saveStudentExam({
        ...studentScope,
        approved: true,
        daysAttended: [58, 60][examIndex]! - 1 - ((student.classIndex + student.studentIndex) % 5),
        coScholastics: { art: student.studentIndex === 1 ? 'A+' : 'A', physical_education: student.studentIndex === 2 ? 'B+' : 'A', life_skills: 'A' },
        subjects: workspace.subjects.map(({ plan }, subjectIndex) => ({ examPlanId: plan.id, marks: Object.fromEntries(Object.entries(plan.modeConfig).map(([slug, mode]) => [slug, Math.round(mode.maxMarks * (0.68 + ((student.classIndex + student.studentIndex * 3 + subjectIndex + examIndex * 2) % 25) / 100))])) })),
      });
    }
    await rpc.school.transitionExam({ ...exam, status: 'completed' });
  }
  console.log('EXAM_READY', exam.examSlug);
}

const billingDraft = { ...scope, billingDate: '2026-11-01' };
const runKey = 'maple-grove-demo-november-2026-v1';
let run = (await accountant.school.listBillingRuns(scope)).items.find((item) => item.periodKey === 'monthly:2026-11' && item.kind === 'regular');
if (!run) {
  const preview = await accountant.school.previewBillingRun(billingDraft);
  assert(preview.readyToPost, JSON.stringify(preview.issues));
  run = await accountant.school.postBillingRun({ ...billingDraft, kind: 'regular', idempotencyKey: runKey, expectedConfigurationHash: preview.configurationHash });
}
for (const student of enrolled.filter((item) => item.studentIndex < 2)) {
  const amount = classDefinitions[student.classIndex]!.tuition + 35000 + (student.studentIndex === 0 ? 90000 : 0);
  await accountant.school.recordPayment({ ...scope, admissionId: student.admissionId, currency: 'INR', amountMinor: String(student.studentIndex === 0 ? amount : amount / 2), method: student.studentIndex === 0 ? 'bank_transfer' : 'cash', externalReference: `DEMO-NOV-${student.classIndex + 1}-${student.studentIndex + 1}`, payerName: `Sample guardian of ${student.name}`, receivedAt: '2026-11-02T04:30:00Z', effectiveAt: '2026-11-02T04:30:00Z', note: 'Synthetic local demo payment; no real funds moved.', idempotencyKey: `demo-nov-payment-${student.admissionId}` });
}
console.log('FINANCE_READY', run.id);

// Real template imports create immutable school-owned revisions in local S3.
assert.equal(new URL(env.S3_ENDPOINT!).port, '59000');
assert(['localhost', '127.0.0.1'].includes(new URL(env.S3_ENDPOINT!).hostname));
try {
  await getS3Client().send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
} catch (error) {
  if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404) throw error;
  await getS3Client().send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
}
/** Types with a generator source; `notice` has a template but is rendered by the notices feature. */
type GeneratedDocumentType = Exclude<DocumentType, 'notice' | 'question_paper'>;
const templates = new Map<GeneratedDocumentType, string>();
const types: GeneratedDocumentType[] = ['report_card', 'id_card', 'admit_card', 'timetable', 'bill', 'receipt', 'statement'];
for (const documentType of types) {
  let active = await rpc.school.getActiveDocumentTemplate({ schoolId, documentType });
  if (!active) active = await rpc.school.selectMarketplaceTemplate({ schoolId, documentType, slug: `${documentType}-default`, expectedRevisionId: null });
  /** The catalog admit card is a half-A4 design; this demo prints it on full A4
   * so a card accommodates all ten assessment slots. Its source is saved
   * unchanged as a school revision with the full footprint. Custom revisions
   * are left alone on later runs. */
  if (documentType === 'admit_card' && active.artifact.marketplaceSlug === 'admit_card-default') {
    active = await rpc.school.saveDocumentTemplate({ schoolId, documentType, name: 'Maple Grove Admit Card (Full A4)', content: active.content, pageSize: 'full', expectedRevisionId: active.artifact.id });
  }
  templates.set(documentType, active.artifact.id);
}
if (!school.hasCompletedOnboarding) await admin.rpc.systemAdmin.updateSchool({ id: schoolId, hasCompletedOnboarding: true });

const first = enrolled[0]!;
const payments = await accountant.school.listPayments({ schoolId, filters: { sessionId } });
const sourceByType: Record<GeneratedDocumentType, DocumentSource> = {
  report_card: { documentType: 'report_card', sessionId, examSlug: 'semester-1', resultPolicy: 'require_all', reportSections: { includeModeMarks: true, includeAttendance: true, includeCoScholastics: true, includeGradingScale: true } },
  id_card: { documentType: 'id_card', sessionId, classId: first.classId! },
  admit_card: { documentType: 'admit_card', sessionId, examSlug: 'semester-3' },
  timetable: { documentType: 'timetable', sessionId, examSlug: 'semester-3' },
  bill: { documentType: 'bill', sessionId, billRunId: run.id },
  receipt: { documentType: 'receipt', sessionId, transactions: payments.items.map((item) => ({ kind: 'payment', id: item.id })) },
  statement: { documentType: 'statement', sessionId, admissionIds: [first.admissionId], throughDate: '2026-11-03' },
};
await mkdir(new URL('documents/', local), { recursive: true });
for (const documentType of types) {
  const source = sourceByType[documentType];
  const history = await rpc.school.listDocumentArtifacts({ schoolId, filters: { sessionId, documentType } });
  let artifact = history.items.find((item) => item.templateRevisionId === templates.get(documentType));
  if (!artifact) {
    const preview = await rpc.school.previewDocument({ schoolId, source, templateRevisionId: templates.get(documentType)! });
    if (source.documentType === 'statement') source.expectedReviewHash = preview.reviewHash!;
    artifact = (await rpc.school.generateDocument({ schoolId, source, templateRevisionId: templates.get(documentType)! })).artifact;
  }
  const download = await rpc.school.getDocumentDownload({ schoolId, artifactId: artifact.id, documentType });
  const response = await fetch(download.url);
  assert(response.ok, `Cannot download ${documentType}`);
  const data = Buffer.from(await response.arrayBuffer());
  assert(data.subarray(0, 5).toString() === '%PDF-', `Invalid PDF for ${documentType}`);
  await writeFile(new URL(`documents/${documentType}.pdf`, local), data);
  console.log('DOCUMENT_READY', documentType, data.length);
}

const members = await rpc.school.listMembers({ schoolId });
assert.equal(members.pagination.totalItems, 10);
assert(!members.items.some((item) => item.email === credentials.platform.email));
assert.equal((await db.select().from(schoolMemberTable).where(eq(schoolMemberTable.userId, admin.user.id))).length, 0);
assert.equal((await db.select().from(schoolUserRoleTable).where(eq(schoolUserRoleTable.userId, admin.user.id))).length, 0);
assert.equal((await admin.rpc.school.listMySchools()).length, 0);
const verifiedClasses = await rpc.school.listClasses(scope);
assert.equal(verifiedClasses.length, 6);
assert(verifiedClasses.every((item) => item.studentCount === 3 && item.teacherCount === 1 && item.sectionCount === 1));
const exams = await rpc.school.listExams(scope);
assert.deepEqual(exams.items.map((item) => item.status), ['completed', 'completed', 'active', 'ready']);
assert((await accountant.school.getSessionFinance(scope)).configurationReadiness.readyForBilling);
assert.equal((await rpc.school.listAdmissions({ schoolId })).pagination.totalItems, 18);
assert.equal((await rpc.school.listStudents(scope)).pagination.totalItems, 18);
assert.equal(payments.pagination.totalItems, 12);
for (const student of enrolled) {
  const reconciliation = await accountant.school.reconcileAdmissionProjection({ schoolId, admissionId: student.admissionId, currency: 'INR' });
  assert(reconciliation.matches, `Ledger projection mismatch for ${student.name}`);
}
const dashboard = await rpc.school.getDashboard(scope);
await writeFile(new URL('state.json', local), JSON.stringify({ schoolId, sessionId, schoolName: school.name, managementUrl: `http://localhost:3102/school/${schoolId}/sessions/${sessionId}`, adminUrl: `http://localhost:3103/school/${schoolId}`, classes: verifiedClasses.map(({ id, label, studentCount }) => ({ id, label, studentCount })), staff: members.items.map(({ email, name, roles }) => ({ email, name, roles })), exams: exams.items, billingRunId: run.id, dashboard, verifiedAt: new Date().toISOString() }, null, 2) + '\n');
console.log('LOCAL_DEMO_VERIFIED', { schoolId, sessionId, staff: 10, students: 18, templates: 7, samplePdfs: 7 });
process.exit(0);
