<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## UI conventions

Read [Management UI patterns](docs/ui-patterns.md) before implementing or redesigning
a screen. Inspect the linked admission/classroom references and shared components
before choosing layout, navigation, control sizes, tables or warning presentation.
The guide also records the examination-specific decisions and earlier approaches
that user feedback replaced.

For the Documents workspace, document history, template Settings pages, template
marketplace, or portable AI prompt flow, also read the canonical
[Document system guide](../../docs/document-system.md) and the local
[document component map](components/documents/README.md). Preserve the documented
operational/configuration/marketplace separation and the examination-wide
timetable export invariant.

### Portalled controls inside dialogs

Management dialogs and shared popups (Popover, Select, DropdownMenu and the
`Combobox` in `@campuspilot/ui`) are all Radix. Radix popups opened from inside a
`DialogContent` portal to `document.body` but register as nested Radix layers, so
pointer selection, focus and Escape work without a custom portal container. Do not
add Base UI popups: they are outside the Radix layer stack, and a dialog treats
clicks in them as outside clicks.

## Permission-gated UI

Use `RequirePermissions` from `@/components/require-permissions` everywhere a
user can initiate a mutation whose backend operation requires a permission.
This includes buttons, menu items, links, dialogs, and other interactive entry
points for create, update, delete, invite, activate, upload, or similar actions.

Also use `RequirePermissions` around read-only UI when the user must have a
permission to view or list that information. Do not render protected content or
navigation and wait for its data request to fail.

Pass the exact typed action and resource scope required by the corresponding
backend operation. The `permissions` prop accepts either one permission object
or an array of up to 100 permission objects; when an array is supplied, every
permission must be allowed. Use `fallback` when the design calls for an
alternative UI; otherwise rely on its default `null` fallback so pending,
failed, and denied checks remain hidden.

`RequirePermissions` controls frontend visibility only. Every protected API
operation must still enforce the same permission in backend middleware; never
treat the wrapper as the authorization boundary.

## Feature-gated UI

Use `RequireFeature` from `@/components/require-feature` around navigation,
actions and cards of a product area the school may not have (see the
[School feature flags guide](../../docs/feature-flags.md)), and `FeaturePage`
from `@/components/feature-unavailable` around its pages. Pending, failed and
disabled checks stay hidden. Use `useSchoolFeature(schoolId, feature)` when the
typed config or the loading state is needed. A feature gate does not replace a
permission gate: wrap permission-protected entry points with both.
