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
| `finance-document-generator.tsx` | Posted billing-run and payment selection, finance preview, PDF creation |
| `document-history.tsx` | Unified session history, downloads, deletion |
| `document-templates.tsx` | Settings empty state, editor, sample preview, immutable revision save |
| `template-code-editor.tsx` | Dynamically loaded Monaco source editor and format action |
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
- Template-editor preview HTML is derived from a 650 ms debounced request or an
  explicit refresh. Request versioning prevents an older response from replacing
  the latest successful preview. Document-generation previews remain explicit.
- Cache invalidation after selecting/saving a template must refresh both the active
  template and any consumers that show template availability.
- A missing template is a persistent setup condition: register one domain-scoped
  `AppShellAlert` for each authorized academic/finance domain and render a local
  explanation. It is not a toast or a reason to mount a selector in the generator.

## Layout rules

- The Documents workspace has exactly two sections: Create document and Document
  history.
- Create document initially shows only the available type cards. It combines the
  four academic types with Bills and Receipts; account statements remain in the
  admission ledger. Activating a card opens its complete settings, preview,
  create, download, and history workflow in a wide responsive dialog. Contextual
  query parameters open that dialog with applicable source values preselected.
- The removed Billing Documents page is not a second home for bulk statements.
  Statement generation intentionally remains per admission in the admission
  ledger; do not add a global Statements card without a new product decision.
- `DocumentKindCards` is the type chooser in both Documents and the marketplace.
  It is a button group when cards launch workflows and a radiogroup when a selected
  `value` is supplied.
- The editor and preview share one border with no inter-panel padding. Their
  resizable divider and explicit editor control collapse the source panel. Keep
  source before preview in DOM order so the stacked mobile layout follows the task
  sequence.
- Monaco is client-only and uses HTML language services for Handlebars-containing
  markup. Preserve line numbers, wrapping, theme support, and the format action.
- Preview controls offer scrollable and A4-page modes. Report cards use portrait
  A4, timetables use landscape A4, ID cards are imposed on portrait A4, and
  half-A4 admit/finance revisions visibly occupy one of two vertical sheet slots
  without relaxing iframe sandboxing.
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
bill        -> bill
receipt     -> receipt
```

Keep the mapping exhaustive. If a document type is added, update the Settings
route, marketplace, alerts, export links, cards, labels, generator, and tests
together.

## Timetable invariant

Timetable exports always include all examination classrooms. Do not render a class
selector, pass a contextual `classId`, or add one to the source DTO. This differs
from report/admit card flows and is enforced again by the server.

## Manual verification

Check configured and missing-template states, all six document cards, unified
history, Settings editor/read-only/empty states, AI dialog, marketplace list/detail,
and permission-denied fallbacks. Inspect desktop, 390 px, and 320 px layouts. A
type-check is not a substitute for opening the real authenticated UI and inspecting
the rendered iframe.
