# School documents and artifacts

The cross-layer architecture, route ownership, UI state model, extension
checklists, and LLM-facing template guidance live in the canonical
[Document system guide](../../../../../../docs/document-system.md). This README is
the backend contract for data, persistence, rendering, and authorization.

## Backend source map

| File | Responsibility |
| --- | --- |
| `document.dto.ts` | Strict request/output schemas and the discriminated document-source union |
| `document.router.ts` | oRPC procedures, authorization composition, template selection, generation, history, and deletion |
| `document.context.ts` | Independently validates source relationships and builds the explicit Handlebars context |
| `document.catalog.ts` | Server-owned marketplace source, synthetic preview context, and user-facing variable reference |
| `document.render.ts` | Handlebars restrictions, sanitization, batch layout, and Gotenberg conversion |
| `document.storage.ts` | Immutable S3 persistence, image validation/embedding, and compensation |
| `document.router.integration.test.ts` | Procedure, authorization, persistence, conflict, storage, and artifact lifecycle coverage |
| `document-exam.integration.test.ts` | Examination context, approval, schedule, rendering, PDF size/page, and legacy compatibility coverage |
| `finance-document.context.ts` | Immutable bill, payment/refund receipt, and cutoff statement contexts |
| `finance-document.integration.test.ts` | Finance history, authorization, cutoff, and historical-regeneration coverage |

Keep API operations in this package and expose them through the school router.
Binary conversion and object storage remain server concerns; the management app
uses normal typed oRPC calls and never receives raw S3 keys.

Documents are available at `/school/:schoolId/sessions/:sessionId/documents` in management. This operational workspace creates PDFs and shows history only. School template settings own editing, while `/school/:schoolId/marketplace/templates` owns browsing, previews, and imports. Exam workspaces link directly to report cards, admit cards, and timetable exports with the exam preselected.

## Supported documents

- Report cards combine all active/completed subject plans for one class or the whole examination. Every included student must have an approved result in every included plan. The default UI policy excludes incomplete/unapproved students with an explicit warning; strict mode rejects the batch. Explicitly selected students always require complete approval. Ready examinations cannot export results; active, completed and historical examinations remain available. Missing marks never become zero marks. Grades use the session's explicit thresholds; no matching grade renders as an em dash.
- Student ID cards use session enrollment plus admission identity/photo data, imposed as 86 × 54 mm cards on A4 sheets.
- Admit cards can target one student, one class or every class in the examination plan. Each card includes student identity and that student's class schedule. Missing class schedules produce explicit preview warnings.
- Timetables always render every scheduled classroom, with all subjects in a shared slot preserved, on landscape A4. The API rejects a class-scoped timetable source.
- Bills render posted bill and line snapshots, including complete billing-run
  exports read in bounded database chunks. Receipts render a payment or refund
  from the payment's posting-time identity/session snapshot and label returned
  funds explicitly. Statements derive currency and IANA time zone from the
  selected session configuration, validate the local through-date, and use
  posting-time ledger identity plus per-admission high-water sequences protected
  by the preview review hash. Statement rows show the current month's opening
  balance, period activity, human document references, and closing balance.

Exports support a whole examination, one class, or up to 500 explicitly selected students. Every export is limited to 500 students. Historical sessions remain exportable. Only registered admissions are eligible. Session, class, exam, student, and tenant relationships are validated independently.

Root attendance and co-scholastic areas use the explicit exam-wide assessment and working-day settings. Printing configured assessments requires their independent approval. Zero attendance remains zero; missing data remains null. Legacy per-subject values remain available only under each subject and are never promoted to shared facts. Four explicit print options control mode marks, attendance, co-scholastic areas and the grading key, without changing saved results or calculations. Hidden attendance does not require working-day configuration.

The context retains v1 report fields, heterogeneous subject modes and grade thresholds. Timetables expose both modern entries and legacy `rows[].cells[classId]` (single cell, array or null), plus calendar-safe display dates, weekdays and times. The numeric `add` helper supports existing table column spans.

## Persistence

`artifact` stores a unique S3 key, kind, document type, SHA-256, byte size, creator, explicit source identifiers, and the exact template revision used for a PDF, plus report-section choices and approval policy. HTML and PDF bytes remain in S3. Source identifiers are historical values rather than cascading foreign keys, so a generated document survives source enrollment/session removal.

`school_document_template` selects one immutable template artifact per school and document type. Marketplace selection copies server-owned source to a school-specific object. Saving a custom design creates another object and artifact; it never overwrites old HTML or PDFs. The client must supply `expectedRevisionId` (`null` for the first selection). A non-key tenant-row lock serializes selections without deadlocking concurrent artifact foreign-key inserts. A losing save removes its unused S3 upload and returns `CONFLICT`.

