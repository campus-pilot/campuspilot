# Templates, generated documents, and object-storage migration contract

## Scope and governing model

This contract covers school logos insofar as they share the object inventory,
active Handlebars templates, intentionally omitted generated PDFs, artifact rows,
legacy marketplace content, and the target
`artifact`/`school_document_template` lifecycle. Finance document facts also
follow [finance.md](finance.md).

CampusPilot's canonical runtime contract is `docs/document-system.md`. Target
templates and PDFs are immutable objects. A template revision is selected through
`school_document_template`; changing that pointer never edits an old revision.
Legacy template and generated-PDF keys were deterministic caches that could be
overwritten in place. For this one-time migration, active template/logo keys are
verified at the frozen cutoff and retained exactly; CampusPilot must not overwrite
them, and later edits create normal new immutable target revisions.

Student/admission photos are out of scope. Template validation uses null-photo
sample cases and must not require a migrated student image.

## Complete object inventory

For school logos, active non-notice templates, and other in-scope objects, the
frozen source manifest must list:

- the production bucket identity without credentials;
- object key and version ID when object versioning exposes one;
- database owner row/table and every row that refers to the key;
- content type, content length, ETag, last-modified time, and downloaded SHA-256;
- result of file-signature/MIME validation;
- terminal disposition and exact retained key when referenced;
- whether the object is missing, duplicated, unreferenced, or referenced across
  tenants.

List actual distinct legacy `artifact.type`, `entityType`, `scope`, and content
types from the frozen database. Do not rely on the stale legacy Zod enum: runtime
writes include values such as `bulk_admitcard_pdf`, `exam_timetable_pdf`, and
`entityType="student"` that the enum does not fully describe.

Generated PDFs, notice objects, and admission photos follow their explicit
count-only omission policies and are not downloaded or hashed. Unreferenced
in-scope objects are reported, not copied or deleted by default. Never scan or
delete a whole prefix as rollback.

## Template type mapping

| Legacy artifact type | Target document type | Target page footprint |
| --- | --- | --- |
| `examination_template` | `report_card` | `full` |
| `idcard_template` | `id_card` | `full` (target renderer owns card imposition) |
| `admitcard_template` | `admit_card` | legacy default/two-up is `half`; otherwise preserve explicit `half` or `full` source metadata |
| `timetable_template` | `timetable` | `full`, landscape renderer |
| `bill_template` | `bill` | legacy `meta.size` after validation |
| `receipt_template` | `receipt` | legacy `meta.size` after validation |
| `notice_template` | no destination | intentionally omit under `legacy-only.md` |
| no source equivalent | `statement` | leave unconfigured |

Legacy active keys normally are:

```text
templates/{schoolId}/active.hbs
templates/{schoolId}/idcard-active.hbs
templates/{schoolId}/admitcard-active.hbs
templates/{schoolId}/timetable-active.hbs
templates/{schoolId}/bill-active.hbs
templates/{schoolId}/receipt-active.hbs
templates/{schoolId}/notice-active.hbs
```

Do not assume one row per active type. PostgreSQL uniqueness with nullable
`scope` may permit multiple rows where `scope IS NULL`. Report duplicates and
require an explicit winner or source correction. “Latest updated” is not an
authorized winner rule.

## Built-in marketplace templates

The target repository already contains a faithful snapshot of the legacy static
catalog in `document.catalog.legacy.ts` and adaptations in
`document.catalog.marketplace.ts`. The bundled files under the old app's
`public/templates` are application assets, not production school data, and do
not need to be copied from the production bucket.

For each active school template, read the exact source bytes, compute SHA-256,
and validate them through the target renderer. The migration keeps
`marketplaceSlug=null` because it preserves source bytes rather than substituting
the repository's adapted marketplace content. Template name, S3 key, or visual
resemblance never proves marketplace provenance.

## Custom template validation

The migration does not transform or upload custom template bytes. Each accepted
active template retains its exact verified legacy key, checksum, byte size, and
MIME type in the shared bucket. CampusPilot:

- uses a restricted Handlebars instance and finite-numeric `add` helper;
- blocks prototype access;
- sanitizes HTML and applies a restrictive CSP;
- embeds validated PNG/JPEG/WebP images as data URIs;
- disables public/private network access and JavaScript in Gotenberg;
- owns physical page imposition outside the template;
- caps template source at 200 KB, embedded HTML at 25 MB, PDF at 30 MB, and
  conversion at 120 seconds;
- has explicit current contexts for report cards, ID cards, admit cards,
  timetables, bills, receipts, and statements.

The dry run compiles and renders the exact source bytes with the target
restrictions and sanitized synthetic context. It validates page size, expected
document type, logo/null-photo behavior, PDF page count and dimensions. Any
unsupported helper, path, external asset, unsafe markup, or render failure is a
blocking exception. The importer does not rewrite a failing template.

