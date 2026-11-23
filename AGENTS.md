# Monorepo

We are using Turborepo with pnpm on Node 24.

## Apps

- `management` is the actual customer facing app for the customers
- `server` is the api server
- `web` is the website

## General

Be careful around making assumptions. If in doubt, ask the user for clarification.

Don't opt for band-aids without explicit consent. Always yield to the user before adding a workaround instead of a fix.

Never infer one fact from another that merely correlates with it today. Model each fact as its own explicit field, even when they currently coincide.

Add jsdoc comments to explain behavior, precedence, or non-obvious implementation decisions.

Do not use `useEffect` unless the user has explicitly approved it. Prefer derived values, event handlers, keyed component lifecycles, TanStack Query, or framework-native data loading as appropriate. If an effect is genuinely required, explain why and ask for approval before adding it.

## Forms and user input

Use TanStack Form's `useForm` for every form and user-input workflow. Do not manage input values or form submission state with standalone `useState` calls.

Define validation with Zod through the form's `validators` option. Surface field validation errors next to their inputs and derive submit availability and progress from `form.Subscribe`.

# Components

Componets must be small and should server exactly one purpose

no more than 5 level of nesting in the the html tags

You can keep multiple components in one file

In case a component has a lot of logic create a use\_\_\_ (hook) in same component file if theya re something not reusable

Prefer flex + gap instead of space-x/space-y if possible.

The Shadcn components living in `@campuspilot/ui` are based on Radix (`radix-ui`, shadcn style `radix-mira`), NOT Base UI. Do not add `@base-ui/react` or any Base UI component to the repo; build new primitives on Radix (and cmdk for searchable lists, as in `combobox.tsx`).

Radix compound components must preserve their required context hierarchy. Keep every part inside its root's content (for example `DropdownMenuItem` inside `DropdownMenuContent`, `SelectItem` inside `SelectContent`). Never use a group label such as `DropdownMenuLabel`/`DropdownMenu.Label` outside the `DropdownMenuGroup`/`DropdownMenu.Group` it labels, or radio menu items (`DropdownMenuRadioItem`/`DropdownMenu.RadioItem`) outside `DropdownMenuRadioGroup`/`DropdownMenu.RadioGroup`. Check the underlying Radix composition requirements whenever adding a compound component part.

Any reusable components / layouts should live in @campuspilot/components, in these components data are passed as props and mutation must sent via callbacks. There should be no api call within @campuspilot/components

For reusable compopnents / layouts that need api calls they should be placed in apps/-the app-/src(if src)/components folder

# Public, non-expiring blobs (`/blob/*`)

The API server's `/blob/*` routes serve files at stable URLs that never expire,
with no session or permission check (for example
`/blob/school/{schoolId}/logo?size=192|512`, used for favicons and installed-app
icons that browsers re-fetch in the background without credentials). Use
`/blob/*` only when a URL genuinely must not expire and the file is safe for
anyone to read. The school logo blob is for browser icons only (favicon,
web-app manifest and apple-touch icons). Logos shown inside pages, such as the
school avatar or switcher, keep using the permissioned `school.getLogo`
presigned URL. `/blob/school/{schoolId}/manifest.webmanifest` installs a
school as its own app. `/blob/school/{schoolId}/cadet.webmanifest` installs a
school's Cadet Portal as its own app (linked only on signed-in portal pages). School name, logo and registration number are public
school details; nothing else about a school belongs on `/blob/*`. Everything else, including student photos and documents, stays
on the authenticated `/api/blob/*` routes or short-lived presigned URLs from
permissioned procedures. Validate every query parameter against an explicit
allowlist (sizes, formats) so callers cannot request unbounded work.

# USING ENV

use env directly from `@campuspilot/env` never use `import.meta` or `process.env`

## Follow existing UI patterns

Read [Management UI patterns](apps/management/docs/ui-patterns.md) before changing
management screens. It records the reference implementations, layout and feedback
conventions, mobile verification expectations, and examination redesign decisions.

