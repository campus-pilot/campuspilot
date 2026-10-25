# Legacy School app migration program

## Purpose and status

This directory is the planning contract for moving data from `../school-app`
into CampusPilot. It covers the current legacy database, object storage, and the
target schemas that exist in this repository as of 2026-10-22. These documents
do not authorize a production import and do not contain production credentials.

The first execution must be a production-source-to-local-target rehearsal. A
production cutover may happen only after the same versioned importer, mapping
bundle, and acceptance checks pass against that rehearsal. The legacy source is
always read-only.

The domain contracts are:

- [Identity, access, schools, and staff](identity-access.md)
- [Academic sessions, classrooms, and configuration](academic-structure.md)
- [Admissions and session enrollments](admissions-enrollments.md)
- [Examinations, results, assessments, and timetables](examinations-results.md)
- [Templates, generated documents, and object storage](documents-templates.md)
- [Finance](finance.md)
- [Legacy-only and deferred data](legacy-only.md)
- [Decision register](decisions.md)

The decision register is a gate, not optional reading. An unresolved blocking
decision prevents the affected domain from being imported.

## First migration-agent handoff

When credentials are supplied, the agent's first authorized action is discovery,
not import:

1. prove the legacy PostgreSQL credential is read-only and the object-store
   credential has only list/get access;
2. identify the source deployment commit/schema and create the frozen manifest;
3. identify the local target database and bucket and prove they are not
   production resources;
4. inspect target migration history and pre-existing data without changing it;
5. run the full dry run and produce decision/exception reports;
6. stop for approval of the mapping bundle and unresolved decisions;
7. import into local only after that approval;
8. run reconciliation and authenticated acceptance checks, then hand back the
   evidence before any production-target work is considered.

Credentials are passed through the authorized runtime secret mechanism. They are
never written into Git, mapping files, command history, screenshots, or reports.
The migration agent should receive this entire directory, not only one domain
document.

## Non-negotiable rules

1. Never mutate the legacy database or its object bucket.
2. Never infer a business fact from a field that merely correlates with it.
   Apply only the explicit migration defaults and transformations approved in
   [decisions.md](decisions.md); every conflict with those rules stops the
   affected scope for a user decision.
3. Never write into a target that has not had all CampusPilot schema migrations
   applied.
4. Never use the application startup migration runner to import legacy data.
5. Every accepted source row and object must have a deterministic disposition:
   imported, intentionally omitted, deferred, or blocked, with a reason.
6. Every target write must be idempotent. A second run of the same frozen
   manifest must create no additional rows or objects.
7. The approved rehearsal target is empty. Preserve every compatible source
   primary key verbatim. If the target is not empty or any ID/object collision
   exists, stop and ask the user; never truncate, merge, renumber, or overwrite.
8. Student/admission profile photographs are intentionally omitted under S-03.
   Inventory each non-null key as metadata-only evidence but do not download,
   copy, or populate `admission.photoS3Key`. School logos and active template
   objects retain their exact verified keys in the shared legacy bucket.
9. Credentials, password hashes, tokens, API keys, signed URLs, and raw object
   bytes must never appear in logs or committed reports. An approved compatible
   password hash may move directly from source to target through parameterized
   database writes, but must never be printed or serialized into audit output.
10. A type check or row-count match is not migration acceptance. The required
    reconciliation, authorization, object checksum, API, and authenticated UI
    checks must also pass.
11. The approved Prem Chandra snapshot contains exactly one password credential.
    Its owner must prove the existing password in a fresh target sign-in. Google
    sign-in is the fallback; the target has no configured email password-reset
    delivery flow.
12. Before a target write, every application and worker capable of writing the
    target must be stopped. The approval binds that operator-declared gate. The
    importer also holds an advisory lock and repeats target emptiness inside a
    serializable transaction immediately before business writes.
