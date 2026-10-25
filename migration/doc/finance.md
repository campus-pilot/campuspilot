# Finance legacy-data migration contract

## Status and boundary

This document specifies the tracked, separately authorized legacy finance
migration package. The package implements snapshot validation, dry run,
checksum-bound approval, import, and verification. It is **not authorized to
run against production** until frozen evidence and operator approval are
supplied; this repository change itself copies no legacy data.

The shared execution order, run artifacts, and cutover controls are in
[`README.md`](README.md). Identity and enrollment mapping are governed by
[`identity-access.md`](identity-access.md) and
[`admissions-enrollments.md`](admissions-enrollments.md). Template and PDF
handling is governed by [`documents-templates.md`](documents-templates.md), and
open product decisions are tracked in [`decisions.md`](decisions.md).

The distinction is deliberate:

- The Drizzle migration in `packages/db/src/migrations` is a **database schema
  migration**. It creates CampusPilot tables, constraints, indexes, immutable
  fact guards, and converts CampusPilot's own pre-posting JSON configuration to
  exact minor units. It runs through the normal deployment migration runner.
- The tracked **legacy data migration** reads an independently identified legacy
  database and imports historical configuration, bills, payments, discounts,
  projections, and document provenance. It requires its own tooling, reviewed
  mappings, dry-run artifacts, operator approval, cutover window, and rollback
  procedure. It must never be folded into an application startup migration.

No implementation may infer a missing business fact merely because another
field currently correlates with it. Unknown values remain explicit exceptions
or incomplete records until an authorized mapping supplies them.

## Legacy sources and known defects

The source contract must be frozen to a schema/version fingerprint before a dry
run. The known source families are:

- `school.financeSchema`: currency, recurrence, fee elements, allowed scopes,
  required levels, and legacy defaults.
- `school_session.financeConfig`: session-level fee values.
- `class.financeConfig`: legacy global class values whose applicability to a
  target session must be mapped explicitly.
- `student.financeConfig`: enrollment/student values. A legacy student is one
  admission's enrollment in one session, not the durable financial owner.
- `bill_generation_event`: batch-generation header and period metadata.
- `student_bill_event`: one enrollment-owned charge and its line snapshots.
- `ledger_event`, where one `PAYMENT` event can contain
  both cash received and an embedded discount.
- Enrollment-owned `student_bill_projection` and `ledger_projection` tables.
- Receipt, monthly-bill/statement, and billing template/object-storage records.

The target finance table dispositions are explicit:

| Target table | Import role |
| --- | --- |
| `finance_bill_run` | accepted legacy batch headers, after member reconciliation |
| `finance_ledger_entry` | ordered admission-owned immutable debit/credit facts |
| `finance_bill` | immutable imported charge headers |
| `finance_bill_line` | ordered source line snapshots |
| `finance_payment` | cash component of each accepted legacy payment event |
| `finance_payment_allocation` | leave empty; account balance does not prove bill allocation |
| `finance_adjustment` | separate accepted discount component and approved corrections |
| `finance_refund` | no source refund fact exists; do not synthesize rows |
| `finance_number_counter` | rebuild from approved target numbering after facts load |
| `finance_admission_balance` | rebuild from the imported ledger; never copy source projections |
| `finance_admission_session_activity` | rebuild from the imported ledger per explicit session |

The import must follow the target database's posting/finalization and immutability
triggers in migrations `0018` through `0020`; disabling those guards is not a
migration strategy.

The importer must account for confirmed source defects rather than reproduce
them:

- Financial ownership changes with every session because history is keyed by
  `studentId`.
- Legacy projections can disagree with source events after concurrent
  read-increment-write operations.
- A force flag can create duplicate charges for one period.
- Duplicate checks are month-based even for quarterly/yearly configurations.
- Payments and discounts are combined rather than independent facts.
- There are no complete refund, reversal, write-off, allocation, or bill-void
  models.
- Custom bills cannot be allocated through the normal payment model.
- Overpayments appear as negative outstanding rather than labelled credit.
- Database numeric values are converted through JavaScript `Number` in parts
  of the legacy stack.
- Historical documents can render current class, totals, currency, or session
  facts instead of immutable posting-time values.
- Some handlers authorize a supplied school without proving that every other
  identifier belongs to that school.

The extraction manifest must record source row counts, primary keys, schema
fingerprint, database snapshot/cutoff time, object-store inventory checksum,
and application version/commit.

