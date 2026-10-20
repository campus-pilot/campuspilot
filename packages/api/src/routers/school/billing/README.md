# Billing domain contract

This module owns restricted pricing now and will own bills, payments, ledger
entries, reports, and finance documents as the implementation proceeds. The
legacy school app is a workflow reference only. Its enrollment-owned ledger,
floating-point accounting, mutable history, force-generated duplicates, and
combined payment/discount records are explicitly not part of this contract.

## Identity and terminology

- An **admission** is the durable financial account. A student row is only that
  admission's enrollment in one session and never owns money or history.
- Every finance operation takes independent `schoolId`, `admissionId`, and
  `sessionId` facts and validates them together. A handler never infers the
  current session or treats authorization for a school as proof that another ID
  belongs to it.
- A **fee element** is a configured charge category. A **pricing value** is an
  amount configured at session, class, admission, or billing-run scope.
- A **billing period** is a timezone-bound interval. A **billing run** is an
  idempotent command that posts bills for one explicit session and period.
- A **bill** is an admission-owned debit with immutable enrollment and pricing
  snapshots. A **payment** is cash received. An **allocation** explicitly links
  payment credit to a bill.
- A **discount**, **waiver**, **write-off**, **refund**, and **reversal** is its
  own reasoned accounting fact. None is embedded in or mutates another fact.
- A **statement** is an as-of view; it does not create a charge. A **receipt**
  is an immutable document for a payment or refund.

`admissionNo` will become unique within a school after the Phase 2 duplicate
audit and migration. Relational ownership and authorization continue to use the
admission ID, never the human number.

## Approved v1 policy decisions

### Periods, sessions, and eligibility

- Every session finance configuration requires its own valid IANA timezone and
  `cycleStartMonth` integer from 1 through 12. There is no school, server, UTC,
  or browser-timezone fallback. A missing or invalid value makes billing-run
  preview and posting unavailable for that session.
- A billing date is a local civil `YYYY-MM-DD` in the configured timezone. Its
  period is a half-open local-date interval `[startDate, endDate)`: the start is
  included and the next period's start is excluded. Period keys are derived
  from the local start boundary and are deterministic:
  - monthly: first local day of the containing calendar month through the first
    local day of the next month; key `monthly:YYYY-MM`;
  - quarterly: the latest boundary not after the billing date in the sequence
    `cycleStartMonth + 0/3/6/9 months`, through three calendar months later; key
    `quarterly:YYYY-MM` using that local start month;
  - yearly: the latest `cycleStartMonth` boundary not after the billing date,
    through twelve calendar months later; key `yearly:YYYY-MM` using that local
    start month.
- Persist the local start/end dates, timezone, and UTC boundary instants. Convert
  each local midnight independently using Temporal-compatible disambiguation:
  choose the earlier instant when local time repeats and the later instant when
  it falls in a timezone gap. Never derive the end instant by adding a fixed
  duration to the start; DST can make the elapsed UTC duration shorter or
  longer than the nominal local interval.
- V1 has no due-date or overdue model because the legacy school workflow does
  not have one. Bills are due when issued. APIs, reports, and documents must not
  invent `dueDate`, overdue flags, or aging buckets. A future due-date feature
  requires a new explicit product decision and migration.
- Every billing run requires an explicit `sessionId`. That session may be active
  or historical; session activity does not silently change billing eligibility
  or force a manual-charge workflow. Preview and posting independently validate
  school/session ownership and enforce one regular run per school, session, and
  deterministic period key. Supplemental or correcting behavior remains an
  explicit separate command rather than a force flag.
- Unregistered admissions are excluded from ordinary bulk billing. They may
  still receive payments, discounts/waivers, refunds, reversals, and corrections
  needed to settle or repair existing history.

### Pricing resolution

Ordinary fee elements resolve in this order:

1. admission override for the explicit session;
2. class override for that session and the server-resolved enrollment class;
3. session base/default value;
4. unresolved.

Bill-generation elements resolve from an allowed admission override, then a
run-time class value, then a run-time school/session value, then an explicit
configured fallback. Run inputs never overwrite persisted ordinary pricing.
The resolver returns the amount and source; posted bill lines snapshot both.
Preview and posting must execute the same resolver and validator.

