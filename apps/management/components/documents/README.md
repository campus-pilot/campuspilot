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
- Document generators open in a Radix modal. The student-recipient combobox is
  built on the Radix `Combobox` from `@campuspilot/ui`, whose Radix Popover portal
  is a nested Radix layer, so it stays interactive inside the modal without a
  custom portal container.

## Source map

| File | Responsibility |
| --- | --- |
| `document-workspace.tsx` | Create/history navigation, visual type selection, missing-template shell alert |
| `document-generator.tsx` | Type-specific source form, live preview, PDF creation |
| `finance-document-generator.tsx` | The Bills creator's tabs (By date, Billing cycles), posted billing-run and payment selection, finance preview, PDF creation |
| `bill-due.tsx` | Bill due: the By date tab (date, whole session / class / chosen students) and the admission ledger's Bill dialog; always previews before creating (review hash) |
| `finance-preview-panel.tsx` | The finance generators' shared preview and create panel with job progress and download |
| `template-save-model.ts` | `initialSaveFootprint`: the Save dialog (in `template-workspace.tsx`) asks for the name and, for two-up types, the footprint, which starts unselected when the HTML differs from the loaded revision |
| `document-history.tsx` | Unified session history, downloads, deletion |
| `document-templates.tsx` | Settings empty state, read-only PDF preview, and the editor's entry (keyed by revision) |
| `template-workspace.tsx` | The template builder: header row, resizable AI/Code pane, PDF preview, working copy, assistant drafts, revision restore |
| `template-assistant.tsx` | The builder's chat (`?chat=`), its seed, suggestions and drafts |
| `template-pdf-preview.tsx` | A template source as its PDF (`previewDocumentTemplatePdf`, manage only), cached per source; a saved revision by id (`previewDocumentTemplateRevisionPdf`); a marketplace design by slug (`previewMarketplaceTemplatePdf`); each sends the sidebar's selected session (`sessionId`), whose data the server previews with (docs/document-system.md "Preview context") |
| `template-revisions.tsx` | Revision select (`?revision=`), All revisions dialog, read-only revision with Restore |
| `template-code-editor.tsx` | Dynamically loaded Monaco source editor and format action |
| `document-template-settings.tsx` | Settings permission boundary and scope adapter |
| `document-template-marketplace.tsx` | The marketplace's pages: root and type redirects, a design's PDF, full-screen preview dialog, import mutation |
| `marketplace-model.ts` | The marketplace's addresses (`/templates/:type/:slug?preview=1`), the former query address, which types the school has and which design a type opens |
| `../marketplace-navigation.tsx` | The marketplace's own sidebar (Back to settings, types, the open type's designs) |
| `marketplace-breadcrumbs.ts` | Which paths are the marketplace's and its trail (Template marketplace › type › design) |
| `template-permissions.ts` | The one decision of which permission reads or manages a type's template (finance types have their own) |
| `template-prompt-editor.tsx` | Provider-neutral portable-prompt dialog |
| `document-export-link.tsx` | Contextual links from source-domain screens into Documents |
| `student-recipient-picker.tsx` | Searchable, paginated explicit-recipient selection that retains choices across searches |
| `document-common.tsx` | Shared app-specific permission, cache, loading, error, and dirty-navigation helpers |
| `document-job.tsx` | `useDocumentJob` (polls a generation job with `refetchInterval` until it ends) and `DocumentJobTracker` (progress, then the caller's ready actions) |

Route files should remain thin adapters that parse route/search parameters and
pass an explicit school/session/document scope to these components.

Shared presentation and prompt utilities live in
`packages/components/src/documents`: `document-controls.tsx` contains the API-free
cards, fields, panels, notices, and sandboxed preview; `template-prompt.ts` builds
the provider-neutral brief; and `copy-text-button.tsx` owns clipboard feedback.

`DocumentPreview` (in `document-controls.tsx`) is the only place server-rendered
document HTML is shown: an iframe with an **empty** `sandbox`. Its options:

| Prop | Meaning |
| --- | --- |
| `html` | Sanitized HTML from a preview procedure; absent while there is nothing to render. |
| `label` | The caption and the frame's accessible title (default "Document preview"). |
| `sample` | Shows the "Sample data" badge for previews rendered with synthetic data. |
| `placeholder` | The hint under "Your preview will appear here." while `html` is absent. The default speaks of choosing a template; callers with another flow (the notice page: "Rendering the notice…") pass their own. |
| `fitPageWidth` | Lays the document out at portrait A4 width (794 CSS px) and scales it down to a narrower container with CSS only (container query units and `tan(atan2())`; no measuring script, state or effect), so a phone shows the page as printed instead of re-wrapping it. Wide containers are unaffected. Used by the notice pages in management and by the Cadet Portal's custom-template notices. Leave it off for templates that are edited at their natural width. |

## State rules

- The active document type is local navigation/form state. The selected school
  template, catalog, and history are server state managed by TanStack Query.
- Use a component `key` when a selected type or immutable revision needs a clean
  form baseline. Do not synchronize a new baseline into an open dirty form.
- "Create PDF" starts a generation job; the dialog keeps the returned job in its
  form and `DocumentJobTracker` polls it (no effect). The shared
  `DocumentJobProgress` (`packages/components/src/documents/document-job-progress.tsx`)
  presents it. History polls its job list and PDF list while a job is active.
- The template editor's preview is a PDF query keyed by a hash of the source: typing
  re-renders after a 900 ms pause (or *Refresh preview now*), an assistant draft,
  footprint or print size at once, and the previous pages stay while the next one
  converts and under a failure. A preview is retried only when the server said the
  person has several in flight (TOO_MANY_REQUESTS). Document-generation previews
  remain explicit HTML.
- Read-only users and the revision view preview a saved revision by its id, never
  its source (`previewDocumentTemplatePdf` needs the manage permission).
- A pdf.js document is held by the query cache (`release`) and by every `PdfPages`
  that shows it (`retain`), and is freed when both are done; all documents share one
  pdf.js worker (`loadPdf`). Preview queries keep a short `gcTime`.
- The template on screen is derived (`editorSourceOf`) from the working copy and the
  assistant's newest draft; no effect copies one into the other. A draft that
  arrives after the person changed the template since sending is held, not shown,
  and offered as *Replace my edits*.
- View state in the address (`?chat=`, `?revision=`, the marketplace's
  `?preview=1`) is rewritten with `replaceSearchParam` / the History API,
  never `router.replace`, which would refetch the route's server payload. The
  marketplace's full-screen preview is pushed (`pushState`, marked in
  `history.state`) so Back closes it. The marketplace's type and design are
  path segments, reached through its sidebar like any other page.
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
  admission ledger. The Bills dialog has two tabs, **By date** (default: Bills
  due) and **Billing cycles** (the run picker); a Bill due has no card of its own.
  The admission ledger offers a single admission's Bill due (**Bill**) next to
  **Payment**. Activating a card opens its complete settings, preview,
  create, download, and history workflow in a wide responsive dialog. Contextual
  query parameters open that dialog with applicable source values preselected.
