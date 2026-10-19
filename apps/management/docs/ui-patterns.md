# Management UI patterns

This guide records the conventions clarified during the examination redesign.
Read it before adding or redesigning a management workflow. Existing comparable
screens and shared components are the starting point; a feature should feel like
part of the same application. These decisions also apply to future work. Older
screens may still contain exceptions; their presence does not override this guide
or the repository's form and permission rules.

## Start with a comparable implementation

Inspect the relevant screen, its layout, and the underlying shared controls before
writing a new component. Match behavior as well as appearance. A reference from an
older platform can inform the workflow, but its folders, styling and component
APIs must be adapted to this application.

| Need | Reference |
| --- | --- |
| Search, filters, operational tables and pagination | [Admission table](../components/admission-table.tsx), [staff table](../components/staff-table.tsx), [shared data grid](../../../packages/components/src/data-grid) |
| Detail header, desktop secondary navigation and mobile section selector | [Admission workspace](../components/admission-workspace.tsx), [classroom workspace](../components/classroom-workspace.tsx) |
| Persistent setup warnings | [Classroom workspace](../components/classroom-workspace.tsx), [AppShellAlert](../../../packages/components/src/app-shell.tsx) |
| Shared control sizing | [Button](../../../packages/ui/src/components/button.tsx), [Input](../../../packages/ui/src/components/input.tsx), [Select](../../../packages/ui/src/components/select.tsx) |
| Typed permission gates | [RequirePermissions](../components/require-permissions.tsx), [management agent instructions](../AGENTS.md) |
| Examination application of these patterns | [Exam workspace](../components/exam/exam-workspace.tsx), [class roster](../components/exam/exam-class-students.tsx), [student editor](../components/exam/exam-student-workspace-form.tsx) |

Reuse the presentation and behavior of these references while following current
TanStack Form, authorization and component-boundary requirements. Copying an old
screen's implementation wholesale can carry forward outdated patterns.

## Width, density and controls

- Match the surrounding workspace width. Admission and detail workspaces use
  `mx-auto w-full max-w-7xl`; do not introduce a narrower feature container without
  a specific layout need. Use `min-w-0` on flexible content so tables can scroll
  inside their container.
- Use shared Button, Input and Select sizes. Do not add feature-level height,
  minimum-height or padding overrides to make all controls larger. If a default
  needs changing, change the shared component deliberately and check its consumers.
- Current shared default buttons and inputs are `h-7` (28px); the shared filter
  trigger is `h-8` (32px). These describe today's components, not a separate sizing
  system for each feature. Keep controls readable, focusable and clearly labelled.
- Use the compact table density already established in admissions and staff.
  Avoid unnecessary stacked cell content and generous row padding. Use separate
  columns when that makes a record easier to scan.
- Pair `TableSearchBar` with `TableFilterBar` in the same wrapping toolbar, as in
  admissions. Align their tops; different shared control heights are intentional.
  Do not make a section filter visibly taller than the standard filter control.
- Give non-submit buttons `type="button"`, including preview and dialog actions.
  Give actual form submission buttons `type="submit"` explicitly. A preview must
  never submit because of an HTML button default.

## Page identity, navigation and actions

Use one parent page heading with the resource's human-readable name. Nested class
and student views use subordinate headings. Resolve breadcrumb labels to names
and include the current resource, rather than leaving the trail at its parent.
Session context already supplied by the shell and breadcrumb does not need another
session heading in every examination screen.

Detail workspaces use left secondary navigation on desktop and a shared section
Select on mobile. Sections have navigable routes. Follow the admission/classroom
layout instead of adding button-shaped tabs. Breadcrumbs provide parent navigation;
do not add another feature-level back button.

Keep section navigation in the secondary sidebar, without duplicating it in the
header's overflow menu. Examination sections are Results, Timetable and Settings.
The examination overflow contains only the applicable lifecycle action. Navbar
actions are specific to the exact route, with no inheritance from the exam root:

| Page | Navbar action |
| --- | --- |
| `/exam/<slug>` | Applicable Start / Complete / Reopen action |
| `/exam/<slug>/classes/<classId>` | None |
| `/exam/<slug>/classes/<classId>/students/<studentId>` | Disabled Preview placeholder until implemented |
| `/exam/<slug>/timetable` | Create timetable or Edit timetable, with the same editor and authorization as the page action |
| `/exam/<slug>/settings` | None |