13. Approval is a deterministic checksum bundle, not a signature ceremony. It
    binds source dump/object/evidence/exception checksums, exact source history
    and table digests, source/target database identities, shared object-store
    identity, the typed decisions plus tracked documentation, importer
    commit/checksum, and exact retained object keys.
14. The target API login is never migration authority. Schema deployment and
    the importer uses the dedicated migration login assuming the
    non-login owner role; the API uses a non-owner runtime login with no DDL,
    trigger-control, temporary-schema, or migration-control-table access.

## Source and target inventory

The canonical source model is `../school-app/db/schema.ts` plus its Drizzle
migrations. The canonical target model is `packages/db/src/schema` plus
`packages/db/src/migrations`. Runtime code is consulted only to interpret JSON,
polymorphic artifact values, object-key conventions, and authorization behavior.

| Legacy source | CampusPilot destination | Contract |
| --- | --- | --- |
| `school` | `school` | identity-access; academic structure; finance |
| `school_onboarding` | intentionally omitted; target onboarding defaults remain | legacy-only |
| `school_session` | `school_session` | academic structure; finance |
| `class`, `section` | `class`, `section` | academic structure |
| `admission`, `student` | `admission`, `student` | admissions/enrollments |
| `staff` | `user`, `school_member`, `school_user_role` | identity/access |
| approved staff `user` and compatible password `account` | `user` and credential `account` with target local issuer | identity/access |
| OAuth provider `account` rows and tokens | intentionally omitted; relink in target | identity/access |
| `session`, `verification`, `apikey` | intentionally omitted; all users sign in again | identity/access; legacy-only |
| `exam_plan`, `exam_result`, `exam_timetable` | like-named tables plus approved lifecycle/assessment transforms | examinations/results |
| template `artifact` rows/objects | `artifact`, `school_document_template`, target object bucket | documents/templates; finance |
| generated-PDF `artifact` rows/objects | intentionally omitted; regenerate in CampusPilot | documents/templates; finance |
| `bill_generation_event`, `student_bill_event`, `ledger_event` | immutable finance facts | finance |
| legacy finance projections | reconciliation input only | finance |
| `notice` and notice templates | intentionally omitted | legacy-only |
| `ai_usage`, `ai_quota` | intentionally omitted | legacy-only |
| onboarding and school feature flags | intentionally omitted | legacy-only |
| school default session defaults | no current one-to-one target | legacy-only; academic structure |

No table is silently ignored. A source table with no supported destination must
still be counted, exported to the audit archive if approved, and assigned an
explicit disposition.

## Implemented reuse surfaces and deliberate gaps

The tracked migration package uses the repository's actual contracts instead of
inventing look-alike APIs:

- `generateId` and `entityIdSchema` in `packages/db/src/id.ts` own target ID
  formats.
- Zod schemas in `packages/db/src/schema/jsonb` own session, class, examination,
  finance, role, document-option, and admission-document validation.
- `parseDecimalAmountToMinor` and
  `parseDecimalAmountToSafeMinorNumber` in
  `packages/api/src/routers/school/billing/money.ts` own exact operational money
  parsing for their documented ranges.
- `foldAdmissionLedger`, `rebuildAdmissionProjection`, and
  `reconcileAdmissionProjection` in
  `packages/api/src/routers/school/billing/reconciliation.ts` own target finance
  projection behavior.
- `renderDocument`, `combineDocuments`, and `convertDocumentPdf` in
  `packages/api/src/routers/school/document/document.render.ts` own target
  rendering and PDF conversion.
- `persistDocumentObject`, `readDocumentTemplate`, and
  `deleteDocumentObject` in
  `packages/api/src/routers/school/document/document.storage.ts` own immutable
  document object persistence and compensation.
- `DOCUMENT_MARKETPLACE` and its source file own the published target catalog.

There is no implemented legacy bulk-import endpoint, generic imported-artifact
provenance model, notice persistence API, student-portal link model, or public
finance projection-rebuild procedure. Normal CRUD/oRPC routes are not a bulk
historical-import interface: they enforce current workflow state and often cannot
preserve historical timestamps or incomplete facts. Before implementation,
extract any needed pure converter behind an exported, tested repository API;
do not deep-import a private helper or duplicate its behavior inside a one-off
script.

