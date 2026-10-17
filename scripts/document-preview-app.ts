/** Synthetic fixture data and HTTP servers for the manual document preview. */
import { writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { execPath } from "node:process";
import { fileURLToPath } from "node:url";
import { env } from "@campuspilot/env/server";
const { auth } = await import("../packages/auth/src/server");
const user = await auth.api.signUpEmail({
  body: {
    email: "documents@preview.test",
    password: "DocumentPreview123!",
    name: "School Manager",
  },
});
const f = await import("../packages/api/test/fixtures");
const school = await f.createTestSchool({
  name: "Greenwood Public School",
  location: "Bengaluru, Karnataka",
  hasCompletedOnboarding: true,
});
await f.createTestSchoolMember({
  schoolId: school.id,
  userId: user.user.id,
  roles: [{ role: "manager" }],
});
const session = await f.createTestSession({
  schoolId: school.id,
  sessionStartYear: 2026,
  sessionEndYear: 2027,
  isActive: true,
});
const { schoolClass, sections } = await f.createTestClass({
  schoolId: school.id,
  label: "Grade 8",
  slug: "grade-8",
});
const { db } = await import("../packages/db/src/index");
const { eq } = await import("../packages/db/node_modules/drizzle-orm/index.js");
const { schoolSessionTable } =
  await import("../packages/db/src/schema/session");
const { classTable } = await import("../packages/db/src/schema/class");
const {
  examPlanTable,
  examResultTable,
  examTimetableTable,
  examAssessmentSettingsTable,
  examStudentAssessmentTable,
  examLifecycleTable,
} = await import("../packages/db/src/schema/exam");
await db
  .update(schoolSessionTable)
  .set({
    sessionConfig: {
      examConfig: { midterm: { name: "Term I Examination", order: 1 } },
      coScholasticAreas: { art: { name: "Art" } },
      gradingScale: {
        a: { label: "A", minScore: 80 },
        b: { label: "B", minScore: 0 },
      },
      attendanceTracking: { enabled: true },
    },
  })
  .where(eq(schoolSessionTable.id, session.id));
const subjects = [
  ["math", "Mathematics"],
  ["english", "English"],
  ["science", "Science"],
  ["social", "Social Studies"],
  ["hindi", "Hindi"],
  ["computer", "Computer Science"],
] as const;
await db
  .update(classTable)
  .set({
    config: {
      subjects: Object.fromEntries(
        subjects.map(([slug, name]) => [
          slug,
          {
            name,
            books: [],
            examModes:
              slug === "math"
                ? {
                    written: { name: "Written", percentage: 80 },
                    oral: { name: "Oral", percentage: 20 },
                  }
                : { written: { name: "Written", percentage: 100 } },
          },
        ]),
      ),
    },
  })
  .where(eq(classTable.id, schoolClass.id));
const plans = [];
for (const [subjectSlug] of subjects) {
  const [plan] = await db
    .insert(examPlanTable)
    .values({
      schoolId: school.id,
      sessionId: session.id,
      classId: schoolClass.id,
      examSlug: "midterm",
      subjectSlug,
      totalMarks: 100,
      modeConfig:
        subjectSlug === "math"
          ? {
              written: { percentage: 80, maxMarks: 80 },
              oral: { percentage: 20, maxMarks: 20 },
            }
          : { written: { percentage: 100, maxMarks: 100 } },
      status: "active",
    })
    .returning();
  plans.push(plan!);
}
await db.insert(examAssessmentSettingsTable).values({
  schoolId: school.id,
  sessionId: session.id,
  examSlug: "midterm",
  totalWorkingDays: 90,
});
await db.insert(examLifecycleTable).values({
  schoolId: school.id,
  sessionId: session.id,
  examSlug: "midterm",
  status: "active",
  startedAt: new Date(),
});
for (let i = 0; i < 24; i++) {
  const admission = await f.createTestAdmission({
    schoolId: school.id,
    name:
      ["Aarav Sharma", "Ananya Patel", "Dev Mehta", "Isha Rao"][i % 4] +
      (i > 3 ? ` ${i}` : ""),
    admissionNo: `2026-${String(i + 1).padStart(3, "0")}`,
  });
  const student = await f.createTestStudent({
    schoolId: school.id,
    sessionId: session.id,
    classId: schoolClass.id,
    sectionId: sections[0]!.id,
    admissionId: admission.id,
    rollNo: i + 1,
  });
  await db.insert(examStudentAssessmentTable).values({
    schoolId: school.id,
    sessionId: session.id,
    examSlug: "midterm",
    studentId: student.id,
    daysAttended: 82,
    coScholastics: { art: "A" },
    approved: true,
  });
  for (const plan of plans)
    await db.insert(examResultTable).values({
      schoolId: school.id,
      sessionId: session.id,
      studentId: student.id,
      examPlanId: plan.id,
      marks:
        plan.subjectSlug === "math"
          ? { written: 65 + (i % 15), oral: 15 + (i % 6) }
          : { written: 80 + (i % 21) },
      approved: true,
      daysAttended: 82,
      coScholastics: { art: "A" },
    });
}
await db.insert(examTimetableTable).values({
  schoolId: school.id,
  sessionId: session.id,
  examSlug: "midterm",
  config: {
    columns: [schoolClass.id],
    rows: subjects.map(([subjectSlug], index) => ({
      id: `slot-${index}`,
      date: `2026-10-${20 + index}`,
      startTime: "09:00",
      endTime: "12:00",
      cells: {
        [schoolClass.id]: { subjectSlug, modeSlug: "written" },
      },
    })),
  },
});
const actor = await f.createSchoolStaffSession(school.id, [
  { role: "manager" },
]);
const rpc = f.createTestClient(actor.session);
for (const documentType of [
  "report_card",
  "id_card",
  "admit_card",
  "timetable",
] as const)
  await rpc.school.selectMarketplaceTemplate({
    schoolId: school.id,
    documentType,
    slug: `${documentType}-modern`,
    expectedRevisionId: null,
  });
const { serve } =
  await import("../apps/server/node_modules/@hono/node-server/dist/index.mjs");
const { app } = await import("../apps/server/src/http");
const server = serve({
  fetch: app.fetch,
  port: Number(new URL(env.BETTER_AUTH_URL).port),
});
const next = spawn(
  execPath,
  [
    fileURLToPath(
      new URL(
        "../apps/management/node_modules/next/dist/bin/next",
        import.meta.url,
      ),
    ),
    "dev",
    "--port",
    new URL(env.PUBLIC_APP_URL).port,
  ],
  {
    cwd: new URL("../apps/management", import.meta.url),
    env: Object.fromEntries(
      Object.entries({
        ...env,
        NEXT_PUBLIC_SERVER_URL: env.BETTER_AUTH_URL,
      })
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, String(value)]),
    ),
    stdio: "inherit",
  },
);
/** A failed frontend must not leave an apparently ready API or orphaned stack. */
next.on("exit", (code) => {
  server.close();
  process.exit(code ?? 1);
});
next.on("error", (error) => {
  console.error(error);
  server.close();
  process.exit(1);
});
const url = `${env.PUBLIC_APP_URL}/school/${school.id}/sessions/${session.id}/documents`;
await writeFile(
  new URL(env.PUBLIC_APP_URL).port === "3092"
    ? "/private/tmp/campuspilot-document-preview.json"
    : `/private/tmp/campuspilot-document-preview-${new URL(env.PUBLIC_APP_URL).port}.json`,
  JSON.stringify({
    url,
    schoolId: school.id,
    sessionId: session.id,
    classId: schoolClass.id,
  }),
);
console.log("DOCUMENT_PREVIEW_READY", url);
process.on("SIGINT", async () => {
  next.kill("SIGTERM");
  server.close();
  process.exit(0);
});
await new Promise(() => {});
