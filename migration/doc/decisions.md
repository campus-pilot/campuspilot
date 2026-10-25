# Migration decision register

## How to use this register

Every decision below must be resolved in the versioned mapping bundle before the
affected rows are written. `BLOCK` means the safe behavior is to stop that domain,
not to choose a convenient value. `DEFER` means preserve the source in the
approved archive and leave it out of CampusPilot until the target exists.

The code-defined typed policy and this tracked register are the executable
decision contract. An approval records their checksums, affected source/target
manifest checksums, approver, timestamp, and rationale. A decision made for the local
rehearsal is not automatically approved for production. If production discovery
changes the evidence, reapprove it.

## Resolved scope decisions

| ID | Decision | Approved policy |
| --- | --- | --- |
| S-01 | Is this documentation an executable migration? | The tracked package and tracked contract are executable, but no run is authorized without frozen checksum-bound evidence. |
| S-02 | First destination | Production legacy source to an explicitly isolated local CampusPilot rehearsal target. |
| S-03 | Student/admission profile photos | Intentionally omit every photo key and leave target `photoS3Key` null. Inventory/reconcile nonzero counts; never read, copy, or delete the photo objects. |
| S-04 | School logos | In scope; validate and retain the exact existing key/checksum in the shared legacy bucket. Never copy, re-key, or delete. |
| S-05 | Active school templates | In scope, including custom template conversion and validation. |
| S-06 | Built-in marketplace source files | Already present/adapted in the target repository; do not copy them as production data. |
| S-07 | Legacy source mutations | Prohibited. Source database and object storage are read-only. |
| S-08 | Legacy projections | Comparison/reconciliation inputs, never target authority. |
| S-09 | Missing historical fact | Remains unknown/null, deferred, or blocked; never inferred from a correlated field. |
| S-10 | Target collision policy | Rehearsal starts from an empty local CampusPilot database. Preserve source IDs exactly. If any target row/object collision or source conflict is discovered, stop that scope and ask the user; do not merge or select a winner. |
| S-11 | Source timestamp timezone | Interpret legacy timestamp-without-time-zone values as `Asia/Kolkata`, while preserving calendar-only dates without timezone conversion. |
| S-12 | Legacy school `admin` role | Map to the school-scoped `principal` role. Never grant the system-level Better Auth `admin` role, which remains derived only from `SYSTEM_ADMIN_EMAIL`. |
| S-13 | Teacher section scopes | If a legacy teacher is assigned to any section of a class, grant that teacher the mapped whole-class scope. Unknown identifiers and invalid attribute shapes still block. |
| S-14 | Authentication sessions | Migrate approved compatible staff password credentials, but copy no sessions, challenges, OAuth tokens, or API keys. Every user must establish a fresh target session. |
| S-15 | Student portal identities | Do not migrate student/guardian login state, accounts used only for student access, portal links, or student-session authorization. Admission/student academic and contact records remain in scope. |
| S-16 | Examination lifecycle | When every plan for an exam has the same status, map `completed` to `completed`, `active` to `active`, and `draft`/`approved` to `ready`; mixed statuses or incomplete plan sets require user review. Transition timestamps remain null unless authoritative. |
| S-17 | Exam-wide assessment | Every subject result must contain the same explicit approval boolean. In deterministic stable source-ID order, independently select the first populated attendance and co-scholastic value after confirming all populated subject values for that field agree. A leading null must not erase a populated value on another subject. Attendance must be a non-negative integer no greater than the approved per-exam `totalWorkingDays`; incomplete subject sets and any disagreement are blocking. |
| S-18 | Admit-card footprint | Support both target `full` and `half`; map the legacy default/two-up design to `half`. Custom sources must retain their explicit source footprint. |
| S-19 | Statement template | Leave statement template selection unconfigured because the legacy app has no statement template. |
| S-20 | Generated PDFs | Do not migrate generated PDF artifact rows or objects. Count them only for the disposition report; users regenerate target PDFs from migrated facts and templates. |
| S-21 | Notices | Intentionally omit notices, notice templates, and any notice PDF artifacts/objects. Record counts only; do not archive or import their contents. |
| S-22 | Onboarding and AI state | Do not migrate the legacy onboarding row/flag, feature flags, AI quota, or AI usage. Keep target onboarding fields at their target defaults and record source counts only. |
| S-23 | Finance defaults | Use `INR`, `Asia/Kolkata`, and `cycleStartMonth=4`. Each school currently has one session, so apply its legacy school-global finance configuration to that mapped session. |
| S-24 | Missing discount reason | Write `reasonCode="-"` and `reasonNote="-"`; this is an explicit migration placeholder, not a school-supplied rationale. |
| S-25 | Prem Chandra staff password credential | Retain exactly the one compatible Better Auth credential hash byte-for-byte, map it to `issuer="local:credential"`, require exact user/account ownership and collision checks, keep every token/expiry/scope field null, and require an owner sign-in with the existing password for acceptance. Google sign-in is the fallback; no email password-reset delivery is configured. |
| S-26 | Prem Chandra exam working days | The approved exam-wide setting is `81` for every in-scope exam. Preserve each subject plan's legacy compatibility value, require the source agreement report to match the approved mapping, and create one `exam_assessment_settings` row per exact session/exam key with `totalWorkingDays=81`. |