Settings holds
working days and lifecycle controls. Keep the immediate task visible in context: Create plan in an empty state,
Enter results in a student preview, and Save in an editor. Avoid a row of competing
buttons. Menu entries must preserve the underlying shared component's required
group/context hierarchy; inspect the actual wrapper before composing its parts.

Use operational tables for classes, students, admissions and staff. The examination
definition list intentionally uses compact cards with a name, plan availability,
and exam status. The entire card links to the examination workspace; do not add a
redundant details link. This collection-specific decision does not make cards the
default for every operational list.

## Empty states and configuration-driven creation

An empty state should explain the missing resource and offer one next action.
For an examination without plans, show the examination name followed by a dashed
container with “No plans yet”, a short muted explanation, and Create plan.

Create plan opens a concise review dialog. Summarize classes, enrolled student
counts, subjects and modes. Clicking a class row expands its subject/mode breakdown
as a sub-table directly underneath it; do not add a separate all-classes accordion.
Do not ask users to re-enter facts that already exist in session/class configuration.
The server validates the reviewed configuration and creates the plans atomically.
Reject a stale or invalid review without leaving partial plans behind.

Keep optional follow-up work separate. A timetable can be created or edited after
the plans exist; it is not a prerequisite in the creation dialog.
When no timetable exists, show one dashed empty state with “No timetable yet” and
a small, permission-gated Create timetable button inside it.

## Warnings and feedback

Persistent, actionable setup gaps belong in `AppShellAlert`, following the classroom
workspace. They should not become repeated body banners or disappear with a toast.

- Supply a stable, resource-scoped `slug`, `type="warning"` and concise message.
- Render the registration only while the unresolved condition exists. Remove it
  when saved data confirms the condition is resolved.
- Gate `actionLabel` and `onAction`/`actionHref` with the corresponding mutation
  permission. A viewer may see the warning without receiving an edit action.
- An `onAction(closeDialog)` handler closes the shell alert list before opening
  the relevant editor. Reuse that editor from the Settings page as well.
- For example, missing exam working days produces a shell warning when attendance
  is enabled; its action opens the working-days dialog.

Show validation errors beside their fields. Show request failures in the relevant
editor/dialog, retain input and offer an appropriate retry or reload. Use transient
feedback for successful saves. Shell setup warnings are not a general error log.

## Forms, previews and permissions

Use TanStack Form `useForm` for all input workflows, with Zod through `validators`,
adjacent field errors and `form.Subscribe` for submit availability/progress. Do not
introduce standalone `useState` input/submission state or unapproved `useEffect`.
Keep reusable presentation in `@campuspilot/components`, with props and callbacks;
API orchestration belongs in the management app.

Keep blank marks distinct from zero. Preview validates and shows the current draft
without saving it. Preserve an editor's baseline through background query refetches;
only an explicit save, discard or reload should replace that baseline. Confirm
discarding dirty input with the app's dialog pattern, offering Keep editing and
Discard. When a save's outcome is ambiguous, reload saved state before retrying.

Use the shared ConfirmationDialog/AlertDialog for in-app removal, discard and
navigation decisions. Do not call window.confirm, window.alert or window.prompt.
Navigation guards must await the user's app-dialog decision before changing scope.
The native beforeunload warning is reserved for browser reload/tab closure, where
an app dialog cannot keep the document alive.

Permission-gate protected reads and every mutation entry point with the exact typed
`RequirePermissions` scope used by the backend. The server still enforces access.
Keep visibility, permission and lifecycle eligibility separate: having a role does
not make a completed examination editable.

## Examination decisions to preserve

The current user journey is **examination → class/section → student → all results**.
The [feature guide](../components/exam/README.md) and
[backend contract](../../../packages/api/src/routers/school/exam/README.md) describe
the implementation and APIs in more detail.

- Session configuration defines examinations. There is no Create Exam action in
  the examination workspace. Plan creation snapshots the existing subjects/modes.
- Generating plans leaves the examination Not started. Starting it is a separate,
  explicit school governance action. Completing and reopening are exam-wide.
  The normal UI has no per-subject plan approval prerequisite.
