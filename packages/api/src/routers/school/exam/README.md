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

## Classes taking part

Whether a class takes part in an examination is its own stored fact,
`exam_class` (one row per session, exam and class, migration 0076), never
inferred from plans, results or timetable columns. Every subject plan
references its class's row (`exam_plan_exam_class_fk`), so plans exist only for
classes taking part; a class may take part without plans (after its last
legacy plan was deleted).

- `generateExamPlan({ classIds })` records exactly the chosen classes and
  creates their plans. A class still recorded from before (taking part without
  plans) that is not chosen stops taking part, under the same refusals as
  removing it with `updateExamClasses`; a chosen one is kept. An empty list, a class of another school and a chosen class without
  subjects are BAD_REQUEST; an invalid subject blocks only when its class is
  chosen. `classIds` is optional: left out, every class that has subjects
  (`selectableExamClassIds`) is chosen, which creates exactly the plans
  generation created before classes could be excluded, so existing API and MCP
  callers keep working. An explicit empty list is refused, never read as "all".
- `updateExamClasses({ configurationVersion, classIds })` (exam plan update
  permission) sets the complete list later, under the exclusive session lock.
  The review hash covers participation, so a concurrent change is a CONFLICT.
  Refused before a plan exists, once the exam is completed, and while it is
  released to the Cadet Portal. Added classes get plans from class settings,
  `active` when the exam has started (as starting does for every plan),
  otherwise drafts. A removed class is **refused** while it has saved results,
  shared attendance/activity assessments or remarks of its students, question
  papers, a published timetable that includes it, or a draft timetable that
  schedules papers for it; clear those first. Otherwise its plans, its row and
  an empty draft timetable column go, and chat conversations shared to its
  papers are unshared, as `deleteExamPlan` does.
- `createExamPlan` (legacy single plan) records its class as taking part.
  Adding a class this way follows the same lifecycle rule as
  `updateExamClasses`: it is refused once the exam has ended (and, as for every
  plan change, while released to the Cadet Portal). A class already taking part
  may still get further plans.
  `deleteExam` and session-config replacement remove a deleted exam's rows.
  `deleteClass` is a CONFLICT with a clear reason while the class takes part in
  any exam (instead of a foreign key error); take it out of the exam first.
- `updateExamClasses` needs only the exam plan **update** permission although
  it creates and deletes plans: changing the classes is one edit of the
  existing plan, and every role holding it also holds plan create and delete
  (`grants.rego`). If those grants ever diverge, revisit this.
- Reads that list an exam's classes use the row: `getExamContext.classes` (the
  timetable editor's columns) lists only classes taking part (none before the
  plan exists); `listExamClasses` lists classes taking part that have plans;
  `saveExamTimetable` accepts only classes taking part as columns, so **a
  timetable with columns cannot be saved before the plan exists**: generate
  the plan first (API and MCP callers too); documents
  refuse a `classId` that does not take part; the Cadet Portal lists an exam
  for a student's class record only when that class takes part (once any class
  does) and, once the exam has plans, also has plans of its own (a class taking
  part without plans, for example from the 0076 backfill, would otherwise wait
  for a release that can never include it), and filters timetable columns by
  it. A published timetable is listed for, opened by and announced to
  (`exam.timetable_published`) only students whose **current** class takes
  part (results follow the class they were made in; see docs/cadet-portal.md).
- Migration 0076 backfills the rows once from what existed: classes with
  plans, plus the timetable columns of every exam (with or without plans), so
  existing timetables keep rendering their columns.

## Lifecycle and student-wide API

