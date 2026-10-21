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
| `/school/:schoolId/sessions/:sessionId/billing/documents` | Compatibility redirect to session-wide document history |
| `/school/:schoolId/marketplace/templates?type=:documentType` | Marketplace filtered to one document type |
| `/school/:schoolId/marketplace/templates/:documentType/:slug` | Dedicated marketplace preview and import action |

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
   settings, explicit preview, generation, download, and history workflow. A
   contextual URL opens the corresponding dialog with its examination, class, or
   student preselected.
4. The dialog requests the active school template and the independent source-domain
   data it needs only after the type-specific permission gate succeeds.
5. If the template is missing, generation stays unavailable. An inline explanation
   describes the dependency, while the shell warning provides the authorized path
   to Settings.
6. Preview validates and renders the current choices without writing an artifact.
7. Generate converts the same authorized context to PDF and stores it. The dialog
   then offers a fresh authorized download and a link to unified history.

The bill dialog searches and pages posted billing runs, displays the run period,
billing date, bill count, amount, and state, and rejects empty or non-posted runs.
Fully reversed runs remain selectable because bill documents reproduce immutable
original postings; the reversal state remains visible. A run source always
previews and generates the complete immutable run by
`billRunId`. The receipt dialog keeps non-reversed payment selections across search
pages up to the 500-source API limit. Both preserve the current session in their
source and require the current selection to be previewed before creation. The
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

1. The marketplace opens with one document type selected.
2. Cards show every server-owned design for that type.
3. Preview navigates to a dedicated page and renders synthetic data in the same
   sanitized iframe used by the editor.
4. Use template sends the catalog slug and `expectedRevisionId`.
5. The server copies the catalog source to a new immutable, school-owned S3 object,
   creates an artifact row, and atomically selects that revision.
6. A stale `expectedRevisionId` returns `CONFLICT`; the client must reload instead
   of overwriting another person's change.

Never treat marketplace source as the active school template directly. Importing a
copy is what provides school ownership, provenance, and stable historical output.

### Edit a school template

When no revision is selected, Settings shows a focused blank state with one Browse
marketplace action. It does not render a disabled or empty source editor.

When a revision exists, an authorized editor sees:

- Edit with AI and Marketplace as peer actions in the header;
- one integrated, resizable workspace with an explicit collapse/expand control for
  the source panel on the left at wide widths and first in the stack on smaller
  screens;
- the template name and a Monaco Handlebars/HTML code editor with formatting,
  syntax highlighting, line numbers, wrapping, and theme support;
- for admit cards, bills, receipts, and statements, an explicit paper footprint:
  half A4 (two documents per physical sheet) or full A4 (one per sheet);
- Save template and Reload saved revision actions;
- a collapsible variable reference;
- a sanitized sample preview on the right at wide widths and second in the stack
  on smaller screens, with scrollable and A4-page modes plus a manual refresh.

Draft name and source remain local until Save. Source edits request a debounced
sample render; the manual refresh bypasses that delay. Preview requests are
versioned so an older, slower response cannot replace a newer draft. Preview never
saves or selects a revision. Saving creates a new immutable object and makes it
active. A keyed editor adopts the newly selected revision only after the query
cache refreshes. Dirty navigation uses the application dialog and browser
`beforeunload` fallback; it must not use `window.confirm`.

The code editor is dynamically loaded in a client-only boundary because Monaco
depends on browser APIs and is unnecessary for empty or read-only states. The
preview stays in an empty-sandbox iframe. A4 mode uses portrait A4 for report
cards and finance documents, shows half-A4 revisions in their two-up sheet
placement, imposes student IDs on portrait A4, and uses landscape A4 for
timetables; scrollable mode lets the rendered document use the full preview pane.

Read-only users see the selected template preview but no source mutation controls.

### Edit with an external AI application

The AI helper is intentionally provider-neutral:

1. The user enters an instruction in a dialog.
2. CampusPilot constructs a prompt containing the print constraints, variable
   reference, safety rules, and current unsaved source.
3. The user copies the instructions, source, or combined prompt.
4. The user works in an external tool and pastes the result back into the editor.
5. CampusPilot previews and saves only through the normal explicit actions.

No AI provider, SDK, key, endpoint, or server request is involved. Never imply that
CampusPilot sent the school's template or instructions to another service.

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
| `DocumentTemplates` | Empty state, read-only preview, or authorized school-template editor |
| `TemplateCodeEditor` | Client-only Monaco wrapper and source-format action |
| `TemplatePromptEditor` | Local portable-prompt dialog and clipboard operations |
| `DocumentTemplateMarketplace` | Document-type selection and catalog cards |
| `DocumentTemplateMarketplaceDetail` | Contextual catalog preview and import action |
| `DocumentKindCards` | API-free accessible visual radiogroup shared by Documents and Marketplace |
| `DocumentPreview` | Restrictive empty-sandbox iframe for already sanitized HTML |