Before changing document generation, document history, school template settings,
the template marketplace, or template rendering, read the canonical
[Document system guide](docs/document-system.md). It records the route ownership,
permission boundaries, immutable template lifecycle, all-classroom timetable
invariant, safe Handlebars contract, and the checks required when extending a
document type or marketplace design.

Before implementing or redesigning a workflow, inspect existing screens with the
same behavior (admission/staff tables, classroom/admission workspaces and student
forms). Reuse shared controls and layouts instead of introducing local sizing or
navigation conventions. Buttons and inputs use their shared default sizes; do not
inject taller minimum heights or padding into feature wrappers. Tables should keep
the standard compact row density. Use TableSearchBar and TableFilterBar together
as on admission tables. Detail workspaces use left secondary navigation on desktop
and a section selector on mobile, with related actions in a top-right overflow
menu. Keep section links in secondary navigation rather than duplicating them in
action menus; examination menus contain lifecycle actions only. Breadcrumbs provide
back navigation; do not add feature-level back buttons.

Use app dialogs for confirmation, removal and unsaved-change navigation. Do not
call window.confirm, window.alert or window.prompt. Await navigation guard decisions
before switching school/session. Native beforeunload warnings are only for browser
reload/tab closure, where an asynchronous app dialog cannot prevent document exit.

For persistent, actionable setup warnings use AppShellAlert from
@campuspilot/components/app-shell, as in classroom-workspace.tsx. Supply a stable,
resource-scoped slug, type="warning", concise message, and a permission-gated
actionLabel/onAction (or actionHref). onAction receives closeDialog; close the
alert list before opening the relevant editor. Remove the registration when the
condition is resolved. Use adjacent field errors and transient save feedback for
validation/submission errors rather than adding them to the shell warning list.

## Staff sign-in