The current JSON configuration calls admission scope `student` for compatibility
with stored data. The route and accounting owner are admission-based. Phase 2
will migrate configuration to the final exact-money representation and can
rename that persisted scope without leaking the legacy ownership model.

### Money, allocation, and corrections

- Phase 2 stores operational money as integer minor units plus ISO currency.
  No posted money uses JavaScript floating-point arithmetic. Zero is a valid
  configured value; blank means inherit or unresolved.
- Payments default to a previewed oldest-issued-outstanding-bill-first proposal
  because v1 has no due date. Staff may edit allocations or retain unallocated
  credit.
- Overpayment is allowed only after explicit confirmation and is displayed as
  admission credit, never as a confusing negative due amount.
- Posted facts are immutable. Corrections append linked opposite or adjustment
  entries; they do not update or delete bills, payments, allocations, or ledger
  entries.
- Every posting command is idempotent within its school and operation type.
  Effective time and recorded time remain independent facts.
- Fixed and percentage discounts are supported. Percentage input is a decimal
  string greater than `0` and at most `100`, with at most four fractional digits
  (for example `"12.5"`); JSON numbers and exponent notation are rejected. Parse
  it as an integer numerator plus decimal scale, calculate against the eligible
  minor-unit amount with integer arithmetic, and round half up to the nearest
  minor unit. For numerator `p` with `d` decimal places, use denominator
  `100 * 10^d` and calculate
  `floor((eligibleMinor * p + denominator / 2) / denominator)`. Persist only
  that fixed minor-unit result with the adjustment snapshot, never the
  percentage as an amount to recalculate later.
- Scholarships are explicit waivers. Installments, proration, GST/tax,
  automated late fees, and payment gateways are deferred.

### Human numbers

Bill, receipt, and refund numbers reset per academic session using a serialized
counter derived from the explicit session, without a mutable school setting:

- `BILL/2026-27/000001`
- `RCP/2026-27/000001`
- `RFN/2026-27/000001`

Database IDs remain the API identity. Number allocation is transactional and is
not performed during preview.

## Restricted configuration boundary

### Exact configuration representation

- `financeConfig.currency`, `financeConfig.timeZone`, and
  `financeConfig.cycleStartMonth` are independent required facts whenever a
  session has finance configuration. The timezone must be an IANA identifier;
  the cycle month is an integer from 1 through 12.
- Migrated configuration may retain fee elements and exact amounts while any
  of those independent facts are absent. Restricted reads expose
  `configurationReadiness.status`, `readyForBilling`, and `missingFields`;
  class/admission value edits preserve the incomplete configuration. A full
  authorized configuration write must supply every required fact before later
  billing preview/posting services may treat the session as ready.
- Element defaults use `defaultAmountMinor`. Session, class, and admission
  value maps also contain non-negative safe integers in minor units. Decimal
  major-unit values and fractional minor units are rejected.
- The session configuration's explicit currency governs its class and
  admission override maps. Operational facts repeat currency on every money
  row so historical postings never depend on mutable configuration.
- `unregisteredAt` records new unregister transitions independently from the
  boolean lifecycle state. It may be null on legacy unregistered rows because
  an unknown historical time is not inferred from a correlated timestamp.

General admission create/update DTOs explicitly reject the retired
`financeValue` input, and general create/read/list/update outputs never return
it. Restricted admission values are accessed only through:

- `getAdmissionFinanceValues({ schoolId, admissionId, sessionId })`
- `updateAdmissionFinanceValues({ schoolId, admissionId, sessionId, values })`

Reads require an explicit session and return only that session's value map.
Updates require an active session, validate every fee element and its admission
scope and the admission's registered state under a row lock, replace only that
session's map, preserve all other sessions, and treat an empty map as removal of
that session override. Cross-school admission or session identifiers return a
non-leaking not-found response. The active-session rule applies only to pricing
configuration edits; it does not restrict billing runs, which always use their
explicit session.

Session finance configuration remains behind `getSessionFinance` and
`updateSessionFinance`; it is not part of general session DTOs.