## Tenant, session, and durable admission identity

Every imported row must first resolve an explicit target `schoolId`. Cross-school
mapping by names or other coincidental text is prohibited. Operators provide a
reviewed tenant mapping from legacy school IDs to CampusPilot school IDs.

Sessions require a reviewed mapping from each legacy session ID to one target
`school_session.id`. Year labels alone are insufficient: two tenants may use the
same years, and dates do not prove identity. The mapping report includes source
and target school, session years, active state, and any conflict.

The target financial account is `admission.id`. The importer groups legacy
student/enrollment IDs by their source `admissionId`, then maps that admission
to exactly one target admission within the mapped school. Each legacy student
ID remains a provenance snapshot on imported bills; it never becomes the owner
foreign key.

Before any import, produce these identity reports:

1. Legacy admissions with no target candidate.
2. Legacy admissions with more than one target candidate.
3. Target admissions claimed by more than one distinct legacy admission.
4. Legacy student rows whose school/session/admission relationships disagree.
5. Financial rows whose student cannot be mapped through an admission.
6. Student/session duplicates and enrollments outside the mapped tenant.

Ambiguous rows are blocked exceptions. They are never assigned to the nearest
name, current enrollment, latest session, or active session.

### Admission-number audit

`admissionNo` is a human identifier and import matching aid, not the imported
foreign key. For each school, audit and report:

- exact duplicates;
- duplicates after trimming leading/trailing whitespace;
- duplicates after case-folding plus trimming;
- blank or null numbers;
- one number mapping to multiple source admission IDs;
- a mapped source and target admission with different numbers.

CampusPilot enforces exact `(schoolId, admissionNo)` uniqueness. Duplicate or
ambiguous legacy numbers require an operator-approved mapping/correction file;
the importer must not silently rewrite, suffix, trim, or renumber them.

## Exact money and currencies

All target operational amounts are PostgreSQL `bigint` minor units with an
explicit three-letter ISO currency. Import arithmetic uses decimal/BigInt or
database `numeric`; it must never pass through binary floating point.

For each source amount:

1. Preserve its original text/numeric representation in the audit manifest.
2. Use the approved migration currency `INR`. Any explicit contradictory source
   currency is blocking and must be shown to the user.
3. Use INR's ISO minor-unit exponent of 2.
4. Multiply exactly by `10^exponent`.
5. Require the result to be an integer and fit PostgreSQL `bigint`.
6. Reject rather than silently round values below one minor unit.

If a future business decision permits rounding, it must name the affected
source rows and currency and use a documented rule. The finance domain's
percentage-adjustment rule is round-half-up to the nearest minor unit; that
rule does not authorize rounding arbitrary imported source amounts.

Never aggregate or net different currencies. This migration expects only INR;
an explicit different currency or multi-currency account is a blocking exception
that requires a new user decision.

## Configuration mapping and precedence

Target ordinary pricing precedence is:

1. session-specific admission override;
2. session-specific class override for the server-resolved enrollment class;
3. session base/default value;
4. unresolved.

Bill-generation-only elements use the separately documented runtime precedence
and are never imported as generic persisted overrides. They are optional on
each new billing run: an absent runtime value omits that line rather than
blocking the run. Do not synthesize a runtime value during migration merely
because the legacy configuration labelled the element as required.

The importer translates:

- legacy session values to the mapped CampusPilot session;
- legacy school-global class values to the school's one mapped session, using an
  explicit `(school, session, class)` entry in the mapping bundle;
- legacy student/enrollment values to the durable admission's map under the
  mapped session ID.

Fee slugs and names require a reviewed mapping. Removed or renamed elements are
not collapsed if historical bill lines distinguish them. Zero remains a valid
explicit amount; blank/missing means inherit or unresolved.

Configuration defaults are converted to `defaultAmountMinor`. Import must
validate that `requiredAtLevel` is compatible with allowed scopes. A conflicting
configuration is an exception, not an opportunity to change precedence.

### Timezone and cycle start

Set every migrated session finance configuration to timezone `Asia/Kolkata` and
`cycleStartMonth=4` (April). Interpret legacy timestamp-without-time-zone values
under `Asia/Kolkata`; calendar-only dates remain unchanged. If a school has more
than one session, an explicit contradictory timezone/cycle fact, or no unique
mapped session, stop that school's finance import and ask the user rather than
spreading the global configuration across sessions.