### Page-size rules

- report cards: full portrait A4;
- ID cards: target 86 x 54 mm imposition on portrait A4, template page size
  recorded as full;
- timetables: full landscape A4 and examination-wide;
- admit cards: both half and full are supported; legacy default/two-up maps to
  half, while a custom revision preserves explicit source footprint metadata;
- bills/receipts: validate legacy `artifact.meta.size`; missing/invalid metadata
  is a decision, not a reason to inspect CSS and guess;
- statements: no legacy revision exists; leave target selection unconfigured.

## Target template write protocol

For each accepted active template:

1. preserve the source template artifact ID exactly after validating its `art_`
   shape and confirming the target is empty;
2. retain the exact source S3 key and manifest checksum/byte-size/MIME;
3. read and validate the object without writing it;
4. insert `artifact(kind="template", status="ready", documentType, name,
   pageSize, marketplaceSlug, createdBy, createdAt)`;
5. insert/update one `school_document_template` selection pointer.

`createdBy` requires an approved mapped user or a documented migration service
identity. It is not acceptable to invent a staff user or use the first principal.
Legacy `createdAt` may be retained only if authoritative; otherwise use migration
time and preserve the unknown source time in the external manifest.

The current target schema has no general source-system/source-table/source-key
provenance column. Until one is added, the checksum-bound migration manifest keyed by
target artifact ID is mandatory.

## Generated PDFs

All legacy generated-PDF artifact rows and objects are intentionally omitted,
including result/report-card, ID-card, admit-card, timetable, bill, receipt, and
any notice PDF variants. Discovery records only counts grouped by school and
type so the disposition can be reconciled; it does not download, archive, copy,
or hash PDF bytes.

CampusPilot treats generated artifacts as reproducible cache. After facts and
active templates are migrated, a user download creates a fresh target PDF and
artifact row. It has a new target identity and creation time and is never labeled
as the legacy original. Template rows and template bytes remain in scope.

## School logos and other media

School logos retain their exact shared-bucket key. Validate actual signatures
against the target PNG rule and 5 MiB limit. Any other format is blocked; the
importer does not rasterize or change the file extension.

Provider `user.image` URLs are auth metadata, not object keys, and are omitted
under tracked I-10. Admission photos are intentionally omitted. If any other
production object family is discovered, add a source contract and disposition;
this importer never copies it.

## Required exception reports

- missing, corrupt, oversized, or MIME-mismatched objects;
- unreferenced objects and database rows with missing objects;
- duplicate active template rows;
- unknown artifact/entity/scope/content types;
- exact built-in matches versus custom sources;
- unsupported helpers, variables, tags, assets, or renderer behavior;
- absent/invalid page-size metadata and custom admit-card decisions;
- template preview/PDF/visual failures;
- generated-PDF types outside the known count-only omission policy;
- unknown creator for an in-scope template revision;
- unexpected key reuse or changed object metadata;
- non-PNG logos or other unsupported images;
- unexpected notice/template data outside the approved omission policy.

## Reconciliation and acceptance

Reconcile per school and document type:

- source template rows/objects versus one selected target revision or exception;
- exact source/retained-object checksums;
- generated artifact row/object counts and `intentionally_omitted` dispositions;
- missing/unreferenced/duplicate object counts;
- active target selection pointers and object read-back checks.

Acceptance requires authenticated preview and generation of every migrated
template type at desktop and narrow mobile layouts, plus actual PDF page size and
count verification. Test report-card flags, null photos, timetable multi-cells,
admit-card schedules, finance snapshots, half/full imposition, and unauthorized
access. Verify that no legacy generated-PDF row/object appears in the target and
that a fresh download generates a valid target artifact.

## Source references and anti-pattern guards

Use:

- `../school-app/db/schema.ts`
- `../school-app/packages/orpc/modules/template`
- `../school-app/packages/orpc/modules/{resultRenderer,idCardRenderer,admitCardRenderer,examTimetable,billing}`
- `../school-app/public/templates`
- `docs/document-system.md`
- `packages/db/src/schema/artifact.ts`
- `packages/api/src/routers/school/document/README.md`
- `packages/api/src/routers/school/document/document.catalog.legacy.ts`
- `packages/api/src/routers/school/document/document.catalog.marketplace.ts`
- `packages/api/src/routers/school/document/document.render.ts`
- `packages/api/src/routers/school/document/document.storage.ts`

Do not copy built-in catalog assets as school data, compare templates by name,
mutate shared legacy keys, import legacy generated PDFs, infer page size from
CSS, or bypass target sanitization to accept a custom template.
