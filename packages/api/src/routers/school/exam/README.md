# Exam backend

Exam definitions stay in `schoolSession.sessionConfig.examConfig`. Plans snapshot
one class subject's assessment modes; results are unique per plan and enrollment.
The optional timetable is shared by an entire session exam. All procedures live
under `school` in the application router and use the existing RPC, OpenAPI and MCP
transports. This module does not generate documents or provide UI.

## Permissions

| Operation                                                  | Platform admin | Principal / manager / exam coordinator | Teacher                 | Accountant |
| ---------------------------------------------------------- | -------------- | -------------------------------------- | ----------------------- | ---------- |
| Read exams, plans, results, roster and timetable           | Yes            | Yes                                    | Yes                     | Yes        |
| Exam definitions, plans, lifecycle and timetable mutations | No             | Yes                                    | No                      | No         |
| Enter / edit / delete unapproved results                   | No             | Yes                                    | Any class in the school | No         |
| Approve results                                            | No             | Any class in the school                | Assigned classes only   | No         |
| Edit / delete / revoke approval of approved results        | No             | Yes                                    | No                      | No         |

School assignments must match the requested school. Teacher approval additionally
requires the requested class in that assignment's `meta.classIds`. School roles
and platform roles are independent assignments: a platform role never substitutes
for a school governance grant. Session configuration endpoints apply the same
exam-governance boundary, including full-config replacements.

## Lifecycle and student-wide API

1. Configure exam definitions in session settings. `getExamPlanPreview` returns
   classes, registered enrollment counts, subjects, assessment modes and a
   configuration hash. `generateExamPlan` atomically creates draft planning snapshots and an explicit **ready** examination from
   that review. There is no per-subject approval prerequisite. A school principal,
   manager or exam coordinator must manually start it through `transitionExam`
   before results may be saved, approved or deleted, including legacy APIs.
   Each subject has 100 total marks; invalid configuration, existing plans and
   changed reviews reject generation without partial writes.
2. `listExamClasses` paginates saved class snapshots, counts and sections;
   `listExamStudents` paginates registered enrollments with section/name filters
   and saved/approved subject progress. Lists use the shared 20-item limit.
3. `getStudentExam` reads one consistent student workspace in a repeatable-read
   transaction. `saveStudentExam` atomically saves **every** subject and one shared
   attendance/activity assessment, with explicit `approved` intent. It reuses the
   existing school write, class approval and school revision permissions.
4. Session config enables tracking and defines co-scholastic area names.
   `getExamAssessmentSettings` / `updateExamAssessmentSettings` manage the exam's
   explicit working-day limit independently from the subject plan snapshots.
   Attendance is optional, nonnegative, integral and bounded by that limit.
5. `transitionExam` completes all plans together after registered enrollments have
   approved results and enabled shared assessments are reviewed. It also rejects
   any unapproved saved score/shared assessment. Reopening preserves approvals;
   the same single action opens pre-existing legacy draft/approved subject plans.

Migration 0015 adds `exam_lifecycle` with independent ready/active/completed state
and nullable known start/completion timestamps. `getExamOverview` and `listExams`
expose plan generation and exam status independently. Legacy states are migrated
without fabricating transition times. Migration 0014 adds `exam_assessment_settings` and `exam_student_assessment`.
The latter stores one shared attendance/activity/approval record per exam and
student enrollment. Legacy `exam_result` metadata stays preserved separately;
new saves do not infer or overwrite shared values from those old fields.

Mutations lock session before subject plans, with plans ordered by ID. Academic
writes, shared metadata and approval commit or roll back together. Working-day
changes lock the session exclusively and cannot invalidate recorded attendance.
Inactive sessions and completed plans remain protected independently of role.

### Compatibility procedures

Existing single-plan/result CRUD, roster, batch saves and transitions remain for
old API consumers. `createExamPlan` still creates a draft; `transitionExamPlan`
retains its legacy draft → approved → active → completed contract. They no longer
drive management navigation or automatic creation. Subject marks snapshots remain
locked after activation. Exams with referenced plans/timetables cannot be deleted
or removed by replacing session configuration. The normal new flow uses
`generateExamPlan`, `saveStudentExam` and exam-wide `transitionExam`.

## Save and approve

Both single and batch upserts accept an explicit `approved` boolean, defaulting to
`false`. A teacher can save an unapproved result in any class of the same school.
Requesting `true` additionally checks assigned-class approval permission before
any database writes. A rejected approval returns `FORBIDDEN` with an explanation
identifying the allowed reviewers; it never silently downgrades the request to an
unapproved save. Changing an already approved row independently requires the
school-level revision permission, even for its assigned teacher.

```ts
await client.school.upsertExamResult({
  schoolId,
  sessionId,
  classId,
  examPlanId,
  studentId,
  marks: { written: 65, practical: 18 },
  coScholastics: { art: "A" },
  daysAttended: 180,
  approved: true, // false for Save; true for Save & approve
});
```

A batch targets one plan and supplies `results: [...]`, with each entry containing
its own student ID, marks, optional attendance and grades, and approval flag.
Duplicate student IDs or any invalid/unauthorized row reject the entire batch.
Saving with `approved: false` clears approval when the caller is allowed to revise
an existing approved result.