## Phase 0: freeze and discovery

### Tracked discovery entry points

`packages/legacy-migration` provides `inventory`, `snapshot`, and `dry-run` entry points for a
restored legacy snapshot and read-only source object credentials. They write
private content-addressed run artifacts outside the repository. The surrounding
operator preflight records the source cutoff and catalog fingerprint. `snapshot`
restores the supplied dump into one uniquely named database on an isolated
validation cluster, compares its complete Drizzle history and deterministic
table digests with the canonical restored source, records both PostgreSQL
runtime identities and cutoff facts, then drops only that validated temporary
database. Together, the evidence must include:

- source application commit/version and Drizzle journal/schema fingerprint;
- PostgreSQL server version, database identifier, transaction snapshot/cutoff,
  and the configured timezone without revealing connection details;
- row count, minimum/maximum primary key where meaningful, and deterministic
  digest for every source table;
- every in-scope template/logo object key, content type, byte size, ETag when
  meaningful, and a SHA-256 calculated from downloaded bytes; intentionally
  omitted PDFs/notices/photos receive count-only dispositions and are not
  downloaded;
- orphan and cross-tenant relationship reports;
- the target commit, migration list, database identity, and pre-import row/object
  inventory;
- importer commit/version and normalized mapping-bundle checksum.

Use a repeatable-read, read-only transaction or a database snapshot whose
consistency properties are documented. A sequence of unrelated live queries is
not a frozen source.

### Documentation references

- `../school-app/db/schema.ts`
- `../school-app/drizzle/meta/_journal.json`
- `packages/db/src/schema/index.ts`
- `packages/db/src/migrations`
- `docs/document-system.md`
- the domain documents in this directory

### Verification checklist

- The extractor's database role cannot `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`,
  `ALTER`, or write objects.
- Every legacy table in the inventory above appears in the manifest.
- Counts and digests are identical in two extracts from the same frozen snapshot.
- Missing objects and database rows that reference absent objects are reported.
- Reports contain redacted connection descriptions, never secrets.

### Anti-pattern guards

- Do not run extraction through normal paginated UI endpoints.
- Do not call a source update route to “normalize” bad data.
- Do not treat an object-store listing timestamp as a database cutoff.
- Do not use current target names or relationships to rewrite the source extract.

## Phase 1: mapping bundle and dry run

### Tracked dry run and checksum approval

The tracked `dry-run` entry point deterministically produces the mapping and
exception report from the typed policy and frozen evidence. A human reviews the
result and records the immutable checksum bundle. At minimum the mapping contains
for schools, users, staff roles, sessions, classes, sections, admissions,
students, examinations, finance slugs/currencies, object destinations, and every
operator decision named by [decisions.md](decisions.md).

Preserve every source primary key exactly. CampusPilot entity IDs retain their
documented prefix and 21-character lowercase suffix; `packages/db/src/id.ts`
uses the legacy examination prefixes `expl`, `exrs`, and `ett` so both
validation and newly generated post-migration IDs stay compatible. Legacy
Better Auth `user.id` and `account.id` are a separate contract: exactly 32
ASCII base62 characters (`A-Z`, `a-z`, `0-9`) with no CampusPilot prefix. The
mapping bundle still records source table/key to target table/key, but for
preserved entities the IDs are identical. Any invalid source ID, duplicate,
pre-existing target row, or object-key collision is blocking and must be shown
to the user; the importer never creates a replacement ID.

Legacy identifiers whose entities do not exist in the target, such as `stf_*`,
remain provenance only. A legacy staff ID must not be inserted where the target
requires a user ID; that relationship resolves through the preserved legacy
`user.id` after identity validation. Likewise, one legacy finance event can
produce several target ledger/bill/payment/adjustment rows. Decision G-14 binds
its exact source ID in the frozen manifest and derives every decomposed target
ID with the reviewed deterministic hash rule; malformed inputs or collisions
block.

