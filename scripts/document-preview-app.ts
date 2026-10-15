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
const { examPlanTable, examResultTable, examTimetableTable } =
  await import("../packages/db/src/schema/exam");
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
await db
  .update(classTable)
  .set({
    config: {
      subjects: {
        math: {
          name: "Mathematics",
          books: [],
          examModes: { written: { name: "Written", percentage: 100 } },
        },
      },
    },
  })
  .where(eq(classTable.id, schoolClass.id));
const [plan] = await db
  .insert(examPlanTable)
  .values({
    schoolId: school.id,
    sessionId: session.id,
    classId: schoolClass.id,
    examSlug: "midterm",
    subjectSlug: "math",
    totalMarks: 100,
    modeConfig: { written: { percentage: 100, maxMarks: 100 } },
    totalWorkingDays: 90,
    status: "active",
  })
  .returning();
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
  await db.insert(examResultTable).values({
    schoolId: school.id,
    sessionId: session.id,
    studentId: student.id,
    examPlanId: plan!.id,
    marks: { written: 80 + (i % 20) },
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
    rows: [
      {
        id: "slot-1",
        date: "2026-10-20",
        startTime: "09:00",
        endTime: "12:00",
        cells: {
          [schoolClass.id]: { subjectSlug: "math", modeSlug: "written" },
        },
      },
    ],
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