The selected revision is checked when an export begins. A later template change does not alter an export already using that revision. History resolves the template's human-readable name through its immutable revision.

Uploads are compensated if their database transaction fails. A simultaneous storage failure during compensation is surfaced as an infrastructure failure; object-store lifecycle/reconciliation should handle objects left by process termination or storage outages. S3 and PostgreSQL do not share a transaction.

Deleting a PDF first records `deleting`, removes its object, then removes its row. Storage failure leaves a visible, retryable record and disables downloads. Template revisions are retained for provenance. Only PDFs can be deleted through this API. Downloads are authorized before issuing a fresh five-minute signed URL; signed URLs and raw S3 keys are not stored in the frontend history cache.

## Template editing and portable prompts

The server-owned marketplace contains modern, classic, minimal, and logo-forward crest starting points for all four document types. Source and branded sample previews are available through normal oRPC procedures. `document.catalog.ts` defines the variable reference and synthetic preview data.

Template editing uses TanStack Form, field-level Zod errors, explicit preview/save actions, and a callback-ref navigation guard. Users describe their edits and copy a context prompt, the latest unsaved HTML, or both together into their own AI application. The brief includes the document's print dimensions, rendering constraints, and server-owned variable reference. Returned HTML is pasted into the existing source editor, previewed, and explicitly saved as a new revision. Clipboard failures leave a selectable full prompt for manual copying.

There is no integrated AI provider, provider configuration, SDK, AI permission, or AI endpoint. Building/copying the brief stays in the browser and sends no request to a model provider.

## Rendering and deployment

Existing `S3_*` and `GOTENBERG_URL` settings are reused. Server startup applies the
document migrations through the existing migration runner, including
`0021_finance-documents.sql` for finance sources and payment snapshots. Deploy the
migrations with the server before using document generation.

Sanitized HTML is wrapped in a restrictive CSP and displayed in an empty-sandbox iframe. School and student images are read directly from S3, validated, and embedded as raster data URIs. External assets, scripts, forms, navigation attributes, and prototype access are unavailable. The dev/test Gotenberg service disables JavaScript and both private/public outbound network access. Apply the same Chromium flags in hosted Gotenberg deployments:

```dotenv
CHROMIUM_DISABLE_JAVASCRIPT=true
CHROMIUM_DENY_PRIVATE_IPS=true
CHROMIUM_DENY_PUBLIC_IPS=true
```

Limits: 200 KB template source, 4,000-character editing instructions, 500 selected students, 5 MB per image, 20 MB embedded images, 25 MB rendered HTML, 30 MB resulting PDF. Conversion times out after 120 seconds. Large classes can use explicit student selections to create smaller batches.

Gotenberg's multipart HTML route and data-URI support: https://gotenberg.dev/docs/convert-with-chromium/convert-html-to-pdf
Outbound filtering configuration: https://gotenberg.dev/docs/configuration

## Authorization

Academic and finance document actions are distinct. Principals, managers, and
accountants have full finance template/generation/history/deletion access. Platform
administrators can read finance templates and artifacts but cannot generate,
mutate templates, or delete. Teachers and exam coordinators receive no finance
document access. Finance routes inspect the requested or persisted document type
before applying these grants; generic academic history excludes finance artifacts.

Generation also requires independent source-domain read permissions. UI entry points check the corresponding export and selector permissions before mounting queries. The backend remains the authorization boundary. Shared system policy rejects school-vocabulary roles paired with malformed platform scope.

## Verification

```sh
pnpm --filter @campuspilot/api test
pnpm --filter @campuspilot/opa check
pnpm --filter @campuspilot/opa test:integration
pnpm check-types
pnpm --filter @campuspilot/api exec tsc --noEmit
```

Document integration tests run real PostgreSQL, Redis, OPA, MinIO, and Gotenberg. Tests cover every procedure's authentication/tenant boundaries, validation, state persistence, missing data, approval requirements, signed downloads, immutable revisions, simultaneous saves, conversion/upload failure, interrupted deletion/retry, and PDF page counts and dimensions. Rego and OPA integration tests cover grants and malformed role/scope combinations.

Classroom summaries accept an explicit session ID for enrollment counts. Omitting it returns `null`; they do not infer the active session. Registration status is independent of class membership. Document recipient selection uses a searchable, paginated multi-select combobox and retains explicit selections across searches.