## Registration and historical eligibility

Admission registration is a current lifecycle fact, independent from whether
historical finance exists. Import policy is:

- financial history is imported for both registered and unregistered
  admissions;
- ordinary future bulk billing excludes unregistered admissions;
- existing history may still receive payments, reasoned adjustments, refunds,
  reversals, and corrections;
- `unregisteredAt` is imported only from an authoritative transition timestamp;
  otherwise it remains null as historically unknown;
- no timestamp is inferred from `updatedAt`, last enrollment, last bill, or the
  current `registered` flag.

## Bills, ledger entries, payments, and discounts

Each accepted legacy bill becomes:

- one admission-owned debit `finance_ledger_entry`;
- one `finance_bill` linked to that entry;
- ordered `finance_bill_line` records preserving fee slug/name, exact amount,
  resolution source when knowable, and raw source provenance;
- an optional `finance_bill_run` grouping only when the source generation event
  is valid and its members reconcile.

Legacy custom/manual charges require a separate line mapping from configured
fees. Preserve the source's customer-facing item/description as
`fee_element_name`, use the target-only `manual-item` compatibility key, retain
stable source line order separately, and preserve the source justification as
both the bill/line manual reason and ledger note. A custom charge must not be mapped to a
configured fee element merely because its wording or amount looks similar. A
missing item title remains blocking. For the approved Prem Chandra import, a
standalone bill with no source actor/justification is instead surfaced as typed
`F_STANDALONE_MANUAL_FALLBACK` evidence; only that exact checksum-bound row may use the
tracked migration actor and the exact reason
`Legacy manual charge; source did not record a separate justification.`

A bill-run header whose July count/total differs from its member bills is
surfaced as typed `F_BILL_RUN_HEADER_REBUILD`. Only a tracked exact-match entry
allows the target header to be computed from immutable member bills; the stale
source header is retained in evidence but never copied as authority.

Duplicate/forced same-period source runs are not discarded. The dry run labels
each as regular, candidate supplemental with a required reason, duplicate, or
blocked ambiguity. Operators approve how each duplicate is represented; the
importer cannot silently pick the newest or oldest.

Each legacy payment event is decomposed:

- cash amount becomes one credit ledger entry plus one `finance_payment`;
- embedded discount becomes a separate credit ledger entry plus one
  `finance_adjustment` of kind `discount`;
- each fact retains the source event ID and shares a deterministic import-group
  reference in the migration manifest;
- each imported payment persists a canonical command snapshot and SHA-256
  command hash covering amount, currency, accounting session, effective and
  received times, method, reference, payer, and note; migration provenance is
  explicit and is never reconstructed from later mutable bill state;
- a zero cash or zero discount component creates no zero-valued posting;
- negative or internally contradictory components are exceptions.

One source payment/billing/ledger event may create multiple target facts, so its
legacy primary key cannot also be the primary key of every target row. Decision
G-14 binds the exact source ID in the frozen manifest and derives each target
fact ID using the reviewed deterministic hash rule. Malformed inputs and any
derived-ID collision block before writes.

Discounts without source reasons use `reasonCode="-"` and `reasonNote="-"`.
This satisfies the target's required non-blank audit fields while visibly
remaining a migration placeholder; it must not be presented as a school-supplied
rationale. Waivers, scholarships, and write-offs are not inferred from a generic
legacy discount.

## Account-credit payments and overpayment

Target payments are intentionally not linked to individual bills. Account-wide
balances do not prove which bill was settled, so the importer must not manufacture
that relationship. Therefore:

- import every valid cash event as an admission-level account credit;
- do not populate `finance_payment_allocation`, even when a legacy source has a
  payment-to-bill hint; preserve that hint only in migration provenance when it
  is needed for audit;
- calculate due or credit solely from admission ledger debits minus credits;
- display overpayment as positive account credit, not as a negative amount due;
- keep bills as independent immutable charge documents whose net charge changes
  only through bill-specific adjustments or reversal.

Reconciliation reports separate billed debits, payment cash, discounts/waivers,
refunds, and net admission balance.

## Refund and reversal limitations

The legacy model does not provide a complete authoritative refund/reversal
history. The importer must not infer refunds from negative payments, deletions,
projection decreases, or bank references alone.

