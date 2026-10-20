# Finance legacy-data migration contract

## Status and boundary

This document specifies a future, separately authorized migration of financial
data from the legacy School app into CampusPilot. It is a contract for planning,
dry runs, exception handling, and acceptance; it is **not** an executable
production-data migration and this repository change does not copy legacy data.

The distinction is deliberate:

- The Drizzle migration in `packages/db/src/migrations` is a **database schema
  migration**. It creates CampusPilot tables, constraints, indexes, immutable
  fact guards, and converts CampusPilot's own pre-posting JSON configuration to
  exact minor units. It runs through the normal deployment migration runner.
- A future **legacy data migration** reads an independently identified legacy
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
- Legacy ledger/payment event tables, where one `PAYMENT` event can contain
  both cash received and an embedded discount.
- Enrollment-owned billing/ledger projection tables.
- Receipt, monthly-bill/statement, and billing template/object-storage records.

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
2. Resolve currency from an explicit, reviewed source configuration mapping.
3. Resolve the ISO minor-unit exponent (for example JPY 0, INR 2, KWD 3,
   CLF 4).
4. Multiply exactly by `10^exponent`.
5. Require the result to be an integer and fit PostgreSQL `bigint`.
6. Reject rather than silently round values below one minor unit.

If a future business decision permits rounding, it must name the affected
source rows and currency and use a documented rule. The finance domain's
percentage-adjustment rule is round-half-up to the nearest minor unit; that
rule does not authorize rounding arbitrary imported source amounts.

Never aggregate or net different currencies. A source account containing more
than one currency becomes separate admission/currency ledger streams. Missing,
invalid, or conflicting currency is a blocking exception.

## Configuration mapping and precedence

Target ordinary pricing precedence is:

1. session-specific admission override;
2. session-specific class override for the server-resolved enrollment class;
3. session base/default value;
4. unresolved.

Bill-generation-only elements use the separately documented runtime precedence
and are never imported as generic persisted overrides.

The importer translates:

- legacy session values to the mapped CampusPilot session;
- legacy class values only through an explicit `(school, session, class)`
  applicability mapping, because a global legacy class value does not prove it
  applied identically in every session;
- legacy student/enrollment values to the durable admission's map under the
  mapped session ID.

Fee slugs and names require a reviewed mapping. Removed or renamed elements are
not collapsed if historical bill lines distinguish them. Zero remains a valid
explicit amount; blank/missing means inherit or unresolved.

Configuration defaults are converted to `defaultAmountMinor`. Import must
validate that `requiredAtLevel` is compatible with allowed scopes. A conflicting
configuration is an exception, not an opportunity to change precedence.

### Timezone and cycle start

Legacy data does not establish CampusPilot's required IANA timezone or
`cycleStartMonth`. These fields require an explicit per-session mapping approved
by the school/operator. They must not be inferred from server timezone, locale,
address, session years, currency, the first bill date, or another session.

Fee elements and amounts may be preserved in an incomplete configuration while
these facts are absent. Such a session is not ready for billing preview or
posting. The import report lists every incomplete session and its missing
fields; cutover approval must state whether historical read-only data may launch
while future billing remains blocked.

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
missing item title or missing justification is a blocking exception requiring
an operator-approved value; neither may be inferred from the other.

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
  received times, allocation mode/explicit links, unallocated-credit
  confirmation, method, reference, payer, and note; migration provenance is
  explicit and is never reconstructed from later mutable bill state;
- a zero cash or zero discount component creates no zero-valued posting;
- negative or internally contradictory components are exceptions.

Discounts without source reasons use an explicitly approved migration reason
code that says the reason was unavailable in the legacy source; they must not
pretend to have a school-supplied rationale. Waivers, scholarships, and
write-offs are not inferred from a generic legacy discount.

## Allocations, overpayment, and unallocated credit

Legacy payments generally do not contain trustworthy bill allocations.
Account-wide outstanding totals do not prove which bill was settled. Therefore:

- import explicit source allocations only when the source contains a valid
  admission-, currency-, and bill-matching relationship;
- otherwise retain the payment as unallocated admission credit;
- do not retroactively apply the new oldest-issued-first proposal unless an
  operator approves a separate allocation plan produced in the dry run;
- imported allocation totals may not exceed either payment amount or target
  bill outstanding;