- Plan availability, examination lifecycle, result approval, timetable availability
  and session editability are independent facts. Never infer one from another.
  Preserve unknown historical timestamps rather than inventing them.
- The student editor collects all subject/mode scores together, plus attendance
  and co-scholastic areas enabled by session configuration. Shared attendance and
  activities appear once, with an independently configured exam working-day limit.
  Legacy per-subject metadata must not silently become shared assessment data.
- A student result URL opens directly in edit mode when the examination and session
  allow entry and the user has write permission, including revision permission for
  approved data. Otherwise show the saved preview. Save/Cancel explicitly returns
  to that preview; background refetches must not reset an open editor's draft.
- Activity grades use a dropdown from the current session's grading scale, ordered
  by minimum score descending. Store the chosen grade label rather than its config
  key. Allow No grade and preserve existing values outside the current scale as
  clearly labelled historical options. An empty scale must not invent new grades.
- School principals, managers and exam coordinators govern plans, schedules and
  lifecycle. Platform administrators have view access; school staff can view.
  Teachers may enter unapproved results for any class in their school, and approve
  only assigned classes unless they separately hold elevated school permissions.
- Save for review and Save & approve send explicit approval intent. Requesting
  approval performs the additional server check; denial must return a useful error
  rather than silently saving an unapproved result. Revising approved results
  requires elevated access independently of the original approval permission.
- Save the complete student assessment atomically. An unauthorized or invalid
  component must not leave the rest partially saved. Completed examinations and
  inactive sessions remain protected independently of the user's role.
- Timetables are optional. Mobile editing of one class must preserve the grid's
  other classes. Document exports use the shared Documents workspace; contextual links preselect the examination, class or student without adding navigation items to lifecycle menus.
- The timetable page shows a separate table for every class, without a class filter.
  The builder stays a date/time × class table on desktop and mobile (mobile may edit
  one class at a time). Headers contain a drag handle, class name and remove icon;
  omit left/right move buttons. Show Add class column only for missing classes.
- New slots advance the last valid date by one calendar day and inherit the last
  row's start/end times. Reuse time and Copy time are tooltip-labelled icons that
  open dialogs; copying allows multiple destination slots and preserves assessments.
  Keep Add date and time slot as the grid's final row, including when the grid is
  otherwise empty. Put Expand editor at the footer's left, with Save and Cancel at
  its right. Keep the editor header to its title rather than repeating instructions
  above the table.

## Corrections from the redesign

| Earlier approach | Established direction |
| --- | --- |
| A separate visual style and narrower exam workspace | Match admission/classroom width, spacing, typography and shared layouts |
| Oversized feature buttons, inputs and rows | Compact shared defaults; no local height inflation |
| Manual subject-by-subject plan creation and approval | Review configured classes once, then generate plans automatically |
| Plan generation immediately opens results entry | Generate first; authorized school governance explicitly starts the exam |
| Subject-first results navigation | Class roster, then one student workspace containing every subject |
| Repeated back buttons, button tabs and action rows | Breadcrumbs, secondary navigation and a header overflow menu |
| A prominent body action for missing working days | Persistent shell warning linked to the same settings editor |
| Tables everywhere, including the exam definition list | Compact exam cards; operational tables for classes and students |

## Mobile and visual verification

Most users use phones. Check at 320px and 390px as well as desktop. Stack toolbars
and form sections when needed; keep shared control sizing. Long titles must wrap
or truncate without pushing actions offscreen. Keep menus, dialogs, validation and
save actions usable with the mobile keyboard and viewport constraints.

There must be no page-level horizontal overflow. Wide tables scroll inside their
own wrapper. Use the mobile section selector instead of a cramped desktop sidebar.
Hiding or editing one part of a view must not discard data belonging to other parts.

Inspect the comparable existing screen and the new implementation in the browser.
Check populated and empty states, control/filter alignment, row density, overflow
menus, warnings, dialogs, validation, preview, unsaved changes and permission-gated
actions. Type checks do not establish that the UI looks or behaves correctly.
Use disposable fixtures when verification would otherwise start a real examination
or alter real student results. Remove temporary QA routes and restore browser
viewport changes after verification.
