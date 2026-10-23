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

Management dialogs currently use Radix focus and pointer containment, while shared
comboboxes use Base UI portals. When a Base UI popup is rendered inside a dialog,
give its portal a container ref whose element is inside `DialogContent`. A popup
left in the default `document.body` portal is outside the Radix modal boundary, so
pointer clicks can highlight an option without committing the selection. Keep this
rule with the reusable popup component when it always owns its container; otherwise
accept and forward an explicit container from the dialog-aware caller.

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
