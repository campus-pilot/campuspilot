# Document system

This guide is the canonical cross-layer reference for generated school documents,
school-owned templates, and the template marketplace. Read it before changing any
route, component, DTO, permission, storage behavior, template, or rendering rule in
this feature.

The lower-level backend guarantees are documented in
[`packages/api/src/routers/school/document/README.md`](../packages/api/src/routers/school/document/README.md).
The local management component map is documented in
[`apps/management/components/documents/README.md`](../apps/management/components/documents/README.md).

## Product model and ownership

The feature has three deliberately separate surfaces:

| Surface | Scope | Owns | Must not own |
| --- | --- | --- | --- |
| Documents workspace | School session | Creating PDFs and viewing the session's document history | Choosing, importing, or editing templates |
| Template settings | School | The active school template and its custom Handlebars source | Browsing a gallery alongside the editor |
| Template marketplace | School plus selected document type | Discovering, previewing, and importing server-owned starting designs | Editing school source or creating PDFs |

This separation keeps an operational task focused and prevents a template choice
from looking like a per-document option. A selected template is school-wide and is
reused across academic sessions until an authorized user selects or saves another
revision.

Do not infer one surface's state from another fact. In particular:

- a school may have a template without having generated a PDF;
- a document may remain downloadable after the active template changes;
- permission to read history does not imply permission to generate or manage a
  template;
- an examination timetable may exist without a template, and a template may exist
  without a timetable;
- a session or examination state never implies that a template has been selected.

## Routes and navigation

| Route | Behavior |
| --- | --- |
| `/school/:schoolId/sessions/:sessionId/documents` | Document-type cards that open the selected generator in a dialog |
| `/school/:schoolId/sessions/:sessionId/documents/history` | Unified history for every supported document type in the session |
| `/school/:schoolId/sessions/:sessionId/documents/templates` | Compatibility redirect to the corresponding school template setting |
| `/school/:schoolId/settings/templates/examination` | Report-card template editor |
| `/school/:schoolId/settings/templates/id-card` | Student-ID template editor |
| `/school/:schoolId/settings/templates/admit-card` | Admit-card template editor |
| `/school/:schoolId/settings/templates/timetable` | Examination-wide timetable template editor |
| `/school/:schoolId/settings/templates/bill` | Finance bill template editor |
| `/school/:schoolId/settings/templates/receipt` | Payment/refund receipt template editor |
| `/school/:schoolId/settings/templates/statement` | Admission account-statement template editor |
| `/school/:schoolId/settings/templates/notice` | Notice template editor (schools with the `notices` feature only) |
| `/school/:schoolId/sessions/:sessionId/billing/documents` | Compatibility redirect to session-wide document history |
| `/school/:schoolId/marketplace/templates?type=:documentType&template=:slug&preview=1` | Marketplace on one document type tab and one design (each parameter optional); `preview=1` opens that design's full-screen preview |
| `/school/:schoolId/marketplace/templates/:documentType/:slug` | Former dedicated preview page: redirects to the marketplace with that type, design and the preview open |

The marketplace is intentionally school-scoped rather than session-scoped. The
settings slugs are existing human-facing configuration names and are not required
to equal the API's `DocumentType` values. Keep their mapping explicit.

Breadcrumbs provide back navigation. Do not add local back buttons. Documents uses
the standard desktop secondary navigation and mobile section selector; it exposes
only Create document and Document history.

## User journeys

### Create a document

1. The user opens the session Documents workspace.
2. `DocumentKindCards` presents report card, student ID, admit card, timetable,
   bill, and receipt choices as visual cards rather than a dropdown. Account
   statements remain contextual to an admission ledger. The page shows only these
   cards until the user chooses one.
3. The chosen card opens a wide, mobile-safe dialog containing the complete
   settings, optional preview, one-click PDF download, and history workflow. A
   contextual URL opens the corresponding dialog with its examination, class, or
   student preselected.
4. The dialog requests the active school template and the independent source-domain
   data it needs only after the type-specific permission gate succeeds.
5. If the template is missing, generation stays unavailable. An inline explanation
   describes the dependency, while the shell warning provides the authorized path
   to Settings.
6. Preview validates the whole selection and renders a sample (the first two
   printed sheets) without writing anything. It is optional: nothing waits for
   it, because generation validates the same choices again on the server.
7. "Create PDF" starts a generation job (see "Generation jobs") and returns at
   once. The dialog shows the job's progress (polled) and, when the PDF is
   ready, a fresh authorized download (for members who may download documents)
   and a link to unified history. Closing the dialog or leaving the page does
   not cancel the job; History lists it while it runs and, with its message,
   if it fails.

The bill dialog searches and pages posted billing runs, displays the run period,
billing date, bill count, amount, and state, and rejects empty or non-posted runs.
Fully reversed runs remain selectable because bill documents reproduce immutable
original postings; the reversal state remains visible. A run source always
previews and generates the complete immutable run by
`billRunId`. The receipt dialog keeps non-reversed payment selections across search
pages up to the 1,500-source API limit. Both preserve the current session in their
source; previewing before creation is optional, as for academic documents. The
global receipt source carries an explicit payment-only eligibility policy; preview
and generation both recheck in the database transaction that every selected
payment still has no reversal, so a stale browser selection cannot create a
valid-looking receipt after reversal.

Removing Billing's duplicate Documents section intentionally removes its old bulk
statement picker. Statements are account-cutoff documents and remain available
per admission from the admission ledger; they are not a session-global card.

Contextual links from examinations may preselect an examination, class, or student
for applicable document types. Those query values are conveniences, not authority;
the backend revalidates every school, session, class, examination, and student
relationship. Closing a context-opened dialog replaces that URL with the clean
Documents create route so a refresh or later card launch cannot restore stale
source values.

### Resolve missing templates

`DocumentTemplateAlerts` checks only the academic and finance template domains the
user may read. While any visible type is missing, it registers one stable alert per
authorized domain with the slug
`school/:schoolId/documents/:domain-templates-missing`.

Each warning is visible to users who can access that template domain. Its action is rendered
only for users with the matching academic or finance template-management action.
The action leads to the first
missing template's Settings page. Registering the permission-gated version with
the same domain slug replaces the message-only registration rather than creating
two copies for that domain. Remove the registration by no longer rendering it
after every type in that domain is configured.

Do not replace this with a toast, repeated body banner, or template chooser inside
the generator.

### Browse and import a marketplace template

1. The marketplace shows the school's document types as a row of line tabs that
   scrolls sideways when they do not fit (`ScrollableTabsList`, as in the
   examination workspace). Only types the school has are offered (the `notices`
   and `assistant` features add Notices and Question papers; the rest belong to
   student management); the tabs wait for those flags rather than switching once
   they arrive. A requested type the school does not have opens the first one. When
   the flags cannot be read the page says so with *Retry* (`FeatureUnknown`), never
   that there are no templates; a school with no such type gets a notice saying where
   templates come from.
2. Under the type, its designs are a second, pill-style scrollable tab row; the
   design the school uses now carries a check (and "(in use)" for assistive
   technology). Under that the selected design shows its name, paper, description
   and actions, then **its PDF with sample data** (`PdfPreview`, the builder's
   viewer) in a frame most of the screen tall. The design shown is the requested
   one, else the one the school uses when it was imported from the catalog and is
   still listed (`artifact.marketplaceSlug`), else the first. A requested design
   the catalog no longer lists says so and shows that fallback. The design tabs
   activate on Enter or a click, not on focus (`activationMode="manual"`), so
   arrowing along the row converts nothing.
