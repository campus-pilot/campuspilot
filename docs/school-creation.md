# Self-service school creation

Any signed-in staff account can open a school of its own from the management
app, up to an **allowance** (one school by default). Someone who needs more
asks CampusPilot, and a platform administrator decides in the admin app. A new
school starts on a 28-day trial and becomes read-only when the trial ends
unless the next period is paid (no grace). This guide is the canonical reference: read it
before changing who may create a school, the allowance or its requests, the
school owner, or what a self-created school starts with.

Trials, plans and read-only schools are described in
[School billing](school-billing.md); this guide only adds how a school gets its
first trial, the start of its billing cycle, without an administrator.

## The facts

Each is its own fact, read on its own:

| Fact | Where | Meaning |
| --- | --- | --- |
| Allowance | `user.school_creation_limit` (default 1, CHECK ≥ 0) | How many schools the person may create over the life of the account. Changed only by an administrator. |
| Creations | `school_creation`, one row per school created | The ledger the allowance is compared with. `school_id` is set null when the school is deleted; the row stays. |
| Owner | `school.owner_user_id` (nullable, ON DELETE SET NULL) | The person accountable for the school. Set to the creator; changed only by an administrator. Null for schools an administrator created until one is named. |
| Requests | `school_creation_request` | A person's request for a larger allowance: the total wanted, why, and the administrator's decision. |

Migration `0075_school-self-creation.sql` adds them. Existing schools get no
owner and existing accounts the default allowance of one.

## Who may create a school

`readSchoolCreationStatus` (`packages/api/src/school-creation/school-creation.service.ts`)
decides from the facts above, in this order; the first that applies is the
refusal (`SCHOOL_CREATION_REFUSALS` in `school-creation.contract.ts`):

1. **`demo_account`**: `user.demo_school_id` is set. Demo logins never open real schools.
2. **`unverified_email`**: `user.email_verified` is false or the email is a
   placeholder. CampusPilot sends no verification mail, so an email sign-up
   stays unverified; a new owner signs in with Google. Every allowance costs a
   real mailbox, not a typed address.
3. **`member_of_other_school`**: the person is a member of a school whose
   owner is someone else (invited as principal, manager, teacher, accountant or
   exam coordinator, or added by an administrator). Staff of a school do not open
   schools of their own. Owning schools does not count against this.
4. **`limit_reached`**: the number of `school_creation` rows is at least the allowance.

A refused creation is `FORBIDDEN` with
`data: { reason: 'SCHOOL_CREATION_REFUSED', refusal }`; clients read it with
`schoolCreationRefusalOf(error)`, never from the message.

### Personal spaces are not counted

A personal space ([Personal space](personal-space.md)) is a school the person
owns, of kind `personal`. It writes no `school_creation` row, so it does not
use the allowance, and owning it is not `member_of_other_school`: someone with
a personal space can still create one school. Who gets a personal space is
decided by its own rules (a linked Google account, no school at all), not by
these.

## Closing the loopholes

| Attempt | Why it does not work |
| --- | --- |
| Create a school, delete it, create another | Users cannot delete schools (only `systemAdmin.deleteSchool`), and a deleted school's `school_creation` row stays and still counts. |
| Create a school, make someone else principal, leave, create another | The owner cannot be removed or lose the principal role (below), and leaving would not give the allowance back anyway: the ledger counts creations, not schools held. |
| Get invited somewhere, then create a school | `member_of_other_school`. |
| Send several creations at once | `createOwnSchool` locks the person's `user` row (`FOR UPDATE`) before deciding, so parallel requests run one after the other and only the allowance succeeds. |
| Sign up again with another typed email | Email sign-ups are never verified, so they cannot create schools. A new Google account is the remaining cost; the admin app lists who created what (School requests, Organizations). |
| Keep using a school after its trial | The trial ends on its own and the school is read-only (`SCHOOL_NO_PLAN`) until an administrator records a payment for the next period. |

## The owner

The owner (`school.owner_user_id`) is separate from roles: it says who is
accountable, roles say what someone may do. While someone is a school's owner:

- `school.removeMember` refuses to remove them, also when they try to remove
  themselves (FORBIDDEN, "Contact CampusPilot to transfer ownership").
- `school.updateMemberRoles` refuses any role set without `principal` for them.
  Adding other roles beside it is fine.
- Member reads carry `isOwner`; management and the admin app show an Owner
  badge and offer no Remove action for them.

`systemAdmin.updateSchoolOwner({ id, ownerUserId })` (admin app: Settings,
Owner card) names a new owner, who must already hold the principal role in the
school, or clears it with null. It changes no allowance: the creator's creation
still counts.

## Creating a school

