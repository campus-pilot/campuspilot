# Monorepo

We are using Turborepo with NPM (not pnpm) on Node 24.

## Apps

- `management` is the actual customer facing app for the customers
- `server` is the api server
- `web` is the website

## General

Be careful around making assumptions. If in doubt, ask the user for clarification.

Don't opt for band-aids without explicit consent. Always yield to the user before adding a workaround instead of a fix.

Never infer one fact from another that merely correlates with it today. Model each fact as its own explicit field, even when they currently coincide.

# Components

Componets must be small and should server exactly one purpose

no more than 5 level of nesting in the the html tags

You can keep multiple components in one file

In case a component has a lot of logic create a use\_\_\_ (hook) in same component file if theya re something not reusable

Prefer flex + gap instead of space-x/space-y if possible.

The Shadcn components living in `@campuspilot/ui` are based on `Base UI` NOT Radix.

Any reusable components / layouts should live in @campuspilot/components, in these components data are passed as props and mutation must sent via callbacks. There should be no api call within @campuspilot/components

For reusable compopnents / layouts that need api calls they should be placed in apps/-the app-/src(if src)/components folder