All user input and submission state uses TanStack Form with Zod validators. Do not
introduce standalone `useState` or `useEffect` for these workflows. Derive selected
values with `form.Subscribe`, use keyed component lifecycles for revision changes,
and use TanStack Query invalidation/refetching for server state.

## API procedures and permission boundaries

Frontend permission gates control visibility only. Every procedure enforces the
same boundary through server middleware.

| Procedure | Purpose | School action |
| --- | --- | --- |
| `listMarketplaceTemplates` | Paginated catalog metadata for one type | `READ_DOCUMENT_TEMPLATES` |
| `getMarketplaceTemplate` | Catalog source, context reference, and sample preview | `READ_DOCUMENT_TEMPLATES` |
| `getActiveDocumentTemplate` | Current immutable school revision or `null` | `READ_DOCUMENT_TEMPLATES` |
| `selectMarketplaceTemplate` | Import and select a catalog design | `MANAGE_DOCUMENT_TEMPLATES` |
| `saveDocumentTemplate` | Save and select a custom revision | `MANAGE_DOCUMENT_TEMPLATES` |
| `previewDocumentTemplate` | Render source with synthetic data; also powers read-only selected-template previews | `READ_DOCUMENT_TEMPLATES` |
| `previewDocument` | Render authorized data without persistence | Academic: `GENERATE_DOCUMENTS`; finance: `GENERATE_FINANCE_DOCUMENTS` |
| `generateDocument` | Render, convert, persist, and return a PDF artifact | Academic: `GENERATE_DOCUMENTS`; finance: `GENERATE_FINANCE_DOCUMENTS` |
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
and statements. Report cards remain full portrait A4, timetables remain full
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
`timetable`, `bill`, `receipt`, and `statement`. Their source DTOs are a strict discriminated union. Do not add optional
fields to a common base merely because two types happen to use the same value today.

- Report cards can target a complete examination, one class, or up to 500 explicit
  students within one class. Approval policy and four independent print flags are
  recorded.
- Student IDs use enrollment plus admission identity and photo data.
- Admit cards can target every examination class, one class, or explicit students
  within a class. Each card combines identity with that student's class schedule.
- Timetables are examination-wide. Their source contains only school/session,
  document type, and examination slug. It never accepts `classId`.
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
  subject/mode in a shared slot.

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
`lookup`, plus the finite-numeric `add` helper. Prototype access is disabled.
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
| Student documents | `student.{name,admissionNo,rollNo,className,sectionName,dob,fatherName,motherName,address,phoneNo,photoUrl}` |
| Report cards | `subjects[]`, totals, overall percentage/grade, grading scale, attendance, co-scholastic data, approval/configuration flags, and independent report-section flags |
| Admit cards | `timetable[]` entries for the student's class with ISO/display date, weekday, raw/display time, subject, and mode |
| Timetables | `columns[]` plus `rows[]`; every row has ordered `entries[]` matching columns and a legacy keyed `cells` object |

Important shapes and semantics:

- `subjects[]` includes `slug`, `name`, `marks[modeSlug]`,
  `modeConfig[modeSlug].{name,percentage,maxMarks}`, `total`, `totalMarks`,
  `percentage`, and `grade`.
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
- Image values are embedded data URIs or `null`. Templates must guard them with
  `{{#if ...}}`; they must never construct or fetch an external URL.

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
8. Check marketplace list and detail pages at desktop, 390 px, and 320 px.

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

## History and downloads

History is one session-wide list. It may accept backend filters for contextual API
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

API integration tests require PostgreSQL, Redis, OPA, MinIO, Gotenberg, and a
working container runtime. Report an unavailable Testcontainers runtime as an
environment block, not as a passing test and not as a source failure.

Browser verification must cover:

- Documents with configured and missing templates;
- every document card and its required fields;
- timetable generation without any classroom selector;
- unified empty and populated history;
- Settings empty state, read-only preview, editable split view, collapse behavior,
  dirty navigation, preview, save, reload, and AI dialog;
- marketplace list, dedicated preview, active state, import conflict/error state;
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
- Do not silently call an AI provider from Edit with AI.
- Do not weaken iframe sandboxing, sanitization, CSP, or Gotenberg network rules to
  accommodate a marketplace design.
- Do not infer grades, attendance, approvals, registration, class membership, or
  session relationships from a neighboring field.
- Do not claim visual verification from type checks alone.