`schoolCreation.createSchool({ name, location, registrationNo? })`, in one transaction:

1. locks the person and checks they may create one;
2. inserts the school with a unique slug from its name, no subscription
   (`tier` null) and the person as owner (steps 2 to 5 are
   `provisionSelfServiceSchool`, shared with personal spaces);
3. starts a trial of `SELF_SERVICE_TRIAL_TIER` (Plus, the smallest tier, named
   explicitly rather than derived from the tier order) for
   `SELF_SERVICE_TRIAL_PERIODS` (one) 28-day billing period, which starts the
   school's billing cycle; `created_by` is the creator;
4. switches the assistant add-on on with a limit of
   `SELF_SERVICE_ASSISTANT_MONTHLY_LIMIT_USD` (5 USD) per billing period, which also switches it on
   for the default roles;
5. adds the person as a member with the principal role;
6. writes the `school_creation` row;
7. offers the school its guided setup (a `school_onboarding` row, below);
8. selects the default document templates, the CampusPilot Standard set
   (`selectDefaultDocumentTemplates`, [Document system: Default templates](document-system.md#default-templates)),
   whose objects are removed when the transaction fails. Administrators' schools
   (`systemAdmin.addSchool`) and schools set up from an onboarding submission get
   them too; a personal space does not.

After the trial the school has no plan and is read-only, exactly as described
in [School billing](school-billing.md), until an administrator records a
payment (Billing card) for the next periods.

## Asking for more

`schoolCreation.requestMore({ requestedLimit, reason })`: the **total** wanted
(2 to `MAX_REQUESTED_SCHOOL_LIMIT`, above the current allowance) and why (20 to
1000 characters). Only someone whose only obstacle is the allowance, or who may
still create, can ask: a request never lifts another refusal. One request may
be pending per person (CONFLICT; a partial unique index backs it up).

Administrators see requests on the admin app's **School requests** page
(pending by default), with the person, their current allowance and every school
they created (deleted ones included). A shell warning in the admin app says how
many are waiting (`countPendingSchoolCreationRequests`).
`systemAdmin.decideSchoolCreationRequest` approves (setting
`school_creation_limit` to `grantedLimit`, which may differ from the request
and must be above the schools already created) or rejects, with an optional
note the person sees. A decided request cannot be decided again (CONFLICT).

Permissions: `system.school_creation_request.list` and
`system.school_creation_request.decide`, granted to `platform.admin`.

## Procedures

| Procedure | What it does |
| --- | --- |
| `schoolCreation.getStatus` | The allowance, the creations, the refusal (or null) and the latest request. |
| `schoolCreation.createSchool` | Above. |
| `schoolCreation.requestMore` | Above. |
| `systemAdmin.listSchoolCreationRequests({ status? })` | Requests, newest first. |
| `systemAdmin.countPendingSchoolCreationRequests` | The number waiting. |
| `systemAdmin.decideSchoolCreationRequest` | Approve or reject. |
| `systemAdmin.updateSchoolOwner` | Name or clear the owner. |

They are mounted under `schoolCreation`, not `school`: nothing here is scoped to
a school, and every write of the `school` router must name its `schoolId` so
the read-only gate finds it. All are hidden from MCP and the assistant
(`apps/server/src/mcp-catalog.test.ts`): opening schools and deciding
allowances are human decisions.

## Guided setup

Most people who open a school want a question paper, not a tour of settings.
So a self-created school opens into a guide that takes its owner from the
school's name to their first paper, with everything in between proposed and
saved in one step.

### Its facts

`school_onboarding` (migration `0077_school-onboarding.sql`), one row per school
that is offered the guide, written by `createOwnSchool` (step 7 above). Schools
an administrator opened, demo schools and every school created before the
guide have no row and never see it.

| Column | Meaning |
| --- | --- |
| `completed_at` | The guide finished: its session, examinations, classes, subjects and plans were created. |
| `skipped_at` | Someone chose **Set up later**; the guide stops opening on its own. It may still be finished later. |

`school.getOnboarding({ schoolId })` reads the state (`not_offered`, `pending`,
`skipped`, `completed`; any member may read it). Nothing infers the state from
whether the school has a session.

### What it proposes

The catalogue is `packages/api/src/school-onboarding/school-onboarding.contract.ts`,
its own and not the demo seed's:

- **Session**: the April to March academic year running today in India
  (`academicSessionStartYear`: 2026–27 from April 2026, 2025–26 in February
  2026), moved a year at a time.
- **Examinations**: First Term, Second Term, Third Term and Last Term, one to
  eight, each renamable. Slugs are derived from the names with the exam slug
  rule (`first_term`; `exam_2` for a name with no Latin letters).
- **Classes**: Nursery, LKG, UKG and Class 1 to 10 ticked, Class 11 and 12
  offered. Each gets section A.
- **Subjects**: a starter list per stage (Pre-primary, Primary, Middle,
  Secondary, Senior secondary), shown only for stages with a chosen class.
  Every subject gets a single mode, Written at 100%
  (`ONBOARDING_SUBJECT_EXAM_MODES`), so a subject has exactly one paper per
  examination. Mark splits are added later in the class's subject settings.
- **Paper header**: an optional logo and one of the two marketplace question
  paper designs (Classic or Compact), previewed with the marketplace's sample
  data.

### What saving does

**Finish setup** uploads the logo (if any) through the school's logo route,
selects the design with `school.selectMarketplaceTemplate` (skipped when the
school already has it, so a retry is harmless), then calls
`school.completeOnboarding`, which in one transaction:

1. locks the school and its guide row; without a row it is NOT_FOUND, a
   finished guide CONFLICT (a double tap changes nothing);
2. refuses a school that already has a session or a class (CONFLICT,
   `data.reason` `ONBOARDING_SCHOOL_NOT_EMPTY`): the guide only ever starts a
   school;
3. creates the session with its examinations (`createSchoolSessionRecord`,
   the function `school.createSession` uses), which becomes active;
4. creates the classes in catalogue order with their subjects
   (`createClassRecord`, as `school.createClass`);
5. generates every examination's plan for all of those classes
   (`generateExamPlanRecords`, as `school.generateExamPlan`);
6. sets `completed_at`.

It checks the permission of each step it takes (`school.session.create`,
`school.exam.create`, `school.class.create`, `school.exam.plan.create`), is
refused for a suspended school or one without a plan like every write, and
leaves the student-only session settings at their defaults, so a Plus trial is
never refused. The logo upload is optional: if it fails the setup continues and
the person is told to add the logo from Organization settings.

`school.skipOnboarding` sets `skipped_at` (it needs `school.session.create`).
All three procedures are hidden from MCP and the assistant.

## What management shows

- A person with no school sees **Set up your school** on `/school` with the
  create-school form itself: name, town and an optional registration number,
  the details a paper header prints. Someone whose allowance is used sees the
  button to ask for more, and anyone else the reason they cannot create one.
  `/school/new` (from the school switcher) shows the same panel.
- **Start free trial** creates the school and opens its guide at
  `/school/{id}/get-started` (`components/school-onboarding`), outside the
  workspace shell. Its first screen tells what the trial gives
  (`NewSchoolTrialFacts`: the plan and end date, the assistant's limit and what
  happens after, read from the school list and feature flags rather than the
  constants). The screens are Session, Examinations, Classes, Subjects and
  Paper header, one TanStack form validated with the procedure's own input
  rule, with **Set up later** on each.
- Once the guide is finished the same page offers the first paper: an
  examination (the first is chosen), a class and a subject, opening the paper
  on its start screen (photos, a description for the assistant, or a PDF).
  People without the assistant see only the way to the dashboard.
- Someone who cannot run the guide (a teacher added meanwhile) is told the
  owner sets the school up.
- A new school has no academic session, and every workspace page belongs to
  one. The school's entry page sends a school whose guide is `pending` to the
  guide. Otherwise every place that says the school has no session offers
  **Create a session** (`components/session/create-session-button.tsx`, gated
  on `school.session.create`): the school's entry page (with **Use the guided
  setup** beside it while the guide is set aside), the sidebar's session
  switcher and the statement's session requirement. `school.createSession`
  makes the new session active when the school has no active session (under a
  lock on the school, so two first sessions cannot both become active); with
  one already active it is created inactive and changing over stays an
  explicit `activateSession`.
- Beside the panel, someone with a linked Google account and no school sees
  **Create personal space** ([Personal space](personal-space.md)).
- **Ask for more schools** opens the request form in a dialog.
- The school switcher offers **Create a school** (`/school/new`, the same
  panel) to people who may create one or ask for more; staff of a school they
  do not own do not see it.

## Extending

- A new way to add someone to a school must not make them an owner; owners come
  only from `createOwnSchool` and `updateSchoolOwner`.
- A new way to remove members or change roles must keep the owner rules above.
- Changing what a new school starts with: change the constants in
  `school-creation.contract.ts` and this guide. The trial facts read the
  school's actual plan and assistant limit, so they follow on their own.
- Changing what the guide proposes: change `school-onboarding.contract.ts`
  (both the screens and the procedure read it) and this guide.
- Tests: `packages/api/src/school-creation/school-creation.integration.test.ts`
  and `packages/api/src/school-onboarding/school-onboarding.integration.test.ts`.