- The removed Billing Documents page is not a second home for bulk statements.
  Statement generation intentionally remains per admission in the admission
  ledger; do not add a global Statements card without a new product decision.
- `DocumentKindCards` is the type chooser in Documents. It is a button group when
  cards launch workflows and a radiogroup when a selected `value` is supplied.
- The marketplace is a section of its own, like Settings: its sidebar lists the
  school's document types (Back to settings first), and only the open type is
  expanded with its designs. The page shows one design: a compact header, its
  summary and actions, then its PDF in a frame most of the screen tall. Only that
  design is converted. *Preview* opens it full screen (`PreviewDialogContent` size
  `full`) with Use template beside the title. The type, design and open preview are
  in the address, not local state. No tab rows.
- The builder follows the question paper studio: it fills the window from md up
  (`APP_SHELL_FILL_HEIGHT_MD_CLASS`), the editing pane (AI | Code tabs) and the
  preview share a resizable divider; *Hide editor* (or dragging it all the way) folds
  the pane to a rail (`EditRail`) that opens it again.
  On a phone a *Preview | AI | Code* switch shows one section at a time, all mounted.
- Monaco is client-only and uses HTML language services for Handlebars-containing
  markup. Preserve line numbers, wrapping, theme support, and the format action.
- The preview is the printed PDF (`PdfPreview`): report cards portrait A4,
  timetables landscape A4, ID cards imposed on portrait A4, half-A4 admit/finance
  revisions in one of two vertical slots, exactly as generated.
- *Edit with AI* (only for someone without the assistant) and Marketplace remain
  peer header actions. Assistant users reach the chat through the *AI* tab, or on a
  phone the *Ask for a change* bar fixed to the bottom of the screen. The marketplace should not visually dominate source
  editing when a template is already selected.
- At 390 px and 320 px the header wraps and sections switch without feature-level
  horizontal overflow.

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

Timetable exports always include all classes taking part in the examination. Do
not render a class selector, pass a contextual `classId`, or add one to the source
DTO. This differs from report/admit card flows and is enforced again by the server.

## Examination class picker

Admit cards and report cards are chosen examination first, then class. The class
picker lists only the classes taking part in the chosen examination
(`getExamContext`), so a class excluded from it is never offered; choosing another
examination clears the class and the chosen students. ID cards are not tied to an
examination and list every class of the school (`listClasses`). The server refuses
a `classId` that does not take part either way.

## Manual verification

Check configured and missing-template states, all six document cards, unified
history, Settings editor/read-only/empty states, AI dialog, marketplace sidebar/full-screen preview,
and permission-denied fallbacks. Inspect desktop, 390 px, and 320 px layouts. A
type-check is not a substitute for opening the real authenticated UI and inspecting
the rendered iframe.
