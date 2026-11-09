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
school as its own app. School name, logo and registration number are public
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

## Cadet Portal

Before changing anything cadet-related (the cadet Better Auth instance and
admission sign-in, `cadet_*` tables, `cadetRouter`/`cadetProcedure`, the cadet
MCP and its OAuth pages, `apps/cadet`, Cadet Portal password issuing in the
admission workflows, or the demo purge of cadet logins), read the canonical
[Cadet Portal guide](docs/cadet-portal.md). It records the two-instance auth
isolation, route order and CORS scoping, the admission-id-only identity model,
sign-in limits, issue/reset and revocation semantics, and the checklist for
adding a cadet procedure, screen or table.

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
