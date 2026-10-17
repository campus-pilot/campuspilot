# School documents and artifacts

Documents are available at `/school/:schoolId/sessions/:sessionId/documents` in management. The existing examination, ID-card, admit-card, and timetable template settings pages use the same marketplace and editor. Exam workspaces link directly to report cards, admit cards, and timetable exports with the exam preselected.

## Supported documents

- Report cards combine all active/completed subject plans for one class and exam. Every included student must have an approved result in every included plan. Missing marks never become zero marks. Grades use the session's explicit thresholds; no matching grade renders as an em dash.
- Student ID cards use session enrollment plus admission identity/photo data, imposed as 86 × 54 mm cards on A4 sheets.
- Admit cards include student identity and that class's optional exam schedule. Missing schedules produce an explicit preview warning.
- Timetables render all scheduled classes or one selected class, with all subjects in a shared slot preserved, on landscape A4.

Exports support a whole class or up to 500 explicitly selected students. Historical sessions remain exportable. Only registered admissions are eligible. Session, class, exam, student, and tenant relationships are validated independently.

Attendance and co-scholastic assessments are per-subject facts in this app. Each subject exposes its own assessment; the renderer does not choose the first available result as a school-wide assessment. This deliberately fixes the ambiguous aggregation in v1.

## Persistence

`artifact` stores a unique S3 key, kind, document type, SHA-256, byte size, creator, explicit source identifiers, and the exact template revision used for a PDF. HTML and PDF bytes remain in S3. Source identifiers are historical values rather than cascading foreign keys, so a generated document survives source enrollment/session removal.

`school_document_template` selects one immutable template artifact per school and document type. Marketplace selection copies server-owned source to a school-specific object. Saving a custom design creates another object and artifact; it never overwrites old HTML or PDFs. The client must supply `expectedRevisionId` (`null` for the first selection). A non-key tenant-row lock serializes selections without deadlocking concurrent artifact foreign-key inserts. A losing save removes its unused S3 upload and returns `CONFLICT`.

The selected revision is checked when an export begins. A later template change does not alter an export already using that revision. History resolves the template's human-readable name through its immutable revision.

Uploads are compensated if their database transaction fails. A simultaneous storage failure during compensation is surfaced as an infrastructure failure; object-store lifecycle/reconciliation should handle objects left by process termination or storage outages. S3 and PostgreSQL do not share a transaction.

Deleting a PDF first records `deleting`, removes its object, then removes its row. Storage failure leaves a visible, retryable record and disables downloads. Template revisions are retained for provenance. Only PDFs can be deleted through this API. Downloads are authorized before issuing a fresh five-minute signed URL; signed URLs and raw S3 keys are not stored in the frontend history cache.

## Template editing and portable prompts

The server-owned marketplace contains modern and classic starting points for all four document types. Source and sample previews are available through normal oRPC procedures. `document.catalog.ts` defines the variable reference and synthetic preview data.

Template editing uses TanStack Form, field-level Zod errors, explicit preview/save actions, and a callback-ref navigation guard. Users describe their edits and copy a context prompt, the latest unsaved HTML, or both together into their own AI application. The brief includes the document's print dimensions, rendering constraints, and server-owned variable reference. Returned HTML is pasted into the existing source editor, previewed, and explicitly saved as a new revision. Clipboard failures leave a selectable full prompt for manual copying.

There is no integrated AI provider, provider configuration, SDK, AI permission, or AI endpoint. Building/copying the brief stays in the browser and sends no request to a model provider.

## Rendering and deployment

Existing `S3_*` and `GOTENBERG_URL` settings are reused. Server startup applies migration `0015_document-artifacts.sql` through the existing migration runner. Deploy the migration with the server before using the management Documents page.

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

New school actions separately cover template reading/management, generation, history/download reading, and deletion. Principals, managers, and exam coordinators manage/generate/delete. School staff may read templates and PDF history. Platform administrators receive no implicit document grant.

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