## Operational concurrency and transport

Every future poster that appends a ledger entry must call
`lockFinanceAdmissionAccount` before it reads the account ledger, allocates the
next sequence, writes facts, or updates projections. Projection rebuild uses
the same lock and the canonical ordering is session/account work before any
secondary resource locks. This prevents a rebuild from publishing a snapshot
that omits a concurrently committed posting. Reconciliation is read-only and
uses one repeatable-read transaction so all compared rows come from one
database snapshot.

PostgreSQL `bigint` values never cross an API boundary as JavaScript numbers.
Amounts, ledger sequences, and counter values serialize as unsigned base-10
decimal strings; incoming strings are validated before conversion to `bigint`.
Projection diagnostics expose arrays and decimal strings, never `Map` or
`BigInt`, so the shape is JSON-safe without casts or lossy conversion.
Individual operational facts remain PostgreSQL `bigint`. Rebuildable lifetime
and session debit/credit projection caches use exact `NUMERIC(38,0)` columns
mapped to JavaScript `bigint`, allowing cumulative totals to exceed one
individual operational value without overflow or loss of transport precision.

### Billing-run and bill operations

`previewBillingRun` and `postBillingRun` accept an explicit school, session,
local billing date, optional admission/class selections, and bill-generation
values. Run-time class values are keyed by durable class ID; persisted class
pricing remains keyed by the configuration's class slug. Preview is read-only
and returns grouped blocking/non-blocking issues, exact totals, paginated bill
breakdowns, immutable pricing-source snapshots, and a SHA-256 review hash.
Posting locks the session, admission accounts, and enrollments in deterministic
order, recomputes the same derivation, and rejects a stale hash before writing.
Explicit selection arrays contain at least one ID; omission alone means all.
Every selected class is independently checked against the school context, and
a run is capped at 5,000 candidate admissions. Candidate discovery reads at
most 5,001 IDs and returns the blocking size issue before enrollment/pricing
materialization or finance locks. Posting bulk-locks accounts,
reserves one contiguous bill-number block, and writes ledger, bill, line,
projection, and finalization rows in bounded chunks, so round trips grow by
chunk count rather than by admission count.

Regular runs are unique by school, explicit session, and deterministic period
key. A second legitimate charge uses `kind: "supplemental"` with a nonempty
reason; there is no force flag. An idempotency-key retry returns the existing
result only when its canonical command payload matches. A reused key with a
different payload is a conflict.

`createManualBill` is an ordinary new-charge workflow. It requires a registered
admission with an enrollment and class placement in the explicit session, a
reason, and configured fee-element lines. Settlement/correction APIs may later
operate on unregistered accounts, but this ordinary bill command may not.

`reverseBill` and `reverseBillingRun` append exact opposite ledger entries and
advance projections; they do not mutate bill/run headers. A bill with live
allocations or bill-specific credits cannot be reversed independently. Run
reversal validates every member first and commits every opposite fact or none.
The absence of a `reversed` status is intentional: reversal is derived from the
immutable linked ledger fact.
Standalone and run-reversal child idempotency keys occupy separate internal
namespaces. A run retry accepts either zero existing children or its complete
exact child set; partial sets and independently-created reversals conflict and
are never adopted. Run reversal returns a compact aggregate rather than an
unbounded child array. Child keys, existing target reversals, allocations, and
live credits are validated set-wise; opposite ledger and projection facts use
the same bounded bulk writer as posting.

Preview readiness issues and run-detail bills are independently paginated.
Public bill details use immutable bill and line snapshots for session years,
enrollment, class/section IDs, slugs and labels, roll/admission identity,
configuration hash, line counts, exact amounts, and pricing sources.

### Payment, adjustment, refund, and ledger operations

`getAdmissionLedger` is admission-wide unless an explicit session attribution
filter is supplied. It orders by `effectiveAt`, account sequence, and ID; pages
entries without changing the independently calculated opening/closing balances;
returns the balance immediately before each page plus the running balance at
every displayed entry; and returns specialized bill, payment-allocation,
adjustment, refund, and reversal metadata. Lifetime and selected-session
summaries are aggregated from immutable ledger facts rather than projection
caches, never aggregate currencies, and expose due and credit as separate
non-negative decimal strings. Aggregate amounts use exact `NUMERIC(38,0)`
decimal-string transport while each posting remains bounded by PostgreSQL
`bigint`.