## Timetable

`getExamTimetable` returns `null` when absent. `saveExamTimetable` atomically creates
or replaces a grid; `deleteExamTimetable` removes it. Columns are ordered, unique
school class IDs. Rows have stable unique IDs, real ISO dates, local `HH:mm` times
and an end time strictly after the start time. Cells allow null, one subject/mode,
or a nonempty array of subject/mode pairs configured for that class. Duplicate
pairs and overlapping slots for a class are rejected. A completed plan freezes
the exam's shared timetable until that plan is reopened.

## Reads and pagination

`listExams`, `listExamPlans`, `listExamResults`, and `listExamRoster` return the
standard `{ items, pagination }` response with a maximum page size of 20. Pass
`page` or `cursor`, never both. Plans support independent `filters.classId` and `filters.status`; results support
independent student and approval filters. Every collection exposes an allowlist of
`orderBy` fields, with an explicit default order and a deterministic tie-breaker.
Single-resource reads return `NOT_FOUND` for missing entities or mismatched parent
identifiers. `getExamContext` exposes the exam's class subjects/modes and session
assessment settings for API consumers.

## Concurrency

All exam mutations lock the academic session before the plan. Definition and
shared timetable writes exclusively lock the session. Automatic generation also
locks the session and reviewed class rows, preventing competing creation and
configuration updates from overwriting an existing plan. Result saves, reviews,
deletes and lifecycle transitions lock the same plan row, so they cannot race
with completion. Batches validate every row before upserting in one transaction.
Result entry also locks the referenced student and admission rows for the duration
of the write. Completion evaluates the current roster; student placement after
completion does not automatically create or rewrite historical results.

## Result notifications

`exam-result-notification.router.ts` (service in
`packages/api/src/notifications/emitters/results.ts`):

- The first `releaseExamToCadet` of an examination notifies its students
  (D-43), in the release's transaction and with no permission beyond the
  release: every registered student of the examination's classes gets one
  `exam.results_published` event (key `exam-results:<publicationId>:<admissionId>`,
  data naming the student's enrollment and class for the Cadet result link),
  recorded as the batch row `exam_result_publication` (unique per
  school/session/exam) with the recipients and per-channel forecast. Withdraw
  sends nothing, and a re-release finds the batch and notifies nobody again;
  corrections use the single send. A release with no registered students
  writes no batch, so a later release that addresses students notifies them.
- `previewExamCadetRelease` (exam transition permission) returns what a release
  would notify: `first_release` with the forecast, or `already_notified`.
- `getExamResultPublication` (read exams) returns the batch or `null`.
- `previewStudentResultNotification` / `sendStudentResultNotification`
  (`class.notification.result.send`, teachers only for assigned classes): any
  started examination, independent of the release. The student's report card
  must be buildable (registered, every included subject approved); otherwise
  BAD_REQUEST. Each new client idempotency key sends again.
- The API sweep finishes a batch once every delivery settled (or 4 days
  passed) and notifies the releaser with `exam.results_publish_finished`
  (WhatsApp outcome per student: sent, skipped, failed = the rest).

## Cadet Portal release and remarks

`releaseExamToCadet` / `withdrawExamFromCadet` (exam transition permission)
set or clear `exam_lifecycle.cadet_released_at` / `cadet_released_by`. This is
its own fact: completion never releases anything. Release requires a
completed examination (results approved and read-only); reopening is refused
while released, so students never see marks that can still change. Earlier
sessions can be released too. `getStudentExamRemark` / `saveStudentExamRemark`
(result read / write permissions) keep one remark per student and exam in
`exam_student_remark`, writable once the exam has started (also after
completion) in the active session and frozen while released. School-level
`getCadetPortalSettings` / `updateCadetPortalSettings` (school details
permissions) control whether the Cadet Portal shows class averages; the cadet
procedures omit them on the server when off.

## Question papers

Teachers upload photos of a handwritten paper per class, subject and assessment mode
of an exam, and a structured question paper is generated from them (by the AI job or
by a chat agent). The code lives in the sibling folder
`../question-paper/` (see its README and the canonical guide
`docs/question-papers.md`); the facts that matter here:

- A paper is keyed by `(session, exam, class, subject, mode)`, the natural key of an
  exam plan, and has **no foreign key to `exam_plan`** because plans are deleted and
  regenerated. `deleteExamPlan` therefore deletes that class and subject's papers (every
  mode) in the same transaction, with their pages, figures, versions and PDF artifacts,
  and removes the stored objects after the commit. A running AI generation for such a
  paper goes with it.
- Papers are read-only once the exam is `completed` and editable before that,
  including after the exam started; this is the exam's own lifecycle row, never the
  plan status.
- The Question paper tab of the management app is gated by the `assistant` feature, not
  by an exam permission: the class permissions `class.exam.question_paper.read` and
  `.manage` decide what a user may do, and the assistant gate decides whether the
  feature exists for them.
- A demo school's seed writes papers for an exam that is `ready` (or `active`) with
  the service functions (`docs/demo-school.md`, "Question papers").