The dry run performs every parse, normalization, uniqueness check, money
conversion, object download/checksum, and foreign-key resolution without writing
business rows. It outputs proposed target rows and exception reports in a format
that can be reviewed without database access.

### Documentation references

- `packages/db/src/id.ts`
- `packages/db/src/schema/jsonb`
- `packages/api/src/routers/school/document/document.dto.ts`
- `packages/api/src/routers/school/billing/money.ts`
- each domain contract's mapping and exception sections

### Verification checklist

- Every source row has one disposition and, when imported, one target identity.
- Every target foreign key resolves through the mapping bundle.
- Zod validation uses the actual target schemas; it is not duplicated loosely.
- Target natural-key collisions are reported before writes.
- A changed decision or mapping produces a different bundle checksum.
- Two dry runs over the same extract and mapping bundle are byte-for-byte stable
  apart from an explicitly separated run timestamp.

### Anti-pattern guards

- Do not match tenants by name, sessions by years alone, people by display name,
  or students by roll number.
- Do not trim, case-fold, suffix, or renumber identifiers without a reviewed
  mapping decision.
- Do not let database scan order determine IDs, ledger sequence, display order,
  or conflict winners.

## Phase 2: local rehearsal import

### Importer safety gates

The executable importer is fail-closed. It never writes objects. Before it
starts target row inserts, the operator must provide:

- `MIGRATION_TARGET_ENVIRONMENT`, set to the reviewed `local-rehearsal` or
  `production-campuspilot-plus` environment;
- `MIGRATION_ALLOWED_TARGET_DATABASES`, containing the exact non-secret
  `hostname:port/database` identity derived from `TARGET_DATABASE_URL`;
- the exact target database role, PostgreSQL system identifier, configured and
  actual endpoint, and TLS facts (TLS is mandatory for production);
- a live `kubectl` writer-fence check for the exact approved deployment set in
  its approved namespace, with desired/ready/available replicas all zero;
- a target whose complete ordered `drizzle.__drizzle_migrations` history exactly
  matches this checkout's journal and SQL hashes; and
- an entirely empty target application schema, plus the exact list of existing
  shared-bucket object keys that target rows may retain.

The source PostgreSQL reads run inside a repeatable-read, read-only transaction.
For production, the database name must be exactly `campuspilot-plus`. These gates
are independent: setting an environment label does not bypass the endpoint,
schema, or empty-target checks. Any target row—including authentication state—
blocks the import. Other tenants' objects may remain in the shared bucket. The
importer verifies exact source keys and metadata with read-only access and never
copies, overwrites, re-keys, or deletes an object.

`mapping.json` and `approval.json` are immutable reviewed inputs. Before any row
write, `mapping.json` must have `status="approved"` and
contain only the exact Prem Chandra school/session/class/section identities.
Its `decisionsRequired` and typed `decisionPolicy` must exactly equal the
code-defined canonical values; free-form operator text cannot change behavior.
`approval.json` must name the human approver and target environment, and bind the
SHA-256 checksums of `mapping.json`, the frozen source dump, source object
manifest, source evidence, exact-cutoff snapshot evidence, canonical exception
artifact, canonical decision set, source migration history/table digests, target
Drizzle migration-history digest, PostgreSQL runtime identity, Kubernetes writer
fence, tracked migration-document digest, and importer package, plus the full
importer Git commit. It also contains `targetObjectKeys`, the exact retained-key
allowlist, and the complete shared S3 bucket/region/endpoint/path-style identity.
No detached signature or signer configuration is used.

