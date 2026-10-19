# Management document components

Read the canonical [document system guide](../../../../docs/document-system.md)
before editing this directory. It defines route ownership, lifecycle, permissions,
template safety, and cross-layer extension steps. This file is the local source map
for the management implementation.

## Boundaries

- Components in this directory may query and mutate through oRPC.
- Reusable presentation belongs in `@campuspilot/components/documents` and receives
  all data and mutations through props/callbacks.
- Forms and user-input state use TanStack Form with Zod. Do not introduce local
  `useState` form state or `useEffect` synchronization.
- `DocumentPermission` controls visibility and query mounting only. The backend is
  always the authorization boundary.

## Source map

| File | Responsibility |
| --- | --- |
| `document-workspace.tsx` | Create/history navigation, visual type selection, missing-template shell alert |
| `document-generator.tsx` | Type-specific source form, live preview, PDF creation |
| `document-history.tsx` | Unified session history, downloads, deletion |
| `document-templates.tsx` | Settings empty state, editor, sample preview, immutable revision save |
| `document-template-settings.tsx` | Settings permission boundary and scope adapter |
| `document-template-marketplace.tsx` | Catalog list, dedicated detail preview, import mutation |
| `template-prompt-editor.tsx` | Provider-neutral portable-prompt dialog |
| `document-export-link.tsx` | Contextual links from source-domain screens into Documents |
| `student-recipient-picker.tsx` | Searchable, paginated explicit-recipient selection that retains choices across searches |
| `document-common.tsx` | Shared app-specific permission, cache, loading, error, and dirty-navigation helpers |

Route files should remain thin adapters that parse route/search parameters and
pass an explicit school/session/document scope to these components.

Shared presentation and prompt utilities live in
`packages/components/src/documents`: `document-controls.tsx` contains the API-free
cards, fields, panels, notices, and sandboxed preview; `template-prompt.ts` builds
the provider-neutral brief; and `copy-text-button.tsx` owns clipboard feedback.

## State rules

- The active document type is local navigation/form state. The selected school
  template, catalog, and history are server state managed by TanStack Query.
- Use a component `key` when a selected type or immutable revision needs a clean
  form baseline. Do not synchronize a new baseline into an open dirty form.
- Preview HTML is derived from an explicit preview request. Editing source does not
  continuously send requests or overwrite the last successful preview.
- Cache invalidation after selecting/saving a template must refresh both the active
  template and any consumers that show template availability.
- A missing template is a persistent setup condition: register `AppShellAlert` and
  render a local explanation. It is not a toast or a reason to mount a selector in
  the generator.

## Layout rules

- The Documents workspace has exactly two sections: Create document and Document
  history.
- `DocumentKindCards` is the selector for document types in both Documents and the
  marketplace. Preserve accessible radiogroup semantics.
- The editor source panel is collapsible. Keep source before preview in DOM order so
  the stacked mobile layout follows the task sequence.
- Edit with AI and Marketplace remain peer header actions. The marketplace should
  not visually dominate source editing when a template is already selected.
- At desktop, source and preview share the workspace. At 390 px and 320 px they
  stack without feature-level horizontal overflow.

## Route mapping

API document types and Settings slugs are deliberately mapped rather than inferred:

```text
report_card -> examination
id_card     -> id-card
admit_card  -> admit-card
timetable   -> timetable
```

Keep the mapping exhaustive. If a document type is added, update the Settings
route, marketplace, alerts, export links, cards, labels, generator, and tests
together.

## Timetable invariant

Timetable exports always include all examination classrooms. Do not render a class
selector, pass a contextual `classId`, or add one to the source DTO. This differs
from report/admit card flows and is enforced again by the server.

## Manual verification

Check configured and missing-template states, all four document cards, unified
history, Settings editor/read-only/empty states, AI dialog, marketplace list/detail,
and permission-denied fallbacks. Inspect desktop, 390 px, and 320 px layouts. A
type-check is not a substitute for opening the real authenticated UI and inspecting
the rendered iframe.