Only explicit, auditable source refund/reversal records can become target facts.
Each must reference its original posting, match admission/currency/tenant, and
pass amount limits. Unsupported negative or corrective rows go to an exception
report for a later reasoned correction after cutover. An original entry can be
reversed once under the current model; chains requiring reversal-of-reversal
remain blocked until product policy exists.

## Immutable snapshots and human numbers

Imported bills snapshot the facts effective when the legacy charge was posted:

- admission ID, number, and display name;
- mapped session ID and year labels;
- source student/enrollment ID;
- class/section IDs, slugs/labels, and roll number when available;
- fee slugs/names, resolved values, and source details;
- currency, issue date, source period, configuration/import revision;
- source creator/effective/recorded timestamps when authoritative.

Missing historical labels are reported; current names are not substituted as if
they were historical facts. Source timestamps retain their original timezone
interpretation or remain blocked if that interpretation is unknown.

The approved mapping allocates bill and receipt numbers deterministically in
stable timestamp/source-table/source-ID order, ending at `BILL/2026-2027/000362`
and `RCP/2026-2027/000153`. The checksum-bound target counters are then imported with
next values `363`, `154`, and `1` for bill, receipt, and refund respectively.
The exact number map and counters are bound to the reviewed mapping before import and any
execution-plan drift blocks. Legacy display/reference numbers, when present,
remain provenance rather than target authority; preview never consumes a number.

## Documents, templates, and artifact provenance

Templates are governed by the canonical CampusPilot document system and remain
in scope. Legacy generated bill, receipt, and statement PDF artifact rows and
objects are intentionally omitted and recorded only as counts by school/type.
Do not download, hash, archive, copy, or link those PDF bytes.

After financial facts and active templates are migrated, a download creates a
fresh target artifact from the immutable target snapshot and selected template.
The target artifact has a new identity and is never represented as the legacy
original. There is no legacy statement template, so statement selection remains
unconfigured.

## Idempotency, sequence, and deterministic ordering

Every imported target fact receives a deterministic idempotency key derived
from the frozen source system identifier, source table/type, source primary key,
and target operation type. Re-running the same manifest must produce no new
facts. A key collision with different normalized content is a blocking error.
Payment retries compare the persisted canonical command hash. Import tooling
must calculate that hash from the normalized manifest before writing; the
`legacy:` database backfill marker is reserved for rows that predate command
snapshots and is not valid for new importer writes.

Admission ledger sequence is allocated deterministically within
`(school, admission, currency)`. Candidate ordering is:

1. authoritative effective timestamp;
2. authoritative recorded/created timestamp;
3. source table precedence documented in the import version;
4. stable source primary key.

The dry run emits the ordered ledger before writes. Equal/missing timestamps are
not resolved by database scan order. Effective and recorded times remain
separate target facts.

## Reconciliation contract

Target projections are rebuilt from imported immutable ledger entries after
posting; legacy projections are comparison inputs only and never imported as
authority.

Reconcile, per school/admission/session/currency and in aggregate:

- bill and manual-debit totals;
- payment cash totals;
- discount, waiver, and write-off totals separately;
- refund totals;
- debit and credit reversal totals;
- payment and refund amounts by admission account;
- bill net charges derived only from bill-specific credits/debits;
- admission balance as debits minus credits;
- entry counts, first/last effective time, and target last sequence;
- source event totals versus normalized target fact totals;
- legacy projection variance, reported rather than "fixed" by changing target
  facts.

Every variance must be zero or appear in an approved exception disposition.
Projection rebuild followed by reconciliation must be stable and repeatable.

## Staged execution and controls

### 1. Discovery and freeze

- Pin source schema/application versions and capture a consistent database and
  object-store snapshot.
- Verify read-only access, tenant scope, row counts, and checksums.
- Freeze mapping-file formats and import-tool version.

### 2. Mapping preparation

- Complete tenant, session, admission, fee-element, class applicability,
  currency, timezone, cycle, and optional human-number mappings.
- Require review/sign-off from an authorized operator; retain immutable mapping
  checksums.

### 3. Dry run

- Perform every extraction, normalization, constraint check, deterministic
  ordering decision, and reconciliation without target financial writes.
- Emit proposed rows, totals, idempotency keys, sequence plan, object manifest,
  and exception reports.
- Re-running the same source/mappings/tool version must produce byte-equivalent
  normalized manifests aside from explicitly excluded run metadata.