The importer normally rejects a reused run ID. Two executable exceptions are
bound to run `prem-20261025t090000z` and the approved Prem school. Recovery one
handles the existing pre-transaction legacy Better Auth ID validation failure:
it starts with retry count zero and matches the exact 32-character base62
auth-ID failure shape. Recovery two handles only the subsequent rolled-back
template-size defect with exact error `Cannot read properties of undefined
(reading 'byteLength')`: it starts with retry count one, requires the complete
valid first retry record with its exact original and replacement provenance,
and matches the exact known faulty importer,
approval, target-history, and combined tracked decision/documentation hashes.
The template failure timestamp is bound exactly to
`2026-10-25T10:01:03.478112+00:00` and is immutable while failed.
Each recovery timestamp must be strictly after its failure and prior retry.
Both preserve immutable source/snapshot/object/runtime/writer-fence facts and
require an empty target with no committed or audit effects. Each append-only
record binds the current failure plus prior and replacement executable
provenance. Retry count two is terminal; no third recovery or other failed run
is eligible.

### Tracked implementation

The versioned entry points and their complete runtime configuration are in
[`packages/legacy-migration/README.md`](../../packages/legacy-migration/README.md).
Run the importer only against an explicitly identified CampusPilot database and
object bucket. It refuses to start unless the target environment and endpoint
are allowlisted, the source is a distinct read-only snapshot, the exact source
and target Drizzle histories match their repositories, every approval checksum
matches, and the target preflight is empty.

Write domains in dependency order:

1. durable migration-run state and immutable provenance;
2. school and its verified existing logo key;
3. users selected for migration;
4. school membership and roles;
5. sessions, then classes and sections;
6. admissions and students;
7. examination plans, results, timetables, and explicitly approved new facts;
8. finance configuration and immutable financial history;
9. template revisions and active selections;
10. derived target projections and counters rebuilt from imported facts.

Generated PDF rows and objects are not imported. Once the source facts and
active templates are available, CampusPilot generates fresh artifacts on demand.

The current Prem-only importer records `preparing` durably, then uses one
serializable business-data transaction after validating every exact retained
object key and checksum through read-only source-bucket access. A pre-commit
failure rolls back the database transaction. There is no object journal or
object cleanup because the importer never mutates S3. `verify` revalidates the
checksum approval, tracked contract, live identities, retained objects, and
every durable hash before it finalizes the run.

### Documentation references

- the domain contracts in this directory
- `packages/db/src/schema`
- `packages/api/src/routers/school/billing/README.md`
- `packages/api/src/routers/school/document/README.md`
- `docker/dev/compose.yml`

### Verification checklist

- A deliberate interruption is classified from durable database state; no
  object mutation or blind write replay occurs.
- A reused run ID or non-empty target is rejected, except for the two narrowly
  defined, append-only recovery transitions above; retry count two is terminal;
  idempotence is fail-closed rather than a silent second import.
- Source counts reconcile to imported + omitted + deferred + blocked counts,
  including count-only dispositions for generated PDFs, notices, onboarding,
  feature flags, and AI data.
- All copied objects match source or transformed-byte checksums as declared.
- All foreign-key, unique, check, and JSON-schema validations pass.
- Domain-specific API and authenticated UI checks pass using non-production
  accounts in the local environment.

### Anti-pattern guards

- Do not point local application services at the production target database or
  production object bucket.
- Do not disable constraints to make the import pass.
- Do not update a target row merely because its natural key resembles a source
  row; require the reviewed merge mapping.
- Do not add S3 write/delete credentials to this database migration. Shared
  legacy objects remain unchanged and are referenced by exact key.

## Phase 3: acceptance and production cutover

### Future cutover procedure

After the rehearsal is signed off, freeze legacy writes at an announced cutoff,
take a final consistent extract, regenerate the dry-run reports, and require an
operator to approve any delta from rehearsal. Deploy and migrate CampusPilot
before importing. Run the same importer artifact used in rehearsal; only the
environment allowlist and approved final manifest change.

Keep CampusPilot writes disabled for the affected schools until import,
reconciliation, object verification, permission checks, and smoke tests succeed.
Record the exact point at which the system of record changes. The legacy app
then becomes read-only for a defined observation period.