## Global execution decisions

| ID | Required decision | Why it matters | Safe default / owner |
| --- | --- | --- | --- |
| G-01 | Exact legacy tenants and target school IDs | Names/slugs do not prove tenant identity | BLOCK / migration owner + school owner |
| G-02 | Merge policy for a non-empty target | The approved path expects an empty target | BLOCK and ask the user on any pre-existing business row/object or collision; never overwrite / migration owner |
| G-03 | Source schema/application cutoff and fingerprint | Checked-out code may differ from production | BLOCK / engineering |
| G-04 | Source database consistency mechanism | Unrelated live reads can form an impossible snapshot | BLOCK / DBA |
| G-05 | Source timezone drift from approved `Asia/Kolkata` interpretation | Instants otherwise shift and ordering changes | BLOCK and ask the user / school owner + DBA |
| G-06 | Source ID shape/collision exception | Raw IDs must remain identical in target | BLOCK and ask the user; never generate a replacement / engineering |
| G-07 | Deterministic ordering for equal/missing timestamps | DB scan order is unstable | BLOCK affected ordered facts / domain owner |
| G-08 | Local rehearsal privacy/sanitization policy | Production contains personal and financial data | BLOCK credentials/import until approved / security + privacy |
| G-09 | Archive encryption, location, access, and retention | Reports contain personal/business data | BLOCK export persistence / security + privacy |
| G-10 | Cutover freeze duration and system-of-record switch | Prevents writes diverging between apps | BLOCK production / operations + school owner |
| G-11 | Pre-opening rollback point and post-opening forward-recovery plan | Destructive restore is unsafe after new writes | BLOCK production / engineering + operations |
| G-12 | Migration service actor identity | Many target rows require `createdBy`/`recordedBy` | BLOCK affected rows; do not use first admin / security + product |
| G-13 | Whether original source IDs appear in target provenance schema or only frozen manifest | Needed for support/audit | Checksum-bound external manifest minimum; schema change before domains that require in-app provenance / product + engineering |
| G-14 | Identity for source rows that decompose into multiple target facts | One legacy staff/finance event cannot be the primary key of several target rows | Resolved: preserve the exact source ID in the frozen manifest and derive each decomposed target ID with the reviewed deterministic hash rule; collisions block |

## Identity, school, and access decisions

| ID | Required decision | Evidence/report | Safe default / owner |
| --- | --- | --- | --- |
| I-02 | Duplicate staff rows become multiple roles, merge, or exception | Per-school normalized-email duplicates | BLOCK / school owner |
| I-04 | User identity collision/merge by email | Exact and normalized duplicate report | BLOCK / security + user owner |
| I-05 | Staff credential/password-hash portability from Better Auth 1.6.2 to 1.7.1 | Identical installed Scrypt implementation, valid source hash shape, target verifier parse, ownership/collision report, and credential-owner sign-in | Resolved for the frozen Prem Chandra rehearsal by S-25; revalidate and reapprove if the source or target auth version/configuration changes |
| I-07 | `emailVerified` authority | Signed typed policy | Preserve the source boolean exactly; never infer / security |
| I-08 | System administrator identity | Target derives it from `SYSTEM_ADMIN_EMAIL` | Use target configuration only / security |
| I-10 | Staff/provider profile images | Signed typed policy | Omit provider `image`; leave both target image fields null / privacy |
| I-11 | SVG or invalid school logos | Target accepts validated raster images | BLOCK or approve deterministic rasterization / school owner |
| I-12 | Admission-email-linked non-staff users/accounts or `session.isStudent` | CampusPilot has no equivalent durable student identity link | BLOCK unless the tracked typed student-portal policy is changed and reviewed / security + product |

## Academic structure and admission decisions

| ID | Required decision | Evidence/report | Safe default / owner |
| --- | --- | --- | --- |
| A-01 | Duplicate legacy sessions with same target school/year range | Session collision report including slugs/config | BLOCK / school owner |
| A-02 | Target active session | Validated legacy pointer and proposed map | BLOCK if missing/invalid; do not choose latest / school owner |
| A-03 | School `defaultSessionConfig` disposition | Exact JSON and difference from stored sessions | ARCHIVE/DEFER; do not apply / product |
| A-04 | Class display order | Explicit per-school proposal | BLOCK until approved / school owner |
| A-05 | Section display order | Explicit per-class proposal | BLOCK until approved / school owner |
| A-06 | Invalid subject/mode config, especially percentages not totaling 100 | Class configuration validation report | BLOCK affected class / school academic owner |
| A-07 | Slug conflicts/renames | Cross-domain reference report | BLOCK; approved complete rewrite only / school owner |
| A-08 | Duplicate/blank admission numbers | Exact/trimmed/case-folded audit | BLOCK; no automatic suffix / school owner |
| A-09 | Missing required admission fields | Field-level exception file | BLOCK; no placeholders / school owner |
| A-10 | Broken enrollment placement | Tenant/class/section relationship report | BLOCK; do not silently detach / school owner |
| A-11 | Unknown unregister timestamp | Legacy has only current boolean | Leave `unregisteredAt=null` / resolved rule |
| A-12 | Non-null admission photo keys | Exact inventory and disposition reconciliation against S-03 | Intentionally omit; leave target key null and perform no S3 mutation / resolved rule |