1. Configure exam definitions in session settings, or create one with
   `createExam` (the management Examinations list does). `createExam` takes a
   slug in the settings format (`examSlugSchema`: lowercase letters, digits and
   underscores, up to 100 characters; `__proto__`, `constructor` and `prototype`
   are reserved, because Zod's record parsing drops a `__proto__` key and the exam
   would be stored but never read back; older stored slugs are not re-checked) and
   a name (`examNameSchema`: up to 200 characters, not only invisible characters),
   refuses a slug the session already has with `CONFLICT` carrying
   `data.reason: 'EXAM_SLUG_TAKEN'` (`exam-definition.contract.ts`; clients check
   `isExamSlugTakenError`, never the bare code, which database conflicts share),
   and lists the exam
   after the highest existing order (`nextExamOrder`) unless `order` is given. It
   reads and writes the configuration under the session row lock that the
   full-config `updateSession` save also takes, so a creation never drops another
   exam.

   `updateSession` replaces the whole exam map with what its caller submitted, so
   two guards keep a save from silently dropping exams:
   - **Stale saves.** `expectedUpdatedAt` (optional) is the session's `updatedAt`
     the caller's copy was read from. When the row read under the lock has another
     `updatedAt` (every exam definition write bumps it), the save is refused with
     `CONFLICT` carrying `data.reason: 'SESSION_STALE'` (`session.contract.ts`,
     `isSessionStaleError`) and nothing is written. It is checked before every
     other rule. The session settings screens always send it; MCP and other
     callers that do not edit an earlier copy may leave it out, and then the save
     applies to whatever is stored.
   - **Exams with data.** Removing an exam slug that has recorded data is refused
     with `CONFLICT` naming the exam (`session/session-exam-removal.ts`): plans (and their results), a timetable,
     a working-day limit that is set, student assessments, student remarks, a
     lifecycle that records anything beyond the bare `ready` row plan
     generation writes, a results notification record, or question papers.
     Generated document artifacts and assistant conversations do not block it,
     and neither does the exam's class selection (`exam_class`), which is
     deleted with the exam once the guard passes. Only slugs the stored
     configuration defines and the submission leaves out are checked, so data
     under a slug deleted earlier never blocks unrelated saves.

   **Changing an exam's slug in session settings makes it a new exam**: the save
   adds the exam under the new slug and removes the old slug. The old slug's
   plans, results and other data are not moved, so the change is refused while the
   old slug has recorded data, like any removal.

   **Exam names are unique within a session**, compared by `examNameKey` in
   `session-config.ts`: Unicode NFKC (so compatibility forms such as full-width
   letters match), invisible format characters (`\p{Cf}`: zero-width spaces and
   joiners, bidirectional controls, soft hyphens) removed, every whitespace run
   collapsed to one space (`Unit  Test` and `Unit Test` are the same name), trimmed,
   then lowercased with the fixed `en` locale. A name whose key is empty (only
   invisible characters) is refused (`examNameSchema`). `createExam` refuses a
   name another exam has (after the slug check, so a request whose slug is also
   taken is refused as a taken slug), and `updateExam` refuses a new name another
   exam has; keeping an exam's own name or changing only what the key ignores is
   allowed. Both answer
   `CONFLICT` with `data.reason: 'EXAM_NAME_TAKEN'` (`isExamNameTakenError`).
   `createSession` and `updateSession` refuse, with the same error, a submitted
   exam map that *introduces* a clash (`findIntroducedExamNameClashes`): a group of
   exams sharing a name that contains an exam that is new (its slug is not stored)
   or renamed. Duplicates stored before the rule keep saving, so saving unrelated
   settings never fails for such a session. The rule is not a refinement of
   `examConfigSchema`, which also parses stored configurations and DTOs, where a
   refinement would make stored duplicates unreadable.

   `getExamPlanPreview` returns
   classes, registered enrollment counts, subjects, assessment modes, whether
   each class takes part (`participating`) and a configuration hash.
   `generateExamPlan` takes the reviewed hash and, optionally, the `classIds` taking
   part (default every class with subjects; see "Classes taking part") and atomically creates draft
   planning snapshots for them and an explicit **ready** examination from
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
IDs of classes taking part, so the plan must exist first (before it only a grid
without columns is accepted). Rows have stable unique IDs, real ISO dates, local `HH:mm` times
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