- overpayment remains labelled unallocated credit and must not be displayed as
  a negative amount due.

Reconciliation reports separate billed debits, allocated cash, unallocated
cash, discounts/waivers, refunds, and net admission balance.

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

Legacy human bill/receipt/refund numbers may be retained only if unique within
the target school's namespace and format policy. Otherwise preserve the legacy
number as provenance and allocate a target session-scoped number transactionally.
The mapping file records both. Number counters start after the highest approved
target sequence and are checked for gaps/collisions; preview never consumes a
number.

## Documents, templates, and artifact provenance

PDFs and templates are governed by the canonical CampusPilot document system,
not copied into mutable finance columns. Inventory every legacy object with
bucket/key, content type, byte size, checksum, source template identity, source
financial fact, creation time, and availability.

For an accepted historical document:

- preserve the original bytes as an immutable artifact when legally and
  technically allowed;
- link it through explicit imported provenance to the mapped payment/refund,
  bill, or as-of statement context;
- do not claim it was rendered by a CampusPilot template revision when it was
  not;
- never regenerate an old document from current class, totals, currency, or
  template settings and present it as the original;
- record missing objects, checksum mismatches, unknown templates, and documents
  that reference unmapped financial rows as exceptions.

Future regenerated documents use immutable target snapshots and an explicit
template revision. Template marketplace migration is a separate concern from
financial-fact import.

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
- allocated versus unallocated payment amounts;
- bill outstanding derived from allocations and bill-specific credits;
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
- missing/conflicting currency, timezone, or cycle start;
- invalid, fractional-minor, negative, or overflow money;
- unknown fee elements or incompatible scopes/required levels;
- duplicate/forced billing periods and duplicate human numbers;
- malformed bills or line totals not matching their header;
- payment/discount decomposition failures;
- invalid/over-limit allocations, refunds, or reversals;
- missing/ambiguous timestamps and ordering ties;
- source-event versus legacy-projection variance;
- target-ledger versus rebuilt-projection variance;
- missing/corrupt/unmapped documents and templates;
- idempotency key or normalized-content collisions.

Each exception has source identity, tenant, severity, blocking status, relevant
raw values, proposed/approved disposition, reviewer, and mapping/import version.
No report may expose secrets or unrestricted student data beyond the authorized
migration environment.

## Acceptance scenarios

The future importer is acceptable only when all applicable scenarios pass:

1. One admission with different legacy student IDs across sessions produces one
   durable target ledger and correct per-session activity.
2. Exact/trim/case admission-number duplicates stop import until an approved
   identity mapping is supplied.
3. INR, JPY, KWD, and a four-decimal currency convert exactly; sub-minor and
   overflow values are rejected without rounding.
4. Session/class/admission configuration preserves zero and precedence, while
   missing timezone/cycle facts remain incomplete and block future posting.
5. A legacy generated bill becomes one debit, immutable bill snapshot, and
   matching ordered lines under the correct admission/session/tenant.
6. A legacy payment with embedded discount becomes two independent credit facts
   whose sum matches the source components.
7. A payment without authoritative bill linkage remains unallocated credit;
   no allocation is inferred from account outstanding.
8. Duplicate forced-period bills appear in an exception/supplemental decision
   report rather than being silently dropped or posted as regular duplicates.
9. Unsupported negative/refund/reversal rows are blocked; supported explicit
   corrections match original admission/currency and amount limits.
10. Historical source documents retain byte checksum and honest template/source
    provenance; regeneration never changes the claimed original artifact.
11. Two dry runs with identical inputs yield identical normalized facts,
    idempotency keys, ordering, and totals.
12. Re-running an accepted import is idempotent and creates no duplicate facts
    or numbers.
13. Source normalized totals, target immutable ledger totals, bill settlement,
    and rebuilt projections reconcile by tenant/admission/session/currency.
14. Cross-school identifiers fail target constraints and appear in exception
    output without partial writes.
15. A failed batch rolls back atomically before exposure; a resumed batch uses
    checkpoints and idempotency without duplication.
16. Unregistered admissions retain history and can settle it, but are excluded
    from later ordinary bulk billing.

Production execution requires a separately reviewed implementation plan,
security/privacy review, named operators, backup/restore evidence, and explicit
cutover approval. This contract alone is not authorization to connect to or
modify a legacy production database.
