# Examinations

Follow the [management UI patterns](../../docs/ui-patterns.md) for shared layout,
controls, navigation, warnings and mobile verification. That guide also records
the redesign decisions and the earlier approaches they replaced.

The management flow is exam → class/section roster → student → every subject.
Exams come from session settings. A dashed empty state opens a concise plan-review
dialog with classes, student counts, subjects and modes. Each class row expands
its subject/mode breakdown in a sub-table; there is no separate accordion. Automatic generation
creates draft snapshots and a Not started examination; no per-subject approval step
exists. Starting is a separate school-admin action. Classes and rosters use the app's shared DataTable and full workspace width.
The detail workspace uses admission/classroom secondary navigation: Results,
Timetable and Settings. Working days and lifecycle controls live in Settings;
once a plan exists, the in-page overflow contains contextual admit-card and Create
Results actions, with Create Results disabled until the examination is completed. Student names are
non-interactive before the examination starts. The navbar shows the lifecycle
action only at the exam root; class and Settings pages have no navbar action.
Student and timetable pages have no navbar action. A populated timetable uses the
in-page overflow for editing, downloading and deletion; an empty timetable keeps
Create timetable in its empty state.
A persistent AppShellAlert links to the working-days editor when
attendance is enabled but not configured. Shared compact control sizes are used
without feature height overrides. Old subject-first URLs redirect to the new class/student routes.

The student workspace previews all subject scores plus one shared attendance/activity
assessment. Opening a student URL during an active examination goes directly to
the result form when the user has write access (and revision access if any saved
component is approved). Other users and closed examinations open the saved preview.
Save or Cancel deliberately returns to that preview. A single atomic save sends every subject and explicit approval intent.
The editor footer groups Save, its optional approval dropdown and Cancel. Save
stores results for review; Save & approve is available from the dropdown only with
approval permission. There is no separate preview button in the editor.
Teachers enter any class; only assigned class teachers or school exam administrators
approve. Revising an approved component requires elevated revision access.
Activity grade dropdowns read the current session grading scale, highest minimum
score first, storing grade labels. No grade is allowed; existing labels outside the
current scale remain visible and preserved rather than silently remapped.

Attendance follows the session's enabled flag and an independently configured exam
working-day limit. Legacy per-subject attendance/grades are preserved and displayed
separately, never silently converted to shared facts. Full contract and mobile UX:
`.sks/exam-ui.md`; backend details: `packages/api/src/routers/school/exam/README.md`.

Timetables remain optional, after creation. The page shows a table for every class
without a class filter. The editor grid supports draggable class columns with a
remove icon, multiple assessments per cell, and tooltip-labelled timing tools
that open reuse/copy dialogs. New slots advance the date and inherit the previous
row's times. Add date and time slot is always the grid's final row, including in
an otherwise empty grid. Add class appears only when a class is missing. Expand
editor stays at the footer's left and Save/Cancel at its right. Phones use the same
table while editing one class at a time without discarding the other columns.
Removal/discard and in-app navigation use app dialogs rather than browser confirm functions. Completion/reopening
is exam-wide; completed/inactive sessions are read-only. Report links open the
document workspace for the whole examination, class or student. Timetable export
opens the same workspace with the examination preselected. Source reads and
generation are independently permission-gated; lifecycle actions stay in Settings
and the exam-root navbar.

All input workflows use TanStack Form with Zod. Dirty editors retain their baseline
through background refetches, validate beside fields and
confirm discards. Ambiguous save failures require reloading saved data before retry.

Checks:

```sh
pnpm --filter @campuspilot/api test
pnpm dlx tsx@4.23.13 --tsconfig apps/management/tsconfig.exam-tests.json --test apps/management/components/exam/exam-validation.test.ts apps/management/components/exam/exam-student-workspace-model.test.ts
pnpm check-types
```