### 4. Staging import

- Import into an isolated copy using the real target schema and constraints.
- Rebuild projections, validate documents/checksums, run authorization-safe read
  checks, and obtain school/operator acceptance.

### 5. Cutover

- Establish and record the source write cutoff or delta window.
- Revalidate source fingerprints and mapping checksums.
- Import in bounded tenant batches with transactions and resumable checkpoints.
- Keep billing/payment mutations disabled for a tenant until its reconciliation
  and projection rebuild pass.
- Record importer version, source cutoff, batch IDs, target counts, and operator.

### 6. Rollback

The supported rollback mechanism is restoration of the rehearsed pre-import
database backup. Target finance facts are protected by immutable database
triggers, so the importer cannot delete a batch, even before the tenant is
opened. A batch-scoped privileged deletion mechanism would require a separate
security, integrity, and operational review plus an explicit schema migration;
it does not exist in this contract.

Each rehearsal and cutover therefore retains the pre-import backup, normalized
manifest, exception exports, mapping checksums, and reconciliation evidence
until acceptance. After target postings begin, business corrections use normal
reasoned reversals or adjustments; they are not rollback.

## Required exception reports

At minimum, dry run and cutover produce machine-readable and human summaries
for:

- unmapped/ambiguous tenant, session, admission, student, class, or section;
- exact and normalized admission-number duplicates;
- orphan/cross-tenant relationships;
- explicit currency/timezone/cycle conflicts or schools without exactly one mapped session;
- invalid, fractional-minor, negative, or overflow money;
- unknown fee elements or incompatible scopes/required levels;
- duplicate/forced billing periods and duplicate human numbers;
- malformed bills or line totals not matching their header;
- payment/discount decomposition failures;
- invalid/over-limit refunds or reversals;
- missing/ambiguous timestamps and ordering ties;
- source-event versus legacy-projection variance;
- target-ledger versus rebuilt-projection variance;
- missing/corrupt/unmapped in-scope templates and unexpected PDF types outside
  the count-only omission policy;
- idempotency key or normalized-content collisions.

Each exception has source identity, tenant, severity, blocking status, relevant
raw values, proposed/approved disposition, reviewer, and mapping/import version.
No report may expose secrets or unrestricted student data beyond the authorized
migration environment.

## Acceptance scenarios

The versioned importer is acceptable only when all applicable scenarios pass:

1. One admission with different legacy student IDs across sessions produces one
   durable target ledger and correct per-session activity.
2. Exact/trim/case admission-number duplicates stop import until an approved
   identity mapping is supplied.
3. INR converts exactly to two-decimal minor units; sub-minor and overflow
   values are rejected without rounding, and another currency blocks for review.
4. The one session per school receives `Asia/Kolkata`, April cycle start, and
   the approved global class configuration while preserving zero and precedence.
5. A legacy generated bill becomes one debit, immutable bill snapshot, and
   matching ordered lines under the correct admission/session/tenant.
6. A legacy payment with embedded discount becomes two independent credit facts
   whose sum matches the source components.
7. Every payment becomes admission-level account credit; no bill linkage is
   imported or inferred from account balance.
8. Duplicate forced-period bills appear in an exception/supplemental decision
   report rather than being silently dropped or posted as regular duplicates.
9. Unsupported negative/refund/reversal rows are blocked; supported explicit
   corrections match original admission/currency and amount limits.
10. Legacy generated PDFs are absent from target storage and tables, while a
    fresh target download regenerates a valid artifact from migrated facts and
    active templates.
11. Two dry runs with identical inputs yield identical normalized facts,
    idempotency keys, ordering, and totals.
12. Re-running an accepted import is idempotent and creates no duplicate facts
    or numbers.
13. Source normalized totals, target immutable ledger totals, bill settlement,
    and rebuilt projections reconcile by tenant/admission/session/currency.
14. Cross-school identifiers fail target constraints and appear in exception
    output without partial writes.
15. A failed pre-commit batch rolls back atomically before exposure; any retry
    first checks durable run state and cannot duplicate facts.
16. Unregistered admissions retain history and can settle it, but are excluded
    from later ordinary bulk billing.

Production execution requires a separately reviewed implementation plan,
security/privacy review, named operators, backup/restore evidence, and explicit
cutover approval. This contract alone is not authorization to connect to or
modify a legacy production database.
