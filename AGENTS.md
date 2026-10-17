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

The Shadcn components living in `@campuspilot/ui` are based on `Base UI` NOT Radix.

Base UI compound components must preserve their required context hierarchy. Never use grouped parts such as `DropdownMenuLabel`/`Menu.GroupLabel` outside `DropdownMenuGroup`/`Menu.Group`, or radio menu items outside `DropdownMenuRadioGroup`/`Menu.RadioGroup`. Check the underlying Base UI composition requirements whenever adding a compound component part.

Any reusable components / layouts should live in @campuspilot/components, in these components data are passed as props and mutation must sent via callbacks. There should be no api call within @campuspilot/components

For reusable compopnents / layouts that need api calls they should be placed in apps/-the app-/src(if src)/components folder

# USING ENV

use env directly from `@campuspilot/env` never use `import.meta` or `process.env`

## Follow existing UI patterns

Read [Management UI patterns](apps/management/docs/ui-patterns.md) before changing
management screens. It records the reference implementations, layout and feedback
conventions, mobile verification expectations, and examination redesign decisions.

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
