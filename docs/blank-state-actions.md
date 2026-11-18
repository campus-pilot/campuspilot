# Blank-state actions (management app)

Every empty or blank state in `apps/management` (and the shared components it
renders from `packages/components`) that could offer a next step should offer
one. This file is the audit: each blank state, the action it offers (or why
none belongs there), the gates that action needs, and its status.

Rules every action follows:

- It reuses the existing create/invite dialog or mutation; there is no second
  copy. Where the empty state and the navbar both need an action, the action
  component carries its own gates (`RequirePermissions` with the exact
  backend action, `RequireFeature` when the area is feature-gated), so both
  places render the same gated component.
- It shows only when the list is empty because nothing exists yet. A list
  emptied by a search or a filter keeps its "No … match" text without an
  action.
- People without the permission (or schools without the feature) see the
  text only.

Status values: **done** (implemented in this change), **existing** (already
offered an action before this change), **no action** (with the reason),
**handled in fix/first-session-setup** (left to that branch to avoid
conflicts).

## Actions added or already present

| Screen | File | Current text | Action | Permission | Feature | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Classrooms list | `apps/management/components/classroom-list.tsx:105` | No classrooms have been created yet. | Add classroom (`AddClassAction` dialog → `createClass`) | `CREATE_CLASS` | — | done |
| Staff table | `apps/management/components/staff-table.tsx:443` | No staff members have been invited yet. | Invite staff (`InviteStaffAction` dialog → `inviteMember`) | `INVITE_MEMBER` (phone invite also `ISSUE_MEMBER_PASSWORD`) | — | done |
| Admissions table | `apps/management/components/admission-table.tsx:49` | No admissions match these filters. (also shown with no filters) | "No registered admissions yet." + New admission (`CreateAdmissionAction` → `createAdmission`) when no search and only the default filter (`isUnfilteredAdmissionList`) | `CREATE_ADMISSION`, `LIST_CLASSES` | `studentManagement` | done |
| Classroom → Students | `apps/management/components/class-students-table.tsx:23` | No students are assigned to this classroom. | Add student (`AddStudentAction` enrollment dialog → `createStudent`) when no search or section filter | `CREATE_STUDENT` or class `ADD_STUDENT`, plus `LIST_ADMISSIONS`, `LIST_SECTIONS`, `LIST_STUDENTS` | `studentManagement` | done |
| Add student dialog → admission picker | `apps/management/components/add-student-action.tsx` (`NoEligibleAdmissions`) | No eligible admissions found. | New admission (`CreateAdmissionAction`, opened over the enrollment dialog) under the picker when nothing was searched; the new admission is registered and refreshes the picker | `CREATE_ADMISSION`, `LIST_CLASSES` | `studentManagement` | done |
| Classroom → Teachers | `apps/management/components/class-teachers.tsx` (`NoAssignedTeachers`) | No teachers are assigned yet. | Add teacher (`AddTeacherDialog` → `updateMemberRoles`) | `UPDATE_MEMBER_ROLES` | — | done |
| Add teacher dialog | `apps/management/components/class-teachers.tsx` (`NoTeacherCandidates`) | No unassigned teachers found. | Invite staff (`InviteStaffAction`) with the teacher role ticked; inviting a teacher refreshes the candidates | `INVITE_MEMBER` | — | done |
| Classroom → Subjects | `apps/management/components/class-subjects.tsx` (`NoSubjects`) | No subjects have been added yet. | Add subject (`SubjectDialog` → `updateClassConfiguration`); the header Add and the per-subject Edit/Delete get the same gate | `UPDATE_CLASS_CONFIGURATION` | — | done |
| Examinations list | `apps/management/components/exam/exam-list.tsx:152` | No examinations yet | Create examination (`CreateExamAction` → `createExam`), active session only | `CREATE_EXAM`, `READ_SESSION` | — | existing (added on main by the create-examinations change) |
| Exam → Settings → Classes taking part | `apps/management/components/exam/exam-class-settings.tsx:76` | No classes yet. Create the exam plan to choose them. | Link "Create exam plan" to the exam's Results page (where the plan is created), while there is no plan, no class and the session is active | `CREATE_EXAM_PLAN`, `READ_EXAM_PLANS` | — | done |
| Documents → History | `apps/management/components/documents/document-history.tsx` (`NoDocumentsYet`) | No PDFs yet. Create your first document from the Create document tab. | "Create a document" button that opens the New tab, only for people who can read templates | template read permissions already resolved into the workspace's `access` | — | done |
| Billing → Cycle (runs) | `apps/management/components/billing/billing-runs.tsx:32` | No billing runs match this view. (also with no filter) | "No billing runs yet." + Create billing run (`BillingRunAction` → billing run dialog) when no search or filter; while the finance settings are not ready it says so and links to session settings | `READ_SESSION_FINANCE`, `PREVIEW_BILLING_RUN`, `POST_BILLING_RUN` | `studentManagement` | done |
| Dashboard → Examinations | `apps/management/components/dashboard/school-dashboard.tsx` (`ExaminationOverview`) | No examinations are available for this classroom scope. | Create examination (`CreateExamAction`, the Examinations list's dialog), school-wide scope and active session only; creating refreshes the dashboard | `CREATE_EXAM`, `READ_SESSION` | — | done |
| Dashboard → Class load | `apps/management/components/dashboard/school-dashboard.tsx` (`ClassLoad`) | No classrooms are available for this account. | Add classroom (`AddClassAction`), school-wide scope only; creating refreshes the dashboard | `CREATE_CLASS` | — | done |
| Dashboard → Recent notices | `apps/management/components/dashboard/school-dashboard.tsx` (`RecentNotices`) | No notices have been published to staff in this session. | New notice (`NewNoticeAction`) | `DRAFT_NOTICE` | `notices` | done |
| Admission → Documents | `packages/components/src/admission/admission-documents-view.tsx:93` | No document types are configured and no files have been attached. | Add documents (the view's own upload dialog, `canEdit` decided by the app) | decided by the caller (`canEdit`) | — | done |
| Notices list | `apps/management/components/notices/notice-list.tsx:46` | No notices yet | New notice | `DRAFT_NOTICE` | `notices` | existing |
| Exam → no plans | `apps/management/components/exam/exam-plan-creation.tsx:48` | No plans yet | Create plan | `CREATE_EXAM_PLAN` | — | existing |
| Exam → Timetable | `apps/management/components/exam/exam-timetable.tsx:73` | No timetable yet | Create timetable | timetable permissions | — | existing |
| Settings → document template | `apps/management/components/documents/document-templates.tsx:181` | No template selected | Browse marketplace | template permissions | — | existing |
| Statement document action | `apps/management/components/billing/finance-document-action.tsx:263` | No active statement template | Statement template (Settings link) | `READ_/MANAGE_FINANCE_DOCUMENT_TEMPLATES` | — | existing |
| No school | `apps/management/app/(protected)/school/page.tsx:16` | You are not part of a school yet | School creation panel | self-service creation allowance | — | existing |
| Session settings: examinations, grading scale, co-scholastic areas, finance | `packages/components/src/session/*-section.tsx` | No examinations configured / No grading scale defined / No co-scholastic areas / No finance schema configured | Add … / load recommended defaults | `UPDATE_SESSION` (caller passes `onChange`) | — | existing |
| Classroom setup warnings | `apps/management/components/classroom-workspace.tsx:39,134,143` | No teachers / subjects / students … | AppShellAlert actions (Add teachers / subjects / students) | — | — | existing |

## Session states (other branch)

These were done in `fix/first-session-setup` (PR #79, merged), which offers Create a session on each of them.

| Screen | File | Status |
| --- | --- | --- |
| School has no active session | `apps/management/components/school-selection.tsx` | handled in fix/first-session-setup |
| Session switcher (no sessions) | `apps/management/components/session-switcher.tsx:96,115` | handled in fix/first-session-setup |
| Sessions table | `apps/management/components/session/sessions-table.tsx:286` | handled in fix/first-session-setup |
| Statement "No academic session is available" | `apps/management/components/billing/finance-document-action.tsx:175` | handled in fix/first-session-setup |
| New school welcome | `apps/management/components/school-creation/new-school-welcome.tsx` | handled in fix/first-session-setup |

## No action

| Screen | File | Current text | Reason |
| --- | --- | --- | --- |
| Admissions table with a search or non-default filter | `apps/management/components/admission-table.tsx:47` | No admissions match this search / these filters. | Search/filter result. |
| Staff table with a search | `apps/management/components/staff-table.tsx:442` | No staff members match this search. | Search result. |
| Class students with a search or section filter | `apps/management/components/class-students-table.tsx:23` | No students match this search. | Search/filter result. |
| Billing runs with a search or filter | `apps/management/components/billing/billing-runs.tsx:29` | No billing runs match this view. | Search/filter result. |
| Notices with a search or filter | `apps/management/components/notices/notice-list.tsx:91` | No notices match … | Search/filter result. |
| Document history with a search | `apps/management/components/documents/document-history.tsx:125` | No documents match your search. | Search result. |
| Class sections table | `apps/management/components/class-sections.tsx:238,257` | No sections. | Unreachable: a classroom always keeps at least one section (the server refuses deleting the last one), and Add section is already in the section header. |
| Payment register | `apps/management/components/billing/billing-payments.tsx:492` | No payments match this view. | The Record payment entry is already directly above the table. |
| Record payment admission picker | `apps/management/components/billing/billing-payments.tsx:115` | No admissions found. | Search result inside a picker. |
| Billing run detail | `apps/management/components/billing/billing-run-detail.tsx:205` | No bills on this page. | A posted run is immutable; nothing to add. |
| Billing run dialog | `apps/management/components/billing/billing-run-dialog.tsx:157,170` | No optional run values / No student bills match this search. | Informational / search result inside the dialog. |
| Bill/receipt PDF run picker | `apps/management/components/documents/finance-document-generator.tsx:385` | No posted billing runs match this search. | Search result inside the document dialog; runs are created on the Billing page. |
| Admission ledger | `apps/management/components/billing/admission-ledger.tsx:944` | No financial activity has been recorded for this admission. | The ledger's own actions (bill, payment, adjustment) are in its header. |
| Notification delivery log | `apps/management/components/notifications/notification-delivery-log.tsx:126` | No notifications yet / No failed deliveries. | Read-only log. |
| Notification inbox | `packages/components/src/notifications/notification-inbox.tsx:59` | No notifications yet / No unread notifications | Read-only inbox. |
| Exam class roster | `apps/management/components/exam/exam-class-students.tsx:173` | No registered students match this selection. | Filter result of a read view; enrollment happens in the classroom. |
| Exam class not in plan | `apps/management/components/exam/exam-class-students.tsx:71` | No exam plan found for this class. | Not-found screen; breadcrumbs lead back. |
| Question papers tab | `apps/management/components/question-paper/question-paper-page.tsx:94` | No classes to show | Depends on the member's teaching assignments, which they cannot change themselves. |
| Question paper studio / chat history / versions | `question-paper-studio.tsx:518`, `paper-chat-history.tsx:59`, `packages/components/src/question-paper/version-list.tsx:81` | No paper yet / No conversation … / No version … | The paper's own card (photos, assistant) is the action on the same screen. |
| Question paper filters / navigation | `packages/components/src/question-paper/question-paper-class-accordion.tsx:15`, `question-paper-nav.tsx:90,193,202` | No papers match the selected modes / No examinations in this session / No classes you can open / No class matches. | Filter/search results or permission-scoped lists in the sidebar. |
| Published timetable / timetable preview | `packages/components/src/exam/published-timetable.tsx:51`, `timetable-preview.tsx:43` | No examinations scheduled for this class. | Read-only previews. |
| Student remark preview | `packages/components/src/exam/student-exam-remark-preview.tsx:36` | No remark written yet. | Read-only preview; the student editor is the entry point. |
| Exam plan review table | `packages/components/src/exam/exam-plan-review-table.tsx:181` | No subjects configured · cannot take part | Row note inside the plan dialog; subjects are set in the classroom. |
| Class finance overrides | `packages/components/src/session/class-finance-overrides-section.tsx:217-221` | Create the finance schema … / No fee elements … / Add classes … | Inside the session settings editor; leaving it would drop unsaved edits, and the text names the step. |
| Admission document settings | `packages/components/src/admission/admission-document-settings.tsx:67` | No requested documents configured. | The form's Add document type button sits right under it. |
| Admission document group | `packages/components/src/admission/admission-documents-view.tsx:34` | No files attached yet. | Per-type row; the view's Add documents button is in its header. |
| API keys | `packages/components/src/api-keys/api-key-list.tsx:115` | You have not created any API keys. | The create form is on the same panel. |
| Assistant table view | `packages/components/src/assistant/views/table-view.tsx:60` | Nothing to show. | Read-only tool output. |
| Command palette | `apps/management/components/management-command-palette.tsx:855-865` | No matching actions / No actions available. | Search result / permission-scoped list. |
| School switcher | `apps/management/components/school-switcher.tsx:119` | No schools match your search. | Search result. |
| Dashboard focus card | `apps/management/components/dashboard/school-dashboard.tsx:258` | Nothing currently needs attention … | Nothing to do is the message. |
| Dashboard billing metric | `apps/management/components/dashboard/school-dashboard.tsx:196,311` | No billed amount yet | Metric label inside a card that already links to billing. |
| Exam class column | `apps/management/components/exam/exam-classes.tsx:86` | No sections | Cell value; unreachable for the same reason as class sections. |
| Student result editor | `apps/management/components/exam/exam-student-workspace-form.tsx:307-316` | No grading scale is configured … / No additional assessments are enabled … | Inside result entry, usually used by teachers who cannot edit session settings; a link would take the person out of an editor with a draft. The text names where to configure it. |
| Finance ledger table | `packages/components/src/finance/finance-ledger-table.tsx:73` | No ledger entries match this view. | Filter result; ledger actions are in the ledger header. |
| Pickers and filter popovers | `packages/components/src/documents/student-recipient-combobox.tsx:147`, `packages/components/src/class-scope-picker.tsx:59`, `packages/components/src/data-grid/table-filter-bar.tsx:162` | No students / classes / options match … | Search results inside pickers. |
| Shared defaults | `packages/components/src/data-grid/data-table.tsx:60`, `packages/components/src/notifications/delivery-log.tsx:147` | No results found. / No notifications yet. | Fallback texts; each caller decides its own empty state. |
| Session not found | `apps/management/components/session/session-detail.tsx:106` | Academic session not found | Not-found screen; breadcrumbs lead back. |
| Notice not found | `apps/management/components/notices/notice-workspace.tsx:65` | This notice was not found … | Not-found screen. |
| Permission required / feature not enabled | `apps/management/components/permission-denied.tsx`, `feature-unavailable.tsx` | Permission required / … not enabled for this school | The person cannot act; the unknown state already offers Retry. |
| Load errors | `billing/finance-ui.tsx`, `session/session-finance-settings.tsx:63` | Unable to load … | Errors, not blank states. |

## Review findings

A deep review (Fable) of the whole diff produced eight findings. Applied:
Invite staff from the teacher picker now opens with the teacher role ticked
and the empty picker box is gone; the enrollment picker opens New admission
in place instead of linking away; the empty Cycle table explains a disabled
Create billing run; subject Edit/Delete got the same gate as Add; the
Create exam plan link needs no listed classes and both `CREATE_EXAM_PLAN`
and `READ_EXAM_PLANS`; Add student checks `LIST_STUDENTS` like
`createStudent`; the admission list's "unfiltered" rule moved to
`admission-table-model.ts` with tests.

Declined:

- Tests for the billing-runs "unfiltered" expression, the dashboard scope
  checks and `NoDocumentsYet`: each is a one-line condition in a component;
  the shared empty-action slot and the admission rule (the only non-trivial
  one) are tested.
- A session-settings link in the student result editor's "No grading scale"
  text: see the "No action" table.