Rollback means disabling access to the incomplete target import and restoring
the rehearsed pre-import target database backup. No object rollback exists or
is needed because the importer never mutates S3. Finance facts are protected by
immutability triggers and are not deleted row by row. Rollback never means
writing target changes back into the legacy database. Once users create
post-cutover CampusPilot data, rollback requires a separately designed
forward-recovery plan rather than destructive database restoration.

### Documentation references

- [Decision register](decisions.md)
- every domain's acceptance section
- the reviewed rehearsal report and final delta report

### Verification checklist

- All blocking decisions and exceptions are resolved by named approvers.
- The production source fingerprint matches the approved final extract.
- The refreshed Prem Chandra source still contains exactly one approved staff
  credential, and its target-verifier compatibility/collision preflight passes.
- Per-domain reconciliations pass with zero unexplained variance.
- Application authorization is verified for principal, manager, teacher,
  accountant, exam coordinator, platform admin, and an unauthorized user.
- School/session switching, historical reads, template previews, and document
  downloads are tested in an authenticated production smoke-test account.
- The retained credential owner successfully signs in with the existing
  password; a random compatibility probe alone is not acceptance evidence.
- Credentials are revoked or rotated after the migration window.

### Anti-pattern guards

- Do not use rehearsal output as the final source snapshot.
- Do not combine application deployment, unreviewed mapping changes, and data
  import into one irreversible step.
- Do not open the target application while exceptions can expose partial tenant
  data or incomplete authorization.

## Required run artifacts

Each rehearsal and cutover keeps these redacted artifacts outside Git:

- `run.json`: run ID, versions, environment identities, status, and timestamps;
- `source-manifest.json`: frozen database/object inventory and digests;
- `snapshot-evidence.json`: dump checksum, database runtime identities, cutoff,
  source-evidence checksum, and catalog/Drizzle fingerprint;
- `target-before.json` and `target-after.json`;
- `mapping.json`: approved source-to-target identities and decisions;
- `dispositions.ndjson`: one deterministic source-family reconciliation summary per line;
- `exceptions.ndjson`: stable code, domain, source key, severity, and resolution;
- `writes.ndjson`: target table/key plus retained shared-object references;
- `reconciliation.json`: domain totals and variances;
- `verification.md`: command results and authenticated test evidence;
- `approval.json`: who approved which manifest and decision checksum.

The implementation emits deterministic per-family summaries rather than
serializing sensitive omitted rows. Canonical families include OAuth/auth
state, sessions, verifications, API keys, admission photos, generated PDFs,
notices and notice objects, onboarding, school feature/default-session state,
AI usage/quota, provider images, and excluded schools. Import uses the canonical
builder, and reconciliation proves for each family that the frozen source total
equals imported plus intentionally omitted plus deferred plus blocked. Verify
checks the durably attested disposition/reconciliation hashes. A nonzero
blocking family prevents import and finalization.

## Current release status

- No signing key is required. The typed decision set and tracked documentation
  are the executable contract, and their checksums are bound into the reviewed
  run bundle and durable record.
- The service-backed fixture remains visible but is temporarily non-blocking for
  this rollout. Mandatory local gates are type/build checks, frozen Drizzle
  history, and Terraform database-recreation safety checks. Do not describe the
  PostgreSQL/Gotenberg fixture as passing until CI actually runs it successfully.
- Object-transfer tests are out of scope: the importer has read-only access to
  the shared legacy bucket and retains exact verified keys.
- The target uses separate runtime, migration-login, and non-login owner roles.
  The API role cannot assume the owner, mutate the migration control table, run
  DDL, create temporary shadow tables, or bypass migration guards. The migration
  login assumes the owner only for the Helm migration job and importer. A
  database-owner or superuser compromise remains outside the importer's
  enforceable trust boundary.

Reports may contain business data and must be encrypted, access-controlled, and
retained according to an explicit policy. Git stores only schemas, example
fixtures with synthetic data, and documentation.