3. Only the open type's catalog is read and only the selected design is converted
   (Radix mounts only the active tab's content), never a page of thumbnails. See
   "Marketplace PDF previews" below for the cost guard.
4. *Preview* opens the design full screen (the whole screen on a phone, all but a
   small margin on a larger one; `PreviewDialogContent` size `full`, the dialog
   shell the question paper chat uses for drafts). It shows the page's cached
   conversion, scrolls page by page, and offers the same actions (*Use template*,
   *Open current template*, and *Preview as* for a Notice design) beside its title.
   *Preview* is the dialog's `DialogTrigger`, so focus returns to it on close.
5. Type, design and the open preview live in the address (`marketplace-model.ts`:
   `?type=&template=&preview=1`), so a reload or a shared link restores the view. The
   address is rewritten with the History API, never `router.*` (the route is an
   async server component: a router navigation refetches its payload on every tab,
   and the tabs and the dialog waited for it). Picking a type or design replaces the
   entry (`replaceState`); opening the preview pushes one, marked in `history.state`,
   so Back closes the full-screen preview instead of leaving the marketplace. Closing
   the dialog goes back past that entry, or, when the preview was opened by a link,
   replaces the entry without `preview`. A design and the preview are only honoured
   with the type they were asked with, and the dialog opens only for the design asked
   for, never for a fallback. The `template` value is any slug the API would accept
   (1 to 100 characters), so an old link to a delisted design is told apart from no
   request. The former `/:documentType/:slug` page redirects to this address with the
   preview open.
6. Use template sends the catalog slug and `expectedRevisionId`.
7. The server copies the catalog source to a new immutable, school-owned S3 object,
   creates an artifact row, and atomically selects that revision.
8. A stale `expectedRevisionId` returns `CONFLICT`; the client must reload instead
   of overwriting a change it has not seen. The value to send is the `revisionId`
   that `getActiveDocumentTemplate` (and every save or selection) returns, or
   `null` only when no revision is selected. It is not the artifact's `sha256` and
   not `templateRevisionId`, which only generated PDFs carry. The `CONFLICT`
   message names the revision selected now (`selected revision: art_…` or
   `none`), because MCP and assistant callers receive only the code and message
   and otherwise retry with the same wrong value.

Never treat marketplace source as the active school template directly. Importing a
copy is what provides school ownership, provenance, and stable historical output.

### Edit a school template

When no revision is selected, Settings shows a focused blank state with one Browse
marketplace action. It does not render a disabled or empty source editor.

When a revision exists, an authorized editor sees the **template builder**, laid out
like the question paper studio (`TemplateEditor` in `template-workspace.tsx`):

- From md up it fills the window under the app's header
  (`APP_SHELL_FILL_HEIGHT_MD_CLASS`, the studio's class): one header row, then the
  editing pane on the left and the preview on the right, each scrolling inside
  itself, so the page never scrolls. The split is resizable (`ResizablePanelGroup`
  from `@campuspilot/ui/components/resizable`, on `react-resizable-panels`) and the
  editing pane folds away (*Hide editor*; *Show editor* in the preview's strip brings
  it back). On a phone it is an ordinary page with a section switch (*Preview | AI |
  Code*, the preview first) and one section at a time; every section stays mounted,
  so switching loses nothing.
- The **header row**: the template's title and state (*Saved*, *Unsaved changes*,
  or *Draft n from the assistant, not saved*), the revision select and *All
  revisions* (see "Revision history"), the AI action, *Marketplace*, *Reload saved*
  and *Save template*. The AI action is *Ask for edit* (a sparkle) for someone who may
  use the assistant (the question paper's gate, `useAssistantGate`: the school's
  `assistant` feature and the user's assistant role; there is no other flag), and
  the portable *Edit with AI* dialog for everyone else, unchanged. While the gate is
  still loading neither is shown. *Ask for edit* opens the AI tab, unfolding the pane.
- The **editing pane** has two tabs, *AI* (the assistant's chat, only for those who
  may use it) and *Code*: the template name, for admit cards, bills, receipts and
  statements an explicit paper footprint (half A4, two documents per physical sheet,
  or full A4, one per sheet), the Monaco Handlebars/HTML code editor with formatting,
  syntax highlighting, line numbers, wrapping and theme support, and a collapsible
  variable reference (from `learn_document_template_editing`). Both tabs stay
  mounted.
- The **preview** is the template rendered with synthetic data **as the PDF it
  prints as**, drawn page by page with pdf.js: the same `PdfPages` viewer, page
  chrome, scrolling and skeleton as a question paper's saved version, through the
  reusable `PdfPreview` (`packages/components/src/documents/pdf-preview.tsx`). For a
  Notice design the strip offers *Preview as* (a full-A4 or half-A4 notice; a Notice
  design has no footprint, each notice chooses its size, and the choice is never
  saved; the marketplace offers the same choice for its Notice designs).

Draft name and source remain local until Save. Typing re-renders the preview after a
900 ms pause (each preview is one Gotenberg conversion), and the strip offers *Refresh
preview now* meanwhile; a footprint or print-size change and a draft from the
assistant render at once. Each source is converted once and cached by a hash of it
(`useTemplatePdf`); the previous pages stay on screen with an *Updating preview…* badge
while the next one converts, and a failed render says why over the last good pages
(the renderer's own reason for a template it refuses, or a limit, see "Preview
limits") with *Try again*. A preview is asked again by itself only when the server
said the person has several previews in flight; a failure or a timeout is never
repeated behind their back. Preview never saves or selects a revision. Saving creates
a new immutable object and makes it active. A keyed editor adopts the newly selected
revision only after the query cache refreshes. *Reload saved* discards the working
copy (and any shown assistant draft) after the app's dirty dialog. Dirty navigation
uses the application dialog and browser `beforeunload` fallback; it must not use
`window.confirm`.

The code editor is dynamically loaded in a client-only boundary because Monaco
depends on browser APIs and is unnecessary for empty or read-only states.

Read-only users see the selected template's PDF preview (with *Preview as* for a
Notice design) but no source mutation controls. Their preview is asked for by the
selected revision's id (`previewDocumentTemplateRevisionPdf`), never by its source:
converting source of one's own needs the manage permission.

### The PDF preview (`previewDocumentTemplatePdf`, `previewDocumentTemplateRevisionPdf`)

`previewDocumentTemplatePdf` renders unsaved source exactly as `previewDocumentTemplate`
does (the same synthetic context, sanitising and CSP) and converts it with the same
Gotenberg call as a generated document of the type (`previewTemplatePdf` in
`document.template-source.ts`); a half-A4 Notice preview is imposed two copies per A4
sheet like a published half notice. It stores nothing and returns the bytes base64 in
its JSON result (a template preview is a few synthetic pages under a page cap). It has
the template **manage** gate (`MANAGE_DOCUMENT_TEMPLATES` or the finance manage
action, then the type's feature): it converts source the caller wrote, which only
someone who may change the template needs. `previewDocumentTemplateRevisionPdf`
previews a saved revision by its id (the input of `getDocumentTemplateRevision`): the
server reads the source, so it has the template **read** gate; it serves the read-only
template page and the builder's revision view. Both are `hidden` from MCP: each call
costs a conversion, so it is a person's preview only (the assistant has the HTML
preview and the draft check). The HTML `previewDocumentTemplate` stays for MCP.

### Preview limits

Every template PDF preview (the two above and the marketplace's) is one Chromium
conversion of source someone chose, so each is bounded on its own
(`TEMPLATE_PREVIEW_LIMITS` in `document.template-source.ts`). The render budget also
holds for the HTML previews that share the render (`previewDocumentTemplate`,
`getMarketplaceTemplate`):

| Bound | Preview | A generated document |
| --- | --- | --- |
| Render budget (`maxOutputChars`) | 2,000,000 (the Notice and Question paper template budget) | 25,000,000 |
| Conversion timeout | 20 seconds, then BAD_REQUEST `PREVIEW_TIMEOUT_MESSAGE` (not a 500) | 120 seconds (question paper 60) |
| Pages | A cap per type; the converter prints one page more and the preview is refused with a sentence, never cut | Question papers only (40) |

The page caps follow what the single synthetic sample prints:

| Type | Cap | Why |
| --- | --- | --- |
| Report card, ID card, admit card, bill, receipt, statement | 4 | One document, which the print wrapper puts on exactly one sheet (8 ID cards or 2 half documents to a sheet); the rest is room for a design whose CSS lets content spill past the sheet |
| Timetable | 8 | One landscape document holding the grid of every classroom of the exam (the all-classroom invariant: never split per class), which a design may paginate over several sheets |
| Notice | 6 | Notices flow; the sample prints on one full page or one to two half pages (counted before two half pages are put on a sheet) |
| Question paper | 40 | The example paper flows like a real one, so the paper cap (`QUESTION_PAPER_LIMITS.pdfPages`) applies as it does to every paper |

Previews of source and of revisions also take one of the person's **conversion slots**
(`withPreviewConversionSlot`, `document.preview-slots.ts`): at most
`PREVIEW_CONVERSIONS_PER_USER` (3) in flight per user across every server replica, as
a sorted set per user in Redis taken and checked atomically (a Lua script); one more is
refused with TOO_MANY_REQUESTS, which the editor asks again after a moment. A slot is
freed when its conversion ends however it ends (a cancelled query aborts the request,
and the server aborts its conversion), and a slot a crashed replica never freed
expires after `PREVIEW_SLOT_TTL_MS` (45 seconds, longer than a preview can run). Three
because the editor has one preview in flight at a time, but a cancelled one frees its
slot only when the abort reaches the server, and a second tab or a revision beside the
editor adds one. When Redis cannot be reached the conversion runs without a slot
(logged as `doc.preview.slot.unavailable`): the per-conversion bounds still hold. The
marketplace takes no slot: it converts each catalog design once per process, so what
it can make anyone convert is bounded by the catalog.

What the slots do not bound is the converter as a whole: many people (or many
accounts) previewing at once can still queue conversions in Gotenberg. That would
need a converter-wide queue or a per-school budget, which do not exist yet.

### Marketplace PDF previews (`previewMarketplaceTemplatePdf`)

The marketplace previews a design by its slug (`previewMarketplaceTemplatePdf`, the
input of `getMarketplaceTemplate`), so the browser never downloads a design's source
and HTML just to look at it. The render and conversion are those of
`previewDocumentTemplatePdf`, within the same limits; the gate is the same template
read gate as `getMarketplaceTemplate`; it is `hidden` from MCP and the assistant; it
stores nothing. A design converts to the same PDF for the life of a server process (the
catalog ships with the code, and the sample data is fixed), so
`previewMarketplaceTemplatePdf` in `document.template-source.ts` converts and encodes
each design, and each print size of a Notice design, once per process and shares a
conversion in flight; a failed one is forgotten so the next preview tries again. The
map is bounded by the catalog. In the browser `useMarketplaceTemplatePdf` never
refetches a design it holds (`staleTime: Infinity`) and, unlike the editor, keeps no
previous data, so another design's pages never stand in for the one selected: a
design not yet converted shows the page-shaped skeleton (and a failure shows no other
design's pages either). The page and the full-screen dialog share one query.

`PdfPreview` is presentational and API-free so the marketplace can reuse it: it takes
a `LoadedPdf` (from `loadPdf(bytes, signal)`), a `label`, the skeleton's `orientation`,
an `updating` flag, an `error` sentence with `onRetry`, and takes its container's height
(a pane, a tab or a full-screen dialog). The caller owns fetching the document.

A `LoadedPdf` has two holders, each its own fact: its owner (the app's query cache)
calls `release` once when it drops the query, and every `PdfPages` showing it holds it
with `retain` (in its ref callback) while it is mounted with it. pdf.js frees the
document only when both are done, so a document still on screen (a previous render kept
while the next one converts, or the last good one under a failure) is never destroyed
under the viewer, whatever the query's `gcTime`. The template preview queries use a
short `gcTime` (30 seconds), so typing does not pile up parsed PDFs. Every document
parses in one pdf.js worker shared by the page (`loadPdf`), and a document finished
after its query was cancelled is freed by `loadPdf` itself.

### Revision history

Every save and every marketplace import is an immutable revision; the builder lets the
user look at earlier ones, as the question paper studio does with versions:

- The header's **revision select** lists *Working copy* (*Working copy (unsaved)* while
  dirty) and the 20 newest revisions as *Revision n*, the one the school uses marked
  *(in use)*; *All revisions* opens a dialog with every revision, a page at a time
  (*Show older*), each with its name, how it was saved (in the editor or imported from
  the marketplace), when, by whom, and *Preview*.
- The revision shown lives in the address (`?revision=<id>`, like the studio's
  `?version=n`), rewritten in place with `replaceState` (`replaceSearchParam`), so
  looking through revisions is not a trail for Back and nothing is refetched. The
  preview pane then shows that revision read-only: a notice (*Revision n · read-only*,
  its name and details) above its PDF (by its id, `previewDocumentTemplateRevisionPdf`),
  with *Back to working copy* and **Restore**. The working copy and the chat stay as
  they are. While the revision loads, or when it cannot be read (an old or mistyped
  link), *Back to working copy* is offered all the same, and the select names it
  (*Loading revision…* / *Revision not found*) so choosing *Working copy* leaves it.
- *Restore* loads the revision's source and footprint into the working copy; the name
  stays the editor's. Nothing is saved: the user saves it like any edit, which creates
  a new revision; no revision is overwritten or reselected. When the working copy has
  unsaved changes, the app's confirmation dialog asks first (never `window.confirm`).
- `revisionNo` numbers a type's revisions oldest first by creation; it is a label. The
  id is `revisionId`. *In use* is the selection pointer's own fact, not "the newest".
- Procedures: `listDocumentTemplateRevisions` (paged, newest first) and
  `getDocumentTemplateRevision` (one revision with its source; NOT_FOUND for another
  school's or type's id, or a PDF's). Both have exactly the template read gate of
  `getActiveDocumentTemplate` (`READ_DOCUMENT_TEMPLATES` or the finance read action,
  then the type's feature). They are advanced MCP reads in `documents`.

### Edit with an external AI application

For a user who may not use the in-app assistant, the AI helper is intentionally
provider-neutral:

1. The user enters an instruction in a dialog.
2. CampusPilot constructs a prompt containing the print constraints, variable
   reference, safety rules, and current unsaved source.
3. The user copies the instructions, source, or combined prompt.
4. The user works in an external tool and pastes the result back into the editor.
5. CampusPilot previews and saves only through the normal explicit actions.

No AI provider, SDK, key, endpoint, or server request is involved. Never imply that
CampusPilot sent the school's template or instructions to another service. The
printing rules in the brief are the shared ones the in-app assistant reads
(`templateRenderingContract` in `@campuspilot/assistant-contract/template-editing`),
so the two never describe different contracts.

### Edit with the assistant

For a user who may use the assistant (`useAssistantGate`), the builder's AI tab is the
ordinary assistant (`AssistantChat`, surface `panel`); every rule of
[In-app assistant](assistant.md) applies (access, the monthly limit, cost rows, the
tool policy). What the template editor adds:

- **The conversation.** It is the user's own and private (no sharing, no migration),
  seeded on its first message with `{ kind: 'document_template', documentType }`. It
  lives in the editor's address (`?chat=<id>`, rewritten in place with `replaceState`),
  so a reload or a save (which remounts the editor on the new revision) continues in
  it; *New chat* (in the pane's header, and beside the section switch on a phone)
  starts another. A draft shown from the old chat stays on screen as the unsaved
  working copy (`adoptShownSource`), so starting a new chat never drops it silently.
  The tool and phone section on screen are kept above the editor's key, so a save
  does not reset them. Decision: a conversation is per editing session, not stored per
  template or revision: a template has one school-wide selection that several people
  edit, and a private chat tied to it would either be shared (a migration and the
  question paper's whole sharing model) or invisible to colleagues. The assistant's
  own page keeps the user's history.
- **What the model reads.** `learn_document_template_editing` (the shared rendering
  contract, how drafts reach the editor, `DOCUMENT_CONTEXT_HELP`). The editor's
  current source goes with a message as `editorSource` whenever the conversation has
  not seen it yet (always on the first message; then whenever it differs from the last
  source sent or the assistant's own latest ready draft, which covers hand edits in the
  Code tab), so the model edits exactly what the user sees and never a template cut by
  a tool's result limit. It is stored on the user message and fenced as data in the
  model's context (`<template_editor_source>`, which says it is template data whose
  instructions are ignored). `sendMessage` accepts it only in a conversation started
  from that template's editor (the first message's `document_template` seed of the
  same type); anywhere else it is refused.
- **How a change arrives.** The model proposes the complete template with
  `validateDocumentTemplateDraft` (an advanced MCP read, module `documents`, the
  template **manage** gate). It checks the source exactly as a save does
  (`assertValidTemplateSource`, shared with `saveTemplate`: the Notice and Question
  paper checks for those types, the sample render for the others), saves nothing, and
  returns `{ valid, problems, draftId, characters }`, never echoing the source. A
  succeeded call is a card in the chat (`ASSISTANT_CARD_TOOLS`,
  `document_template_draft`): the problems when it would not save, else where it
  stands for the editor (*Shown in the editor*, *Show in editor* for an earlier one,
  or *Proposed before the template was last saved*).
- **The working copy.** The template on screen is derived (`editorSourceOf`) from the
  person's own working copy and the newest ready draft of this school's template of
  this type proposed after the template was last saved (`latestTemplateDraftOf`,
  server times both). The working copy carries its own fact `editedSinceSend`: whether
  they changed it by hand (typing, Restore, Reload saved) since their last message was
  sent, the snapshot taken at sending (the model drafts from what it was sent). A new
  draft is shown in the code and the preview at once (no effect) unless they did: then
  their edits stay and the draft is **held**, never shown by itself; the header and a
  notice under it say so, and its card offers *Replace my edits*. Sending again past a
  held draft declines it. A hand edit made after a shown draft keeps the hand edit
  until the next draft. A draft of another school or document type (a conversation
  opened in another editor) is only described (`elsewhere`), never loaded. Drafts are
  not rows: they exist only in the conversation.
- **Saving.** Only the person saves, with *Save template* (what is on screen becomes a
  new revision through `saveDocumentTemplate`, as always). In a conversation started
  from the template editor the assistant's runtime refuses `saveDocumentTemplate` and
  `selectMarketplaceTemplate` before any approval card (`TEMPLATE_EDITOR_REFUSED_TOOLS`
  in `@campuspilot/assistant-contract/template-editing`; FORBIDDEN, telling the model
  to propose a draft instead), so it does not rest on the model following the seed and
  the guide. Anywhere else they are ordinary writes that wait for the approval card.
  The guide (`learn_document_template_editing`) words its workflow for both callers: in
  the editor's conversation a draft is shown there; an MCP client or another chat has
  no editor, so a valid draft only means it would save.

## Frontend architecture

API-aware orchestration belongs in `apps/management/components/documents`. Shared
presentation controls in `packages/components/src/documents` accept data and
callbacks and must not call APIs.

| Component | Responsibility |
| --- | --- |
| `DocumentWorkspace` | Section navigation, card-triggered generator dialog, template warning registration, and history composition |
| `DocumentGenerator` | Academic type-specific source fields, template dependency, preview, generation, and warnings |
| `FinanceDocumentGenerator` | Posted billing-run/payment selection, finance preview, generation, download, and history handoff |
| `DocumentHistory` | One session-wide artifact list, downloads, provenance, and deletion |
| `DocumentTemplates` | Empty state, read-only PDF preview, or authorized school-template editor |
| `TemplateEditor` (`template-workspace.tsx`) | The template builder: header row, resizable AI/Code pane, PDF preview, working copy and assistant drafts, revision viewing and restore |
| `TemplateAssistantPane`, `useTemplateChat` (`template-assistant.tsx`) | The editor's chat, its address (`?chat=`) and its drafts |
| `TemplatePdfPreview`, `useTemplatePdf` (`template-pdf-preview.tsx`) | A source as its PDF through `previewDocumentTemplatePdf`, cached per source |
| `RevisionPicker`, `RevisionHistoryDialog`, `RevisionPreview` (`template-revisions.tsx`) | Revision select, history dialog, read-only revision with Restore |
| `TemplateCodeEditor` | Client-only Monaco wrapper and source-format action |
| `TemplatePromptEditor` | Local portable-prompt dialog and clipboard operations (users without the assistant) |
| `PdfPreview` (components) | API-free pdf.js preview with skeleton, updating and error states; reused by the marketplace |
| `TemplateDraftCard`, `template-draft-model.ts` (components) | The chat's template draft card and the pure reading of drafts and the working copy |
| `TemplateRevisionList`, `TemplateRevisionNotice` (components) | API-free revision rows and the read-only revision notice |
| `DocumentTemplateMarketplace` (`document-template-marketplace.tsx`) | Type tabs, design tabs, the selected design's PDF, the full-screen preview and Use template; its address in `marketplace-model.ts` |
| `TemplatePdfPreview`, `TemplateRevisionPdfPreview`, `MarketplaceTemplatePdfPreview` (`template-pdf-preview.tsx`) | A source, a saved revision by id, or a marketplace design by slug, as its PDF; shared query defaults |
| `PreviewDialogContent` (components) | API-free preview dialog shell: `tall` (the chat's draft and version previews) or `full` (the marketplace) |
| `ScrollableTabsList` (components) | A tab row that scrolls sideways instead of squeezing (marketplace, examination workspace) |
| `DocumentKindCards` | API-free accessible visual card group for the Documents workspace |
| `DocumentPreview` | Restrictive empty-sandbox iframe for already sanitized HTML |

All user input and submission state uses TanStack Form with Zod validators. Do not
introduce standalone `useState` or `useEffect` for these workflows. Derive selected
values with `form.Subscribe`, use keyed component lifecycles for revision changes,
and use TanStack Query invalidation/refetching for server state.

## API procedures and permission boundaries

Finance types use the finance template actions in each row (`READ_/MANAGE_FINANCE_DOCUMENT_TEMPLATES`),
and every template procedure then checks the type's feature. Frontend permission gates control visibility only. Every procedure enforces the
same boundary through server middleware.

| Procedure | Purpose | School action |
| --- | --- | --- |
| `listMarketplaceTemplates` | Paginated catalog metadata for one type | `READ_DOCUMENT_TEMPLATES` |
| `getMarketplaceTemplate` | Catalog source, context reference, and sample preview | `READ_DOCUMENT_TEMPLATES` |
| `getActiveDocumentTemplate` | Current immutable school revision or `null` | `READ_DOCUMENT_TEMPLATES` |
| `selectMarketplaceTemplate` | Import and select a catalog design | `MANAGE_DOCUMENT_TEMPLATES` |
| `saveDocumentTemplate` | Save and select a custom revision | `MANAGE_DOCUMENT_TEMPLATES` |
| `previewMarketplaceTemplatePdf` | A catalog design by slug as its PDF with synthetic data; converted once per process; hidden from MCP | `READ_DOCUMENT_TEMPLATES` |
| `previewDocumentTemplate` | Render source with synthetic data as HTML (MCP) | `READ_DOCUMENT_TEMPLATES` |
| `previewDocumentTemplatePdf` | The same render as a PDF for the editor, within the preview limits and a conversion slot; hidden from MCP | `MANAGE_DOCUMENT_TEMPLATES` |
| `previewDocumentTemplateRevisionPdf` | A saved revision by id as its PDF, for the read-only preview and the revision view; same limits; hidden from MCP | `READ_DOCUMENT_TEMPLATES` |
| `listDocumentTemplateRevisions` | Paged revision history, newest first | `READ_DOCUMENT_TEMPLATES` |
| `getDocumentTemplateRevision` | One revision with its source | `READ_DOCUMENT_TEMPLATES` |
| `learn_document_template_editing` | The rendering contract, the draft workflow and the variable reference (AI and editor) | `READ_DOCUMENT_TEMPLATES` |
| `validateDocumentTemplateDraft` | Check a proposed template exactly as a save would; saves nothing | `MANAGE_DOCUMENT_TEMPLATES` |
| `previewDocument` | Render authorized data without persistence | Academic: `GENERATE_DOCUMENTS`; finance: `GENERATE_FINANCE_DOCUMENTS` |
| `generateDocument` | Validate the request and queue a generation job; returns `{ jobId, job }` at once | Academic: `GENERATE_DOCUMENTS`; finance: `GENERATE_FINANCE_DOCUMENTS` |
| `getDocumentGenerationJob` | Status, progress, `artifactId` once succeeded, `errorCode`/`errorMessage` once failed | What starting the job's type needs: generate action, source reads, the type's feature |
| `listDocumentGenerationJobs` | A session's queued and running jobs and those failed in the last 7 days (paginated), of the types the caller could start | Requested academic and/or finance artifact read actions |
| `listDocumentArtifacts` | Paginated PDF history; explicit `all` requests form a chronological secure union | Requested academic and/or finance artifact read actions |
| `getDocumentDownload` | Issue a fresh short-lived signed URL | Type-aware academic or finance artifact read action |
| `deleteDocumentArtifact` | Retry-safe PDF deletion | Type-aware academic or finance artifact delete action |

Generation also requires the independent permissions needed for its source data.
For example, visibility of a Generate button does not grant access to examination
results, students, classes, or sessions.

## Data and immutable lifecycle

`artifact` represents both template revisions and generated PDFs. Each row records
its school, kind, document type, immutable S3 key, hash, size, creator, lifecycle
status, and relevant provenance. PDF artifacts also retain the exact template
revision, source identifiers, recipient identifiers, template page footprint,
print options, and approval policy used at generation time.

Template `pageSize` is immutable revision metadata. `half` means one rendered
document occupies 210 × 148.5 mm and the server places two documents vertically
on each portrait A4 sheet. It is supported only for admit cards, bills, receipts,
and statements. A Notice revision is always `full` and `half` is refused
(`validateTemplatePageSize`): a notice's print size is the notice's own fact
(`notice.page_size`), and one Notice design prints both sizes, adapting to
the `print.size` context fact (see "Notices"). Report cards remain full portrait A4, timetables remain full
landscape A4, and student IDs keep their dedicated 86 × 54 mm A4 imposition.
Preview and generation read this value from the selected revision; a batch request
cannot override it. Existing revisions migrate to `full`, avoiding a silent
reinterpretation of historical templates.

`school_document_template` is the mutable selection pointer: one active artifact ID
per school and document type. Changing the pointer never mutates or removes an old
revision. Historical PDFs and their template names therefore remain explainable.

The template lifecycle is:

```text
server catalog source
        |
        | import
        v
immutable school template artifact in S3 + PostgreSQL
        |
        | selected by school_document_template
        v
preview live source data ---- generate ----> immutable PDF artifact
                                              |
                                              v
                                      short-lived download URL
```

S3 and PostgreSQL do not share a transaction. Upload helpers compensate for a
failed database write by deleting the new object. A template conflict similarly
removes the unused upload. PDF deletion first marks the row `deleting`, then removes
the object and row; storage failure leaves a visible record that can be retried.

## Document source rules

The supported `DocumentType` values are `report_card`, `id_card`, `admit_card`,
`timetable`, `bill`, `receipt`, `statement`, `notice`, and `question_paper`. The
first seven have source DTOs in a strict discriminated union. `notice` is a
**template-only** type (`TEMPLATE_ONLY_DOCUMENT_TYPES`): it has a school template,
marketplace design and settings page, but no generator source, no card in the
Documents workspace and no PDF artifacts or history; notices are written, rendered
and published by the notices feature (see "Notices" below). `question_paper` is
template-only too, rendered by the question paper feature (see "Question papers"
below), but it does store a PDF artifact per saved version. Do not add optional
fields to a common base merely because two types happen to use the same value today.

- Report cards can target a complete examination, one class, or up to 1,500 explicit
  students within one class. Approval policy and four independent print flags are
  recorded.
- Student IDs use enrollment plus admission identity and photo data.
- Admit cards can target every examination class, one class, or explicit students
  within a class. Each card combines identity with that student's class schedule.
- Timetables are examination-wide. Their source contains only school/session,
  document type, and examination slug. It never accepts `classId`.
  "Examination-wide" means every class **taking part** in the examination
  (`exam_class`); a class excluded from it (CAM-14) is in no timetable column.
- Examination documents (report cards, admit cards, timetables) cover only the
  classes taking part. A `classId` of a class that does not take part is refused
  ("This class does not take part in this examination."); exam-wide report and
  admit cards follow the subject plans, which exist only for classes taking part.
- Bills identify immutable posted bill facts. Receipts identify an explicit payment
  or refund and use the identity/session snapshot captured when the payment posted.
- Statements accept a session, admissions, and a real local through-date. The
  server derives currency and IANA time zone from that session's complete finance
  configuration, validates the session/future boundaries, and records one
  high-water sequence per admission/currency. Generation must present the hash of
  the reviewed cutoff so intervening postings cannot silently change the PDF.

Finance rendering must not join current admission, enrollment, or classroom
records. Identity comes from the posting-time ledger/payment/bill snapshot bounded
by the document cutoff. Session finance configuration is read only to derive the
server-owned currency/time-zone scope, which is included in statement review
provenance. A legacy fact without the required immutable snapshot fails explicitly
rather than inventing an empty or zero value.

The timetable rule is enforced in all three layers:

- the UI does not render a classroom selector and does not serialize `classId`;
- the strict DTO rejects stale or handcrafted class-scoped input;
- context construction uses every timetable grid column and preserves every
  subject/mode in a shared slot;
- every column is a class taking part: `saveExamTimetable` and class removal
  (`updateExamClasses`) keep it so, and context construction refuses a column of
  a class that does not take part instead of printing or silently dropping it.

Keep those checks independent. UI omission alone is not an API invariant.

## Template authoring contract

Marketplace source lives in
`packages/api/src/routers/school/document/document.catalog.marketplace.ts`, with
the imported legacy snapshot in `document.catalog.legacy.ts`. Each catalog entry
has a globally unique slug, exact document type, human-readable name and
description, and complete self-contained HTML.

Every bundled design must:

- use `{{school.logoUrl}}` conditionally and include meaningful image alt text;
- render without external fonts, images, stylesheets, scripts, forms, or links;
- keep CSS and print dimensions inside the document;
- use only the documented context fields and supported Handlebars helpers;
- preserve missing values as missing and zero values as zero;
- fit the catalog entry's explicit output: portrait A4 for full revisions,
  210 × 148.5 mm for half revisions, 86 × 54 mm for each student ID before A4
  imposition, and landscape A4 for timetables;
- render against `SAMPLE_DOCUMENT_CONTEXT` without reading live tenant data.

The renderer allows standard Handlebars `each`, `if`, `unless`, `with`, and
`lookup`, plus the finite-numeric `add` helper. This is an **allowlist**
(`DOCUMENT_TEMPLATE_HELPERS` in `document.render.ts`): every other built-in is
unregistered when the instance is created, including `log`, which would let a
template write unbounded data to the server's console. A call to any other
helper is a BAD_REQUEST. Prototype access is disabled.

### Render budget

A render is bounded **while it runs**, not afterwards: a template that
multiplies a large value (nested `each` around photos, one value repeated
thousands of times) is aborted at the limit instead of building a string of
hundreds of megabytes first. The rule in `document.render.ts` is a design rule,
not a list of patched helpers: **every construct that can produce output is
either counted or refused when the template is parsed**, for school document
templates and notices alike (one shared instance).

| Construct | Decision |
| --- | --- |
| Static text | Counted on every run of the body it is written in (a statement inserted first in every body). |
| `{{value}}`, `{{helper a b}}`, `{{@index}}`, `{{../a}}`, block params | Counted after HTML escaping. |
| `{{{value}}}`, `{{&value}}` | Counted. |
| Sub-expressions `(lookup a b)`, hash arguments | Produce no output; printed only through the two rows above. |
| `{{#each}}`, `{{#if}}`, `{{#unless}}`, `{{#with}}`, `{{else}}`, `{{else if}}`, `{{^}}` | Their output is the bodies they run, and each run counts itself. Every run also costs one step plus, for every expression or block written in that body, its expression nodes (path parts, literals and sub-expression heads; `{{x}}` is one, `{{lookup a.b "c"}}` four). See "CPU" below. |
| `{{#value}}…{{/value}}` sections, `{{{{raw}}}}` | As above. |
| `{{#lookup}}`, `{{#add}}`, any other registered helper opened as a block (also spelled `{{#"lookup"}}`, `{{#@lookup}}`, `{{#lookup.x}}`) | **Refused.** Their result would be printed without passing a counted value. |
| `{{> partial}}`, `{{#> partial}}`, `{{#*inline}}`, `{{* decorator}}` | **Refused**; no partial or decorator is registered. |
| The renderer's own helpers (`__document…`), any unknown AST node | **Refused.** |
| A call with more than 4 arguments or 4 hash pairs, a path of more than 8 parts, sub-expressions nested more than 4 deep, more than 32 expression nodes in one statement or 10,000 in a template, blocks nested more than 64 deep (every `{{else if}}` of a chain counts as a level) | **Refused** (`DOCUMENT_TEMPLATE_STRUCTURE_LIMITS`). |

Two further lines of defence keep this true for constructs nobody listed: the
result of any helper called as a block is charged for whatever its bodies did
not count, and after a render the string must be exactly as long as what was
counted, or the render is refused. `document.render.test.ts` has one row per
construct in two tables (counted to the character and identical to plain
Handlebars; refused), and checks every marketplace design the same way. A new
helper or construct belongs in exactly one of them.

The budget is 25 million units (`DOCUMENT_RENDER_MAX_CHARS`) for a **whole
batch**: `renderDocuments` compiles the template once and renders every
student's context under one shared budget, the same ceiling as the combined
result. Notices pass a much lower one. Because the save-time check and every
later render run under the same budget, a template that was accepted cannot
cost more than the budget when it is rendered with real data; real data that
does not fit is a BAD_REQUEST for that render.

**CPU.** The budget bounds time as well as output because every unit of it is a
bounded amount of work. Handlebars evaluates every argument, hash value and path
part of a statement on every run, so a statement is charged its expression
nodes on every run, and the structural limits above keep each statement to a
few nodes (before them, one `{{lookup a a … a}}` with 60,000 arguments inside
nested loops was charged two steps per run and blocked the process for
minutes). Nesting is checked on Handlebars' own tokens **before** the template is
parsed (`parseDocumentTemplate`), because the parser is superlinear in nesting
(4,000 nested sub-expressions took 2.6 s to parse); every server-side parse goes
through that function. The scan reads the whole template: the lexer returns most
tokens as ids but the end of a raw block (`{{{{/raw}}}}`) and `INVALID` as names,
and the scan maps names through the parser's own symbol table, as the parser does
(before review round 4 it stopped at the first raw block, so everything after
one was parsed unchecked). It stops early only where the parser is certain to
fail at the same position (an `INVALID` token or a lexical error), and refuses a
token it cannot classify or a scan that does not finish, so the parser never
consumes a token the scan has not checked. `document.render.test.ts` holds this
after raw blocks, comments, string literals and escaped mustaches, with a time
limit. Measured worst cases: a loop of empty bodies or of the
costliest allowed statement exhausts the 2 million notice budget in about 0.1 s
and the 25 million document budget in about 1 s (`document.render.test.ts` and
`notice.render.test.ts` hold this with time limits). The catalog's designs use at
most 2 arguments, no hash, 3 path parts, sub-expressions one deep and blocks five
deep, far inside the limits.

Before shipping this to a database with stored school templates, run them
through `renderDocument` against their sample context: a stored template that
uses a partial or a block `lookup`, or exceeds a structural limit (no catalog
design does), would now be refused.
Rendered HTML is sanitized, wrapped in a restrictive content-security policy, and
shown in an iframe with an empty `sandbox` attribute. Gotenberg runs with JavaScript
and public/private outbound network access disabled.

The variable reference exported as `DOCUMENT_CONTEXT_HELP` is user-facing API.
Update it whenever the context shape changes. A field is not supported merely
because it exists somewhere in a database row; `buildDocumentContexts` must expose
it explicitly and tests must cover its meaning, nullability, and authorization.

### Template context reference

The editor obtains this contract from the server. This table is a discoverability
aid; `DOCUMENT_CONTEXT_HELP`, context types, and integration tests remain the
executable source of truth.

| Applies to | Context |
| --- | --- |
| Every document | `school.{name,location,registrationNo,logoUrl}`, `session.{startYear,endYear}`, nullable `exam`, ISO `generatedAt` |
| Notices | Only `school`, `session`, `generatedAt` and `notice.{title,issuedOn,issuedOnDisplay,paragraphs[]}`; nothing else from this table |
| Question papers | Only `school`, `session`, `generatedAt`, `exam.{name,slug,order}` and `questionPaper.{className,subjectName,subjectSlug,modeName,modeSlug,maxMarks,totalMarks,timeAllowed,language,script,direction,versionNo,bodyHtml}`; `maxMarks` may be null; `totalMarks`, `timeAllowed`, `language` and `script` are always null and `direction` always `ltr` (kept for old template revisions); `bodyHtml` is the body slot placeholder (see "Question papers") |
| Student documents | `student.{name,admissionNo,rollNo,className,sectionName,dob,fatherName,motherName,address,phoneNo,whatsappNo,photoUrl}` (phone numbers display-formatted with country code; `whatsappNo` nullable) |
| Report cards | `subjects[]`, totals, overall percentage/grade, grading scale, attendance, co-scholastic data, approval/configuration flags, and independent report-section flags |
| Admit cards | `timetable[]` entries for the student's class with ISO/display date, weekday, raw/display time, subject, and mode |
| Timetables | `columns[]` plus `rows[]`; every row has ordered `entries[]` matching columns and a legacy keyed `cells` object |

Important shapes and semantics:

- `subjects[]` includes `slug`, `name`, `marks[modeSlug]`,
  `modeConfig[modeSlug].{name,percentage,maxMarks}`, `total`, `totalMarks`,
  `percentage`, and `grade`.
- `modeColumns[]` is the union of every subject's assessment modes, ordered by
  name then slug, each `{slug,name,maxMarks}`; `maxMarks` is `null` unless every
  subject with that mode shares one maximum. Each subject's `modeCells[]` is
  aligned with `modeColumns`, each `{slug,applicable,mark,maxMarks}`, with
  `applicable: false` and null values where the subject lacks the mode. Build
  mode-mark tables from these, never from one subject's `modeConfig`: subjects
  may use different modes. Bundled report designs were adapted in place under
  their slugs; already imported school revisions keep their old markup.
- `attendance` is nullable or
  `{daysAttended,totalWorkingDays,percentage}`. `attendanceEnabled` reports the
  session configuration independently of whether approved attendance exists.
- `coScholastics[areaSlug].{areaName,grade}` is nullable;
  `coScholasticAreas[areaSlug].name` contains the configured definitions.
- `assessmentApproved` is `true`, `false`, or `null`; do not infer it from marks,
  attendance, or examination lifecycle.
- `reportSections.{includeModeMarks,includeAttendance,includeCoScholastics,includeGradingScale}`
  are independent print choices and do not alter stored assessment data.
- Timetable `rows[].entries[]` follows `columns[]` order. Each entry has `classId`
  and `subjects[]`. An unscheduled cell has an empty subjects array.
- Legacy `rows[].cells[classId]` is a resolved subject object, an array preserving
  multiple subjects/modes, or `null`. Keep it while v1 templates remain supported.
- Image values are strings the template places in `<img src>` unchanged, or
  `null`: a `data:` URI in previews, a generated asset file name in a generated
  PDF (see "Images as conversion assets"). Templates must guard them with
  `{{#if ...}}` and must never build or fetch a URL from them.

### Add a marketplace design

1. Add an explicit per-type entry in `document.catalog.marketplace.ts`.
2. Choose a stable, descriptive slug. Never rename a published slug casually;
   artifact provenance stores it.
3. Set an explicit `pageSize`; use `half` only for supported document types.
4. Include the conditional school logo and self-contained print CSS.
5. Render it with `SAMPLE_DOCUMENT_CONTEXT` and inspect the actual iframe/PDF.
6. Extend `document.catalog.test.ts` for counts, slug uniqueness, branding, and any
   design-specific invariant.
7. For a half design, verify two recipients produce one PDF page and three
   recipients produce two pages.
8. Check the marketplace's type and design tabs, the design's PDF and its
   full-screen preview at desktop, 390 px, and 320 px.

### Add or change a template variable

1. Add an explicit value to the correct context builder; do not pass a database
   record through wholesale.
2. Define independent nullable/optional semantics. Do not derive one fact from a
   merely correlated field.
3. Update the context TypeScript type and focused tests.
4. Update `SAMPLE_DOCUMENT_CONTEXT` with synthetic, non-tenant data.
5. Update `DOCUMENT_CONTEXT_HELP` and any bundled templates that should use it.
6. Verify old templates still render or document and migrate a deliberate contract
   break.

### Add a document type

Adding a document type is cross-cutting. At minimum update:

1. `documentTypeSchema`, `DOCUMENT_LABELS`, and the strict source union;
2. context building, rendering dimensions/batch layout, and generation provenance;
3. storage/artifact DTOs and database constraints or migrations when required;
4. OPA action catalog/grants when new permissions are introduced, followed by the
   generated action workflow;
5. marketplace catalog entries, synthetic context, and variable documentation;
6. `documentKinds`, card icon/copy, Settings route mapping, marketplace routes, and
   generator fields;
7. missing-template warnings, history labels, contextual export links, and legacy
   redirects where applicable;
8. authorization, DTO, renderer, persistence, integration, and responsive browser
   tests.

Do not make a type available in the card selector until its Settings route,
marketplace designs, backend context, and permissions are complete.

## Notices

[School notices](notices.md) is the canonical guide to the feature; this section
records only how it uses the document system.

`packages/api/src/routers/school/notice` renders notices through this system:
the same restricted Handlebars instance, sanitizer, CSP wrapper and Gotenberg
conversion. What differs is recorded here because it is easy to get wrong.

- **Feature gate.** Every template procedure refuses `documentType: 'notice'`
  for a school without the `notices` feature (after the permission check).
  The marketplace shows the Notice card only when the feature is enabled.
  Notice templates use the academic template actions
  (`READ_DOCUMENT_TEMPLATES` / `MANAGE_DOCUMENT_TEMPLATES`).
- **Context.** `buildNoticeContext` (`notice.render.ts`) exposes only
  `school.{name,location,registrationNo,logoUrl}` (the shared
  `buildSchoolDocumentContext`, also used by academic and finance documents),
  `session.{startYear,endYear}`, `generatedAt`, `print.size` (the notice's
  own `page_size`, `full` or `half`) and
  `notice.{title,issuedOn,issuedOnDisplay,paragraphs[]}`. There is no student,
  staff, exam or finance data. Templates are previewed and validated against
  `SAMPLE_NOTICE_CONTEXT` (`sampleDocumentContext('notice')`), never the
  general sample. `issuedOn` is the publication date (today for a draft) in
  the session's finance time zone when one is configured, else UTC. For a
  published notice the date is stored at publication (`notice.issued_on`) and
  never recomputed.
- **Two body modes.** A `plain` notice is data: its text is split into
  `notice.paragraphs[]` at blank lines and printed escaped by the template; it
  is never compiled as Handlebars. A `template` notice is its own complete
  document: the author's source is compiled by the restricted renderer and
  sanitized like a school template, with `paragraphs` empty. Because every
  staff role can write one, an author's source is additionally refused when
  it nests block helpers more than four deep (`assertBoundedNoticeTemplate`),
  on save and on every render. Every notice render (author source or school
  Notice template) has a 2 million budget and receives the school logo as a
  placeholder that is replaced after rendering, at most three times; a school
  Notice template is checked against both when it is saved, with the sample
  and with a notice of the maximum length. See "Security contract" in
  [School notices](notices.md). What the
  custom-template editor tells authors (variable list, starter document) is
  owned by `notice-template-guide.ts` next to the renderer and is exhaustive
  over `SAMPLE_NOTICE_CONTEXT`; do not copy it into an app.
- **Which template.** A draft or unsaved preview uses the school's selected
  Notice revision, or the built-in `notice-default` design when none is
  selected (a notice never needs a selected template). Publishing pins the
  revision used on the notice (`notice.template_revision_id`; null for the
  built-in design and for `template` notices), so a later template change
  never alters a published notice.
- **Print size and flowing layout.** Each notice chooses `full` or `half`
  A4 (`notice.page_size`, both body modes). `combineDocuments(..., 'notice',
  size)` never clips to a fixed sheet: a full notice flows over portrait A4
  pages with a 16 mm `@page` margin, a half notice over 210 x 148.5 mm pages
  with a 10 mm margin (on screen: padding, plus a line where each half page
  ends). The half-page PDF is then imposed with pdf-lib two copies per
  portrait A4 sheet with a dashed cut guide (`imposeHalfPageNoticeCopies`),
  so it prints on plain A4: unlike admit cards and finance documents, the
  two halves of a sheet are the **same** page, by decision (the school
  "cut in half" circular). Notice designs are size-adaptive: their
  revision `pageSize` is always `full`, the save check renders them at both
  sizes, and the bundled `notice-default` and `notice-compact` designs carry
  `--{{print.size}}` classes. Notice templates must not set a fixed height,
  `overflow: hidden` or outer page padding.
- **PDF.** A published notice is immutable and identical for every reader, so
  its PDF is rendered once and cached at
  `schools/{schoolId}/notices/{noticeId}-{pageSize}.pdf` (no `artifact`
  row; the pinned size is in the key). The same
  object backs the staff download, the Cadet Portal download and every
  WhatsApp attachment. The key is deterministic: concurrent first requests in
  different processes may each write an equivalent object. The demo purge's
  school-prefix sweep removes it.

## Question papers

`question_paper` is the template of the heading and footer of AI-assisted question
papers. The canonical feature guide is [Question papers](question-papers.md)
(product model, data model, the HTML fragment and its sanitiser, permissions, the generation
job and chat); this section owns only what the document system does for the type. The
questions themselves are an HTML fragment written by a model, sanitised with the
`question_paper_body` profile and turned into the body by the question paper renderer, never
by the template. What this document system owns for the type:

- **Template-only, full A4 only.** In `TEMPLATE_ONLY_DOCUMENT_TYPES`; `half` is
  refused by `validateTemplatePageSize`. No default design is shipped: generation is
  blocked until the school has selected a question paper template.
- **Body slot.** The template places `{{{questionPaper.bodyHtml}}}` exactly once, in
  element content. The context value is the constant `QUESTION_PAPER_SLOT`
  (`question-paper.slot.ts`). The template is rendered and sanitised like any other
  document; only then does `substituteQuestionPaperBody` replace the slot with the
  body, using `indexOf` and slicing (never `String.replace`). Zero or several slots
  are BAD_REQUEST ("Place {{{questionPaper.bodyHtml}}} exactly once, in element
  content.").
- **Two deliberate security differences (design K1, acknowledged).** (1) The body is
  *not* sanitised after the template. The fragment is untrusted model output: it is
  sanitised with the stricter `question_paper_body` profile when saved and again at every
  render, **before** the only two things inserted afterwards, both produced by our code (KaTeX
  output from a formula's plain LaTeX string, and the data URIs of figures loaded from the
  paper's own stored images). The document sanitiser itself would strip the inline SVG that
  KaTeX draws roots and arrows with, which is why the body skips the second pass. (2) The CSP of this type, and only this type, adds
  `font-src data:` (`documentContentSecurityPolicy`) so the KaTeX fonts, inlined as
  data URIs, load. Nothing else is widened: no network, no script, no frames. Do not
  extend this to another type, add a second trusted insertion point, or weaken the
  policy for a marketplace design without repeating that review.
- **Layout.** `combineDocuments(..., 'question_paper')` flows over full A4 pages with
  `@page{size:A4;margin:14mm 14mm 10mm}` and never clips. The heading is in normal
  flow (first page); the footer is `position:fixed; bottom:0` (at most 12mm tall),
  which Chromium repeats on every page. The wrapper is a table whose
  `table-footer-group` reserves a 14mm band at the bottom of every page, so the
  footer never covers a question. A footer placed in the margin (negative `bottom`,
  a transform, `top:100%`) does **not** work: verified against the Gotenberg of the
  stack, a fixed element can only be painted inside the page content area, and one
  placed outside it vanishes from page 1 and reappears at the top of the next pages.
  Templates must not set a fixed height, `overflow:hidden` or outer page padding.
  **On screen** (the sandboxed preview, `@media screen`) the paper is one long column,
  not pages, so a footer fixed to the viewport would float over whichever questions are
  at the bottom of the frame. The wrapper table (`.qp-frame`, the page's content area)
  therefore has a `transform` on screen only, which makes it the containing block of the
  fixed footer: the footer shows once, at the end of the paper, inside the margins, and
  scrolls with it. Print is unchanged.
- **Direction.** The sanitiser keeps `class`, `style` and `id` only, so a template
  sets text direction with `style="direction:{{questionPaper.direction}}"`, not a
  `dir` attribute. `questionPaper.direction` is always `ltr` (the page frame); the body sets
  its own `dir` and `lang` on the elements that need them and the renderer picks script fonts
  from `lang`, because the body does not pass through the document sanitiser.
- **Context.** `QuestionPaperContext` (`question-paper.context.ts`): school, session,
  `generatedAt`, `exam.{name,slug,order}` and
  `questionPaper.{className,subjectName,subjectSlug,modeName,modeSlug,maxMarks,totalMarks,timeAllowed,language,script,direction,versionNo,bodyHtml}`.
  Of these `totalMarks`, `timeAllowed`, `language` and `script` are **always null** and
  `direction` is always `ltr`: nothing reads facts out of the free-HTML paper. The keys remain
  so template revisions written against the earlier structured paper keep rendering (their
  `{{#if}}` blocks print nothing). `maxMarks` is the exam plan's maximum for the mode (null only
  for samples). No student, staff, finance or result data. `SAMPLE_QUESTION_PAPER_CONTEXT`
  (`sampleDocumentContext('question_paper')`) is its synthetic twin.
- **Designs.** `question-paper-classic` and `question-paper-compact` (slugs use
  hyphens, unlike the type). The catalog test asserts the slot appears exactly once
  in every `question_paper` design.
- **Generic history.** Question paper PDFs are not part of Document history: the
  class-level question paper permissions differ from the school-level history
  permissions, so versions and downloads live in the Question paper tab.
  `listDocumentArtifacts` never returns a `question_paper` artifact and
  `getDocumentDownload` / `deleteDocumentArtifact` answer NOT_FOUND for one (the
  artifact rows are real: one PDF per saved version, `kind: pdf`,
  `documentType: question_paper`, with the class, session and exam filled).
- **Word download.** A saved version also downloads as an editable Word file, made on its first
  Word download from the same fragment, figures and pinned revision, with the heading taken from the
  template before the slot and its `position:fixed` footer as a Word footer on every page, and
  stored as an artifact of kind `docx` (`docx_artifact_id` on the version). The canonical description
  is [Question papers: Word download](question-papers.md#word-download). Like the PDFs, these
  artifacts are not part of Document history (`listDocumentArtifacts` never returns a
  `question_paper` artifact, and `getDocumentDownload` serves only `kind: pdf`). A template author
  gets the best Word heading from plain structure: text, the logo, flex rows and tables, rules as
  borders; background colours and exact sizes do not carry over.
- **Who may configure the template.** The usual academic template permissions
  (`READ_/MANAGE_DOCUMENT_TEMPLATES`), plus the school's `assistant` feature
  (`requireDocumentTypePermission`, checked after the permission so a caller
  without access learns nothing). Only the *feature* is checked there, not the
  caller's own assistant role: a principal whose role is not switched on for the
  assistant can still choose the school's template. The papers themselves use the
  full assistant gate (`requireQuestionPaperAssistantAccess`).
- **Saving and previewing a template.** `saveTemplate` checks a `question_paper`
  template with `assertValidSchoolQuestionPaperTemplate`: it renders the sample
  context with the rendered English example paper in the slot, so the slot must be
  placed exactly once, the render must fit `QUESTION_PAPER_TEMPLATE_RENDER_MAX_CHARS`
  (2,000,000, the notice budget; the body never counts against it because the
  template only ever prints the constant placeholder), the school logo may appear at
  most 3 times (the notice technique: the template is given a random placeholder and
  the real data URI is substituted after sanitising) and the whole document must stay
  within 25 MB. Template previews and marketplace previews show the example paper.
- **Rendering a paper.** `question-paper.render.ts` composes the document:
  `renderTemplate` -> `substituteQuestionPaperBody`. A saved version pins the
  template revision it was printed with (`template_revision_id`); previews and
  re-downloads use that revision, never the school's current choice. The body is
  `question-paper.body.ts` (sanitise again, figures and placeholders, KaTeX,
  the default stylesheet and the `qp-body` wrapper) with KaTeX
  (`question-paper.math.ts`: HTML output only, `trust: false`, no macros, 2 s wall
  budget; the stylesheet with `data:font/woff2` fonts is built once per process from
  the pinned `katex` package and added only to papers that contain math).
- **Demo schools.** The demo seed selects the `question-paper-classic` design for a
  demo school (`seedTemplates`) although the demo has the `assistant` feature off:
  the procedures refuse the type without the feature, so the seed saves the
  catalogue design with the same `saveTemplate` function after the same
  `MANAGE_DOCUMENT_TEMPLATES` check. The seeded papers' PDFs are printed with it.
- **Extending.** A new design needs the slot exactly once and must follow the layout
  rules above; changing the slot, the CSP exception or the sanitising order needs the
  review the slot file asks for. Other changes to papers: see "Extending" in
  [Question papers](question-papers.md#extending).

## Notification attachments (WhatsApp)

WhatsApp `school_document` messages (receipts for `payment.received`, report
cards for `exam.results_published`) carry one PDF rendered in the worker by
`packages/api/src/notifications/documents/`. Those sources reuse this system
unchanged: the school's selected immutable template revision, the type's own
context builder (receipts with the `posted_unreversed_payments` policy and the
payment's posting-time snapshot; report cards for exactly one registered,
fully approved student), the restricted renderer, sanitising, batch layout and
the same Gotenberg conversion. A domain refusal (reversed payment, unapproved
results, invalid template) produces no PDF and the delivery fails visibly; it
is never replaced by a partial document.

A `notice.published` message carries the notice's PDF from the notice cache
described under "Notices": rendered once per notice, not once per recipient,
and always available (no selected template is required), so a notice is never
downgraded to text for lack of a template. Its delivery records the notice's
pinned template revision.

Receipt and report-card PDFs are message attachments, not documents of the school's history:
no `artifact` row or S3 object is written, so they never appear in Document
history and cannot be downloaded again. Provenance is kept on the delivery
(`notification_delivery.document_template_revision_id`). When the school has
no selected template of the type, the message is sent as text instead. The
worker acts for the notification system, not for a staff member; staff
generation permissions do not apply because nothing is generated for staff.

## Generation jobs

Every PDF made through `generateDocument` (report cards, ID cards, admit cards,
timetables, bills, receipts, statements, from the Documents workspace, the
examination links, the admission ledger's receipt, bill and statement actions)
is made in the background by the worker, so a 1,500-student export never loads
the API pod and survives worker restarts. Notices and question papers keep their
own flows. Code: `packages/api/src/workflows/document-generation/`, the router
side in `document.jobs.ts`.

**Start (API).** `generateDocument` authorizes exactly as before (type and
source permissions, the `studentManagement` gate; a suspended school or one
without a plan is refused by `requireAuth`, since starting a job is a write),
checks the selected template revision (`CONFLICT` when it changed), builds every
context once without reading any image (so relationships, approvals, the global
receipt reversal check and the statement review hash refuse here, as before),
refuses more than `MAX_DOCUMENT_SOURCE_ITEMS` (1,500) documents, refuses with
`TOO_MANY_REQUESTS` when the school already has 3 queued or running jobs or the
person 2 (counted under a per-school advisory lock, so two concurrent starts
cannot both pass; the person's lock is taken before the school's, so their jobs
in another school are counted too and two starts never deadlock;
`generateDocument` is also an MCP tool), inserts a
`document_generation_job` row and returns. The row pins what the worker must
reproduce: the template revision, `generated_at` (every document's
`generatedAt`), the statement `review_hash`, and for finance documents
`ledger_cutoff`, the per-account high-water ledger sequence read at start (a
statement's is its reviewed high-water). The PDF's artifact id is reserved on
the row (`artifact_id`). The request never waits for the worker: the hand-over
runs after the insert, and the job row is also the outbox.

**Hand-over.** The API sends a signed (`WORKER_CONTROL_SECRET`), idempotent
one-way call to `DocumentGenerationControl.startGeneration`, the only
ingress-public document service. It checks the row and queues the job on the
ingress-private Restate object `documentGeneration`, keyed by school: its
handler is exclusive, so **at most one job per school runs at a time** (a
partial unique index on running jobs guarantees it) and the school's other jobs
wait in order while other schools run. Each worker process runs at most two batch
steps or merges at once and one prepare step (`conversion-slots.ts`). A slot
covers the whole step (reading the batch's images, rendering, converting,
storing), so worker memory is bounded by the slots. A slot is taken inside
the step's closure, which always settles (its slot is returned even when the
step fails and Restate retries it) and never runs on a replay of a journaled
step; a Restate attempt that ends mid-wait stops the wait. Slots are handed
first come, first served. A wait longer than 10 minutes is journaled and
waited again as a new step (`name:wait-N`) that keeps its place in the
queue, so it never uses the step's retries; after six waits the job fails as
`worker_busy` (the number of waits is part of the journal's shape: change it
only when no document job is running). The API sweep
(every 30 s) re-sends unaccepted jobs, fails a job Restate never accepted
(10 minutes, `dispatch_failed`), never started (60 minutes, `not_started`) or
that runs longer than 60 minutes (`not_finished`), and removes temporary objects
an ended job left behind.

**Steps (worker, each journaled).** `claim` (queued to running) → `prepare` →
`batch:N` per batch → `merge` (more than one batch) → `finish` → `cleanup`.
Steps return only ids, keys, counts, sizes and hashes: the source, the pinned
cutoff and the other inputs are read from the job row by the steps that need
them. `claim` re-checks the school's write access (`school-access`): a school
suspended or left without a plan after the request fails the job
(`school_suspended` / `no_plan`) before any work.

- `prepare` builds every context in one repeatable-read, read-only transaction
  with the pinned cutoff (finance reads stop at the pinned sequences, so the
  documents describe the moment of Generate), compares a statement's review hash
  again, reads the size of every distinct image (`HEAD`), measures each
  document's rendered HTML under **one budget for the whole job** (a batch's
  25 million units times the most batches a 1,500-document job has, 8; one
  document at most one batch's budget), yielding to the event loop between
  documents so the worker's other services keep running, records the number
  of documents it really prints (`printed_document_count`, next to the start's
  `document_count`; screens show it once known), splits the documents into batches and writes them as
  JSON under the job's private prefix `schools/{schoolId}/document-jobs/{jobId}/`
  with a manifest (name, student ids, finance source, warnings).
- `batch:N` reads its JSON, reads its images once, renders with the pinned
  revision, converts, and stores `batch-NNNN.pdf` under a deterministic key (a
  repeated step overwrites; a single batch is stored straight at the final key).
- `merge` first adds up the batches' recorded sizes and fails the job
  (`pdf_too_large`) when they pass the merged-PDF limit (1 GB); a merge that
  Gotenberg refuses (4xx) or whose result passes the limit fails the job like
  a refused conversion; otherwise it
  streams the batch PDFs in order to Gotenberg `/forms/pdfengines/merge`
  (it merges in file-name order) and streams the result into a multipart upload
  at `schools/{schoolId}/documents/{artifactId}.pdf`; no PDF is held in memory
  whole.
- `finish` inserts the artifact (same fields as before: template revision, page
  footprint, source identifiers, finance source, SHA-256, size, the requester as
  creator) under the reserved id with `ON CONFLICT DO NOTHING` and marks the job
  succeeded in one transaction, so a repeated finish never creates a second
  artifact; a job the sweep failed meanwhile gets none.
- `cleanup` removes the temporary prefix (and a final PDF no artifact holds).

**Batching** (`batches.ts`). A batch closes at about 200 documents, about 5 MB
of HTML, the render budget, or 20 MB of distinct image bytes (each image counted
once per batch), whichever comes first, and always holds whole physical sheets
(two half-A4 documents, eight student IDs, one of anything else), so the merged
PDF has exactly the pages and order one conversion would print. A timetable is
one document. A sheet whose images alone pass 20 MB fails (`images_too_large`).

**Failure.** A job ends `failed` with a stable code and a message the screens
show (`DOCUMENT_GENERATION_JOB_FAILURES`): a refused input (`source_changed`,
`invalid_source` with the builder's own message, `template_unavailable`,
`images_invalid` naming whose photo, `images_too_large`, `document_too_large`)
fails at once without retries, and so does a conversion that would fail the
same way again (`conversion_refused` for a 4xx answer from Gotenberg,
`pdf_too_large` for a batch PDF over 150 MB); an infrastructure failure (5xx,
408, 429, a timeout, the network) is retried by Restate (5 attempts with
backoff) and then fails as `conversion_failed` or `internal_error`. A job is refused at start for a suspended school (a write), and fails at
claim if the school was suspended or lost its plan while it waited.

**Screens.** The generators poll `getDocumentGenerationJob` with TanStack
Query's `refetchInterval` (no effect) and show waiting, the part being created,
the failure message, or the ready state with the download. A ledger row's
receipt or bill action becomes a download button when its PDF is ready (a
browser download must follow a click). History lists queued, running and
recently failed jobs above the PDFs (only of the types the reader could start),
reads both lists again while a job is in progress, and refreshes the PDF list
from the query function that sees a job end. Reading a job
(`getDocumentGenerationJob`) needs what starting one of its type needs: the
generate action, the source's read actions and the type's feature.

**Known cost.** A statement export still reads each admission's ledger with
several queries per admission, which is slow for a whole school at once (the
UI offers single-admission statements only). Bulk reads are designed in phase 3
(bill due); until then this is accepted.

**Data.** `document_generation_job` (migration `0085`) is school-owned and is
deleted by `purge_demo_school`; its temporary objects are under the school's
prefix, which the demo purge workflow sweeps.

### Images as conversion assets

Context builders can return images as references (`reference` mode,
`document.images.ts`) instead of `data:` URIs. A preview reads only its sample's
images and embeds them as `data:` URIs. A generation batch sends each distinct
image once as a Gotenberg form file named `asset-<sha256>.<ext>` (the content
hash and the verified type, nothing the school wrote) next to `index.html`, and
the documents reference that name: the logo travels once per batch, each photo
once. Templates are unchanged.

Security (the second deliberate exception after question papers'
`font-src data:`): in HTML converted with assets, the sanitiser keeps an
`<img src>` only when it is a raster `data:` URI or exactly one of the batch's
generated names (`documentSanitizerOptions`); any other relative path,
`http(s):` or `file:` URL is removed with its element. The CSP of that HTML adds
`'self'` to `img-src` and nothing else, because the asset files load from
Gotenberg's request directory. The policy cannot name files, so **the code is
the boundary for CSS too** (`document.css.ts`, every document render, previews
included): in `<style>` text and `style=""` attributes a declaration survives
only when every `url(...)` / `image-set(...)` target is a raster `data:` image or
one of the batch's exact asset names (none in a preview); a loading function
written with any backslash (an escaped quote or parenthesis could make the
checker read another target than Chromium) and an at-rule with a backslash in
its name or prelude (`@i\mport`) are removed; a value that loads anything and
also uses `var()`, `env()` or `attr()` is removed (the browser substitutes them
after the check); every `image-set()` candidate must be a literal `url()` or
string whose target passes, and a loading function with no target read is
refused; `@import`, `image()`,
`cross-fade()`, `element()`, `paint()` and `src()` are removed, CSS escapes are
decoded before checking, and CSS that does not parse is dropped. An SVG `data:`
URI in CSS is therefore removed, as it is in `<img src>`. Previews never get this policy, question
papers never get it, and image limits stay: 5 MB per image, 20 MB of images per
batch.

## History and downloads

History is one session-wide list of PDFs, preceded by the session's generation
jobs that are still running or failed in the last seven days. It may accept backend filters for contextual API
consumers, but the main UI does not require a document-type choice before showing
records. Each record should expose its type, creation time, source summary, status,
and template name when available.

Never persist signed URLs or raw object keys in client state. `getDocumentDownload`
authorizes the current user and returns a fresh five-minute URL. Only ready PDF
artifacts are downloadable. Template artifacts are not downloadable or deletable
through the PDF history procedures.

## Validation and verification

Run the checks proportional to the layer changed:

```sh
pnpm --filter management check-types
pnpm --filter @campuspilot/components check-types
pnpm --filter @campuspilot/components exec vitest run src/documents/template-prompt.test.ts
pnpm --filter @campuspilot/api test
pnpm --filter @campuspilot/opa check
pnpm --filter @campuspilot/opa test:integration
pnpm check-types
```

API integration tests require PostgreSQL, Redis, OPA, RustFS, Gotenberg, and a
working container runtime. Report an unavailable Testcontainers runtime as an
environment block, not as a passing test and not as a source failure.

Browser verification must cover:

- Documents with configured and missing templates;
- every document card and its required fields;
- timetable generation without any classroom selector;
- unified empty and populated history;
- Settings empty state, read-only PDF preview, the builder's resizable split, fold and
  unfold, AI and Code tabs, dirty navigation, PDF preview (and its refused-template
  error), save, reload, the AI dialog (no assistant) and the assistant's drafts
  (assistant), a draft held while you typed after sending (*Replace my edits*), New
  chat with a shown draft, revision select, history dialog, read-only revision and
  Restore (with and without unsaved changes), an unknown `?revision=`;
- marketplace type and design tabs (scrolling at 390 px; arrow keys move focus
  without converting), the selected design's PDF, the full-screen preview (deep link,
  close, Back closes it, focus back on *Preview*, Use template from it), the old
  `/:documentType/:slug` redirect, a design no longer listed, active state, import
  conflict/error state;
- desktop, 390 px, and the application minimum of 320 px;
- page-level overflow, keyboard access, focus labels, permission-gated actions,
  iframe output, and console errors.

Use the isolated harness in [`docs/local-document-preview.md`](local-document-preview.md)
when changing rendering or generation. Do not mutate a shared development school's
template merely to prove that an import button is clickable.

## Common wrong turns

- Do not put template cards, a template dropdown, or source editing back into the
  session Documents workspace.
- Do not make Preview mutate the selected template or create an artifact.
- Do not overwrite S3 objects or existing artifact rows.
- Do not use a frontend permission component as the authorization boundary.
- Do not pass live tenant data into marketplace or editor sample previews.
- Do not add `classId` to timetable generation.
- Do not silently call an AI provider from the portable Edit with AI dialog; the
  in-app assistant is the only AI path, behind its own gate.
- Do not let the assistant save a template from the editor's chat, and do not store
  its drafts: the person saves through Save template.
- Do not weaken iframe sandboxing, sanitization, CSP, or Gotenberg network rules to
  accommodate a marketplace design.
- Do not infer grades, attendance, approvals, registration, class membership, or
  session relationships from a neighboring field.
- Do not claim visual verification from type checks alone.