Before changing staff sign-in (phone-number sign-in, placeholder emails, the
`user.phone_number` / `email_is_placeholder` columns, inviting by phone,
issuing or setting staff passwords, the admin Users page, or anywhere a
user's email is shown), read [Staff sign-in](docs/staff-sign-in.md). Never
show `user.email` without `toStaffIdentity`: phone-only accounts hold a
placeholder there.

## Cadet Portal

Before changing anything cadet-related (the cadet Better Auth instance and
admission sign-in, `cadet_*` tables, `cadetRouter`/`cadetProcedure`, the cadet
MCP and its OAuth pages, `apps/cadet`, Cadet Portal password issuing in the
admission workflows, or the demo purge of cadet logins), read the canonical
[Cadet Portal guide](docs/cadet-portal.md). It records the two-instance auth
isolation, route order and CORS scoping, the admission-id-only identity model,
sign-in limits, issue/reset and revocation semantics, and the checklist for
adding a cadet procedure, screen or table.

## Notices

Before changing anything notice-related (the `notice` / `notice_class` tables,
the staff notice procedures in `routers/school/notice`, the Cadet notice
procedures, notice rendering and the custom-template guide, the `notice.*`
notification types and the notice PDF cache, the notice screens in
`apps/management` and `apps/cadet`, or the demo seed's notices), read the
canonical [Notices guide](docs/notices.md). It records the two independent
audience facts (`to_staff`, `cadet_scope`), the one-way draft to published
lifecycle and who may do what, the `notices` and `cadet` feature gates, the
rendering rules for plain and custom-template notices with their security
contract, the publish transaction and per-channel fan-out (including why a
delivery log is still filling right after publication), the cached PDF, the
Cadet visibility rule, and the checklist for extending notices.

## Question papers

Before changing anything question-paper-related (the `exam_question_paper_*`
tables, `routers/school/question-paper` and its MCP tools, a school's quick
papers (standalone papers of a real school, their `print_layout`, printed
heading snapshot, details and `school.standalone_paper.oversee`), the Question papers page and
its sidebar entry, the HTML fragment
rules and limits in `packages/question-paper`, the `question_paper_body`
sanitiser, the renderer and the `question_paper`
document type and its template slot, the durable generation job in
`workflows/question-paper`, chat image attachments and chat drafts, the Question
paper tab in `apps/management`, or the demo seed's question papers), read the
canonical [Question papers guide](docs/question-papers.md). It records the product
model (a paper per class, subject and mode of an exam, immutable versions with a
PDF each), the permission order and the `assistant` gate (there is no separate
flag), the data model, the HTML fragment vocabulary, the sanitiser profile and its
no-animation rule, the renderer contract with its deliberate CSP and
post-sanitiser insertion exceptions, the Word (.docx) download (made on a
version's first Word download by the Pandoc service, `PANDOC_URL`, stored as a
`docx` artifact, one way only), the job's steps and failure codes,
how chat attachments, tools, drafts and context pruning work, quick papers
(printed with the school's template, reached by their creator or with
`oversee`, none of a personal space's limits, only with AI), the Question
papers page, and the checklist for extending papers.

## Performance logs

Before adding timings to a code path, or when investigating a slow or stalled
API or worker, read [Performance logs](docs/performance-logs.md). It lists the
`http.request.end` timing fields, `perf.step.slow`, the `runtime.*` events
(event loop delay, CPU, container throttling) and every step name, and how to
read them apart (blocking code, CPU throttling, waiting on another service).

## Examination timetables

Before changing exam timetable drafting, publishing or withdrawal, the
`exam.timetable_published*` notifications, or the Cadet Portal timetable
screens, read [Examination timetable publishing](docs/exam-timetable-publishing.md).

## Website leads

Before changing the website's demo request form, the public `/public/leads/*`
routes and their proof-of-work, the `lead` table, the `LeadControl` /
`leadAlert` Restate services or the admin Demo requests page, read
[Website leads](docs/leads.md). A submission must only depend on the lead
insert; every side effect (the WhatsApp alert) is scheduled after commit and
may fail without failing the request.

## School Onboarding form

Before changing the website's standalone `/onboarding` page, the public
`/public/leads/school-onboarding` route, the `school_registration_request`
table, its S3 files or the admin School onboarding page, read
[School Onboarding form](docs/school-onboarding-form.md). The page is kept out
of search on purpose (robots meta, `robots.txt`, `X-Robots-Tag`) and is linked
from nowhere; uploads are bounded by type (sniffed from bytes) and size on the
server, and the voice note's ten minutes by the recorder.

## School feature flags and subscription tiers

Before adding a per-school feature or a tier, gating a procedure, page or
navigation item on a feature, or changing `school.tier`, `school_feature_flag`,
the feature catalogue (`packages/db/src/feature-flags`), `requireSchoolFeature`,
`RequireFeature` / `useSchoolFeature`, or the admin Plan and features editor,
read the canonical [School feature flags guide](docs/feature-flags.md). A
school has the features of its tier (Plus, Pro, Enterprise; the catalogue's
`tiers`), and a platform administrator can adjust one feature for one school
(`school_feature_flag.enabled`: on, off, or null to follow the tier; a missing
row follows the tier). The assistant is in no tier: an add-on switched on per
school. A flag says what a school has; it is never a substitute for a
permission. A feature may require others (`requires`); gates and screens
decide from `active`, never from the switch or the tier. Tests name the
features they need (`createTestSchool({ features: [...] })`, or a `tier`).

## School suspension

Before changing how a school is suspended, what a suspended school refuses, or
adding a way to change school data outside an oRPC procedure, read
[School suspension](docs/school-suspension.md). A suspended school
(`school.suspended_at`) is read-only: reads work, and `requireAuth` refuses
every procedure that is not an explicit read (`mcp.access`) for the input's
`schoolId`, `cadetProcedure` does the same for students, and upload routes
call `assertSchoolWritableByCaller`. Screens are not hidden; the refusal
(`SCHOOL_SUSPENDED`, `isSchoolSuspendedError`) is shown and a permanent
warning explains it. Keep `mcp.access` honest and name the school `schoolId`.
The same gate (`packages/api/src/school-access`) also refuses a school
without a plan (`SCHOOL_NO_PLAN`); one function decides from both facts.

## School billing

Before changing billing periods (`school_billing_period`: trial, paid and
complimentary periods), prices (`subscription_price`), invoices
(`school_invoice`), how a school's plan is decided, what a school without a
plan may do, the AI spend window, or how plans are shown in the apps, read
[School billing](docs/school-billing.md). Billing runs in 28-day periods
(`BILLING_PERIOD_DAYS`) from the day it starts, never calendar months. A
school's plan is the higher of its standing tier (`school.tier`, nullable,
never lapses) and its active period's tier (`resolveSchoolPlan`); a period is
active from `starts_at` until `ends_at` (or `ended_at` when cut short),
compared with `now()` at every read, so it ends without a job. Periods of one
school never overlap (EXCLUDE constraint). There is no grace: a school with
neither a standing tier nor an active period is read-only (`SCHOOL_NO_PLAN`).
The tables mirror a payment provider's Price and Invoice so one can be
connected later; amounts are integers in paise. Never compare tiers by hand
or store the plan.

## Self-service school creation

Before changing who may create a school, the `school_creation` ledger or
`user.school_creation_limit`, requests for more schools, the school owner
(`school.owner_user_id`) and its member guards, what a self-created school
starts with, or its guided setup (`school_onboarding`, `school.completeOnboarding`,
the Get started screens), read [Self-service school creation](docs/school-creation.md). The
allowance counts every school a person ever created (deleted or handed over
ones included), and the owner can never be removed or lose the principal role
through school procedures.

## Personal space

Before changing who gets a personal space (`school.kind = 'personal'`, the
Google sign-up hook, `personalSpace.*`), the school kind gate (`schoolKinds`
in procedure metadata, `requireAuth`, `assertSchoolKindServedByCaller`),
standalone question papers (`exam_question_paper.kind = 'standalone'`, their
details, procedures, plain shell and job branch; a real school's are its quick
papers, see the Question papers guide), the personal space screens
in `apps/management`, or before letting another procedure serve personal
spaces, read [Personal space](docs/personal-space.md). A procedure serves
real schools only unless it says otherwise, reads included; the eligibility
reads the linked Google account, never `email_verified`; a person gets one
space for good (`user.personal_space_created_at`); details are not
revisioned (every save overwrites them). A new way to store bytes or print a
PDF in a personal space must go through its limits
(`personal-space.limits.ts`, the guide's "Limits" table) inside the write's
transaction.

## Demo schools

Demo schools (`school.is_demo`) are provisioned by `DemoSchoolWorkflow`
(`packages/api/src/workflows/demo-school`, served by `apps/worker` through
Restate) from the seed data in its `seed/` folder. When you add or change a
feature a school user would see, check whether a fresh demo school shows it empty
or broken; if so, extend the seed JSON and the matching workflow step so a new
demo shows the feature with realistic data. Seed steps call the real
permission-checked procedures as the demo's principal, are idempotent on natural
keys or `demo:{jobId}:…` idempotency keys, and derive every date from the
workflow's journaled `asOf`. Never copy data from a real or imported school into
seed files. Any new school-owned table or S3 object must also be covered by
`purge_demo_school` and the demo purge workflow. If an email transport is
added, demo users (`user.demo_school_id` set) must be excluded explicitly.
Demo kick-offs (start, retry, purge) return immediately and hand work to
Restate through the outbox (`demo-school.outbox.ts`); never make an API request
wait for the worker. Every call to a worker service exposed on Restate
ingress (today `DemoSchoolControl`) must be signed with the worker-wide
`WORKER_CONTROL_SECRET` (`packages/api/src/workflows/control-auth.ts`); new
workflows stay ingress-private and are started through such a signed service. Progress is streamed with oRPC
event iterators and consumed in a TanStack Query function, not an effect.
See [Demo schools](docs/demo-school.md) for operations.