## Examination decisions

| ID | Required decision | Evidence/report | Safe default / owner |
| --- | --- | --- | --- |
| E-03 | Populate exam-wide working days | Per-plan agreement/conflict report | Do not populate / school academic owner |
| E-05 | Invalid/extra/out-of-range marks | Result validation report | BLOCK row; never clamp or create zero / school academic owner |
| E-06 | Duplicate exam plans/results | Natural-key collision and dependent rows | BLOCK; never choose latest / school academic owner |
| E-07 | Timetable validation failures/overlaps | Row/cell/subject/mode report | BLOCK timetable; preserve extract / school academic owner |

## Finance decisions

The full semantics and exception rules live in [finance.md](finance.md). The
following product decisions remain mandatory before finance schema freeze/import:

| ID | Required decision | Safe default / owner |
| --- | --- | --- |
| F-01 | Currency conflicting with approved `INR` default | BLOCK and ask the user / school finance owner |
| F-02 | Timezone or cycle start conflicting with `Asia/Kolkata` and April | BLOCK and ask the user / school finance owner |
| F-03 | More than one session or ambiguous finance configuration applicability | BLOCK and ask the user / school finance owner |
| F-04 | Fee slug rename/removal mappings and orphan keys | BLOCK / school finance owner |
| F-05 | Duplicate/forced same-period bill disposition | BLOCK / school finance owner |
| F-06 | Legacy custom-charge title/reason missing | Blank title blocks; exact standalone missing-actor/reason rows use the tracked F-12 fallback / school finance owner |
| F-07 | Human bill/receipt number collisions and target numbering | Signed plan allocates `BILL/{session}/{sequence:6}` and `RCP/{session}/{sequence:6}` in stable timestamp/source-table/source-ID order, ending at 362/153, and imports next counters bill=363, receipt=154, refund=1 / school finance owner |
| F-09 | Rounding of values below a currency minor unit | Reject; any rounding needs row-specific approved rule / finance governance |
| F-10 | Refund/reversal/write-off facts absent from source model | Do not infer / resolved rule |
| F-11 | Payment-to-bill allocations | Do not manufacture; preserve source hint only as provenance / resolved rule |
| F-12 | Legacy finance projection variance | Bind typed rebuild-from-events/header/manual-actor entries; a changed report or target event-derived reconciliation failure remains blocking / school finance owner |

## Document and storage decisions

| ID | Required decision | Evidence/report | Safe default / owner |
| --- | --- | --- | --- |
| D-01 | Duplicate active legacy template rows | Row/object checksum report | BLOCK; do not choose latest / school owner |
| D-02 | Built-in match versus custom template | Exact source checksum comparison | Treat as custom unless exact / resolved rule |
| D-03 | Custom template variable/safety conversion | Compile/sanitize/render/visual report | BLOCK failing template / school owner + engineering |
| D-04 | Custom admit-card source lacks an explicit full/half footprint | Both are supported; only the legacy default/two-up design is known to be `half` | BLOCK and ask the user / school owner |
| D-05 | Missing bill/receipt page metadata | Artifact metadata report | BLOCK; do not infer from HTML/name / school owner |
| D-07 | Template artifact `createdBy` when source creator is unknown or legacy staff is unmapped | Creator-resolution report | Migration service actor only if policy explicitly describes it / product + security |
| D-09 | Historical template versions from object versioning/backups | Version inventory | Active cutoff version only unless retention requires more / product + privacy |
| D-10 | Missing/corrupt/unreferenced objects | Object reconciliation | BLOCK referenced objects; archive report for unreferenced / operations |

## Unsupported/deferred domain decisions

| ID | Required decision | Safe default / owner |
| --- | --- | --- |
| U-06 | Legacy sessions/verifications/OAuth tokens | Intentionally omit and force reauthentication / security |
| U-07 | Legacy API keys | Reissue; archive non-secret inventory only / security |
| U-08 | Unknown production schema/object families | BLOCK until documented / migration owner |

## Sign-off checklist

Before local rehearsal writes:

- resolve G-01 through G-09, G-12 through G-14, and every domain decision
  touched by actual data;
- approve the local privacy profile and source credential scope;
- freeze the mapping-bundle checksum;
- confirm the target is the isolated local environment.

Before production writes:

- repeat discovery and review all changed evidence;
- resolve G-10 through G-13;
- sign every remaining blocking decision;
- approve all exception dispositions and reconciliations from rehearsal;
- confirm the importer binary/commit and mapping format are unchanged;
- confirm rollback/forward-recovery and credential revocation owners are present.
