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
