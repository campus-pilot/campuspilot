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

## Lifecycle

1. `createExam` defines a stable slug, name and display order for a session.
2. `createExamPlan` selects an exam, class and subject. It derives modes from the
   class configuration unless explicitly supplied. Total marks default to 100.
   Percentages total 100; maximum
   marks must equal `totalMarks * percentage / 100` and be whole numbers. There is
   no implicit rounding.
3. `updateExamPlan` edits a draft or approved plan. Editing an approved plan resets
   it to draft. Omitted fields stay unchanged; send `totalWorkingDays: null` to
   explicitly clear that value. Exam, class and subject identifiers cannot be changed
   in place.
4. `transitionExamPlan` permits only `draft → approved → active → completed`, or
   `completed → active` to reopen. Governance transitions require school exam
   administrator access, including approval of the plan itself.
5. `upsertExamResult` or atomic `upsertExamResults` saves scores while the plan is
   active. Each student must be a registered enrollment in its school, session and
   class. Marks contain exactly the plan's modes and stay within their maxima.
   Co-scholastic keys must exist in session configuration; grade labels are free
   text. Attendance is optional, permitted only when enabled, and bounded by the
   plan's explicitly configured total working days.
6. `approveExamResult` reviews an existing result, or use `approved: true` during a
   save. Completion requires approved results for every currently registered
   enrollment in the class and approval of every saved result.
7. Completed plans reject all result mutations. Reopening preserves the saved
   results and their approvals; changing an approved result still requires a school
   exam administrator.

Historical, inactive sessions can be read but cannot be mutated. Plans cannot be
deleted after activation. Exam definitions cannot be deleted or removed through a
session-config replacement while any plans or timetable still reference them.

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
shared timetable writes exclusively lock the session. Result saves, reviews,
deletes and lifecycle transitions lock the same plan row, so they cannot race
with completion. Batches validate every row before upserting in one transaction.
Result entry also locks the referenced student and admission rows for the duration
of the write. Completion evaluates the current roster; student placement after
completion does not automatically create or rewrite historical results.