Payment allocation preview and posting share the same deterministic ordering:
oldest `issueDate`, then bill number, then bill ID. Explicit allocations must
target outstanding bills owned by the same admission and currency, but may cross
sessions. Any retained amount is admission credit and requires
`confirmUnallocatedCredit` before posting. Receipt allocation, payment metadata,
the immutable credit entry, numbering, and both projections commit atomically.
Automatic proposals inspect at most 500 outstanding bills. Preview returns a
review hash over the payment inputs, proposed allocations, and effective bill
settlement state; proposal-mode posting recomputes it under the account lock and
rejects stale review. Explicit mode remains available for bounded batches.
Idempotency compares a persisted canonical command hash that includes the mode,
explicit allocations, confirmation flag, dates, method, references, payer, and
note, so later bills or corrections cannot change retry identity.

Discounts, waivers, write-offs, and debit/credit corrections are separate
adjustment facts. Percentage inputs are converted once against the remaining
adjustable bill or line amount with integer half-up rounding; the fixed result,
source input, eligible amount, target snapshot, reason, and approval metadata
are persisted. Refunds draw only from the original payment's effective,
unallocated, unrefunded credit. A reversed refund restores that refundable
capacity; allocations are never silently removed.

Generic ledger reversal appends one exact opposite posting. It rejects a prior
reversal, reversal-of-reversal, settled/adjusted bills, and allocated/refunded
payments. Specialized metadata remains immutable and historically readable.
All posting commands lock session then admission, use serializable transactions,
and compare idempotent retries against the original immutable command snapshot.
Bill/payment detail collections are independently paginated.

Session overview defines collection rate as effective net cash (payments minus
refunds) divided by effective billed ledger facts, rounded half-up to basis
points. The collection register is a paginated immutable payment/refund fact
view. Fee-element reporting uses bill-line snapshots and line-targeted
adjustments; it does not invent a fee-element attribution for bill-level cash
allocations. Class snapshots aggregate immutable bill/class snapshots, live
allocations, and live adjustments. Reports stay currency-separated and expose
no due-date, overdue, or aging concepts.

## Authorization

OPA actions remain operation-specific. Backend middleware is authoritative; UI
visibility is only a convenience.

| Capability | Principal | Manager | Accountant | Platform admin | Teacher / exam coordinator |
| --- | --- | --- | --- | --- | --- |
| Read session/admission pricing | Yes | Yes | Yes | Yes | No |
| Update session/admission pricing | Yes | Yes | Yes | Yes | No |
| Read billing runs, reports, and admission ledgers | Yes | Yes | Yes | Yes | No |
| Post billing runs/manual bills | Yes | Yes | Yes | No | No |
| Payments, discounts/waivers/write-offs | Yes | Yes | Yes | No | No |
| Refunds and reversals | Yes | Yes | Yes | No | No |
| Finance documents | Yes | Yes | Yes | Read only | No |

Phase 1 declares the pricing and future operational-read boundaries:

- `READ_SESSION_FINANCE` / `UPDATE_SESSION_FINANCE`
- `READ_ADMISSION_FINANCE` / `UPDATE_ADMISSION_FINANCE`
- `READ_BILLING_RUNS`
- `READ_BILLING_REPORTS`
- `READ_ADMISSION_LEDGER`

Later phases add separate posting, payment, adjustment, refund, reversal, and
document actions. They must grant principal, manager, and accountant equivalent
finance authority while keeping platform administrators read/pricing-only.

## Testing contract

Finance integration tests use the repository's real PostgreSQL, Redis, OPA,
MinIO, and Gotenberg harness. `packages/api/test/finance` supplies isolated
multi-session scenarios and the complete actor matrix. Tests use fresh schools
and admissions rather than a shared ledger, exercise routers rather than mocked
services, distinguish authorization denial from tenant-ID not-found behavior,
and verify persisted state after every mutation.
