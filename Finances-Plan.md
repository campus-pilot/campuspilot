# Finances and Billing Implementation Plan

Status: proposed implementation plan based on a source-level review of `../school-app` and the current CampusPilot repository.

## 1. Outcome

The new finance system should treat an **admission as the durable financial account**. A `student` row is only that admission's enrollment in one academic session and must never own the account.

Every posted financial fact must therefore carry:

- `schoolId` as the tenant boundary;
- `admissionId` as the durable account owner;
- `sessionId` as explicit accounting/billing context;
- an optional historical `studentId`/enrollment identifier used only to record which enrollment supplied class, section, and roll information at posting time;
- immutable snapshots of the admission, class, section, fee element, currency, and resolved pricing rule needed to explain the posting later.

This produces one admission-wide ledger that survives class changes, session promotion, enrollment deletion, unregistration, and later configuration edits. Management can filter it to one session, while a future student portal can query the same admission account across all sessions.

The implementation should preserve useful ideas from the old application—fee configuration, session/class/admission inheritance, generation readiness checks, billing runs, bill line snapshots, payment receipts, statement cutoffs, and ledger summaries—without carrying forward its enrollment-owned ledger, floating-point calculations, mutable historical documents, or incomplete correction model.

## 2. Scope

### In scope

- Finance terminology and domain rules.
- Exact-money representation.
- Fee configuration and value resolution.
- Admission-owned bills, account-credit payments, discounts/waivers, refunds, reversals, and ledger reads.
- Session billing runs and manual admission charges.
- Admission-lifetime and session-filtered summaries.
- Bill and receipt artifacts/templates.
- OPA permissions and tenant/ownership validation.
- Management Billing and Admission Ledger experiences.
- Read-model boundaries suitable for a future student/guardian portal.
- Migrations, tests, reconciliation, and rollout.

### Not in the first implementation

- Importing production data from `../school-app` (it is a reference implementation, not a migration source unless separately requested).
- A student portal UI or payment-gateway integration.
- Payroll, expenses, vendor accounting, or general double-entry bookkeeping.
- Tax/GST calculation, proration, installment plans, late-fee automation, or scholarships beyond explicit adjustment records, unless Phase 1 adopts those requirements.

## 3. Phase 0 — Documentation discovery and legacy findings

### 3.1 Legacy terminology

| Legacy term | Meaning in the old application | New meaning/direction |
| --- | --- | --- |
| Finance schema | School JSON defining currency, one recurrence, and fee elements | Session finance configuration defining the pricing rules applicable to that session |
| Finance value/config | JSON amount maps on session, class, and student enrollment | Session base values, session-specific class overrides, and session-specific admission overrides |
| Bill generation event | Header for a batch run | Billing run: an immutable, explicitly scoped posting command/result |
| Student bill event | One enrollment's charge and line-item snapshot | Admission bill: a debit owned by `admissionId`, attributed to `sessionId`, with enrollment snapshots |
| Ledger event | Payment plus an embedded discount | One immutable debit/credit posting with a specific type; payment and discount are separate facts |
| Projection | Running totals keyed by `studentId` | Rebuildable admission/currency balance cache; never the source of truth |
| Individual bill | Ad-hoc amount plus a note | Manual bill with structured lines, reason, session attribution, and normal audit/reversal rules |
| Monthly bill | Statement from month start through a cutoff | An as-of statement generated from immutable admission postings |

### 3.2 What the old backend does

The old model is documented in `../school-app/packages/orpc/modules/billing/README.md`, `../school-app/packages/entity/{finance,billing}/*.ts`, and `../school-app/db/schema.ts:201-266`.

- `school.financeSchema` defines fee elements.
- Amounts cascade through `school_session.financeConfig`, global `class.financeConfig`, and session-enrollment `student.financeConfig`.
- A batch creates one `bill_generation_event` plus one `student_bill_event` per enrollment.
- Per-enrollment projections accumulate total billed, paid, discounted, and outstanding.
- `recordPayment` writes one `PAYMENT` event with both an amount and a discount.
- Outstanding is `total billed - total paid - total discount`.
- Billing and receipt PDFs are generated from Handlebars templates and S3 artifacts.

Fee resolution in `../school-app/packages/orpc/modules/billing/generate-bill.ts:28-57` is:

1. enrollment/student value;
2. class value;
3. session value;
4. bill-run class value;
5. bill-run school value;
6. element default.

Useful patterns to retain are the pure resolver with source capture, a grouped readiness report, an atomic header/details posting transaction, immutable line-item values, and cutoff-based statement calculations.

### 3.3 The legacy defect and related accounting gaps

The reported cross-session issue is confirmed by the schema:

- `student` is unique per `(admissionId, sessionId)` in `../school-app/db/schema.ts:103-118`.
- Bills, payments, and both projections use `studentId` in `../school-app/db/schema.ts:217-266`.
- The portal selects the active/latest enrollment and passes only that enrollment ID to the ledger.

Old records remain in the database, but the next session creates a new student ID and therefore a new empty projection. The UI makes prior-session money appear to have disappeared.

Other gaps that must not be copied:

- only `NEW` bill and `PAYMENT` ledger event types exist;
- discounts are embedded in payments and have no reason, approver, bill/line allocation, or independent reversal;
- no refunds, payment reversals, bill voids, write-offs, allocations, receipt register, or stable human document numbers exist;
- `force` creates another charge for the same period instead of superseding/reversing anything;
- monthly duplicate checks are used even for quarterly/yearly configuration;
- readiness is a separate endpoint and can be bypassed by calling generation directly;
- custom bills cannot be referenced by payments;
- overpayment silently creates a negative outstanding balance;
- projections and version increments are vulnerable to concurrent read-increment-write races;
- historical receipts use current totals, current year, current class/section, and current currency when regenerated;
- many handlers authorize a supplied school but do not prove that every supplied entity belongs to that school;
- database `numeric` values are converted to JavaScript `Number`;
- there are no finance/billing automated tests.

### 3.4 What already exists in CampusPilot

The new repository has the correct identity split:

- `admissionTable` is durable: `packages/db/src/schema/admission.ts:23-60`.
- `studentTable` explicitly represents an admission enrolled in a session and is unique by `(admissionId, sessionId)`: `packages/db/src/schema/student.ts:15-52`.
- Session finance configuration and class overrides already live on `school_session`: `packages/db/src/schema/session.ts:22-41`.
- Admission-specific values are already partitioned by session in `admission.finance_config`: `packages/db/src/schema/admission.ts:51-58` and `packages/db/src/schema/jsonb/finance-config.ts:101-111`.
- Sensitive session finance has dedicated `getSessionFinance`/`updateSessionFinance` DTOs and permissions: `packages/api/src/routers/school/session-finance/`.
- The Management app already has placeholders for session Billing and admission Ledger, and Ledger already appears in the admission detail navigation.

Two current issues should be fixed before broader finance work:

1. The general admission DTO exposes `financeValue`, even though admission reads are available to roles such as teachers. Move the field behind a dedicated restricted finance DTO/route.
2. Billing navigation and the admission Ledger section are not yet wrapped in dedicated finance read permissions.

### 3.5 Allowed implementation patterns

- Drizzle tables, explicit foreign keys/indexes/checks, generated IDs, and generated migrations.
- oRPC protected procedures with route metadata, top-level Zod inputs, dedicated DTOs, and standard pagination helpers.
- Rego catalogs/grants as the authorization source of truth; regenerate generated TypeScript rather than editing it.
- Database transactions, ordered row locks, idempotency keys, and database uniqueness for every posting command.
- Immutable postings plus explicit correcting/reversing postings.
- TanStack Query in Management app adapters.
- TanStack Form `useForm` plus Zod validators for every input workflow.
- Reusable callback-driven presentation in `@campuspilot/components`; API calls remain in `apps/management`.
- Existing immutable document template/artifact concepts for bills and receipts.
- Direct HTTP only when a binary/blob flow needs it; normal operations stay in oRPC.

## 4. Canonical domain model

### 4.1 Identity and scope

```text
Admission (durable account)
  ├─ Student enrollment for Session A ── class/section used for Session A pricing
  ├─ Student enrollment for Session B ── class/section used for Session B pricing
  └─ Finance ledger (all sessions)
       ├─ Session A bills/payments/adjustments
       ├─ Session B bills/payments/adjustments
       └─ admission-wide account balance and brought-forward balance
```

Rules:

- Persist `admissionId` as the FK and query key. `admissionNo` is a human identifier/snapshot, not the relational identity; it is not currently unique in CampusPilot.
- Require clients to send `sessionId`; never infer the active session.
- For billing, the server resolves the enrollment with `(schoolId, admissionId, sessionId)` and derives class/section from it. A client-supplied class is never authoritative.
- Financial history must not cascade-delete with a student/enrollment row. Historical enrollment/class/section IDs are provenance values, accompanied by immutable labels and roll/admission snapshots.
- A session filter narrows an admission ledger; it does not change ledger ownership.
- A payment belongs to the admission. Its `sessionId` records the session in which it was received/accounted. It is an account-level credit and never identifies or settles an individual bill.

### 4.2 Canonical terms

- **Fee element**: a configured category such as Tuition, Transport, Lab, Examination, or a manual fee head.
- **Pricing value**: the configured amount for a fee element at session, class, admission, or billing-run scope.
- **Billing period**: an explicit start/end/key calculated from the configured cadence and timezone.
- **Billing run**: one idempotent batch that posts bills for eligible admissions in one session/period.
- **Bill**: one admission's posted debit, containing immutable line items and enrollment/pricing snapshots.
- **Payment**: money received from/for an admission. It is not a discount.
- **Account credit**: a payment received against the admission account, independent of any individual bill.
- **Adjustment**: a non-cash debit or credit such as discount, waiver, write-off, or correction.
- **Refund**: money returned against a recorded payment.
- **Reversal**: a new opposite posting that cancels an erroneous posting without deleting it.
- **Ledger entry**: the append-only debit/credit accounting fact underlying a bill, payment, adjustment, refund, or reversal.
- **Statement**: an as-of view/document calculated from postings up to a cutoff; it is not a new charge.
- **Receipt**: an immutable numbered document for a payment/refund fact.

### 4.3 Money rules

- Store operational accounting amounts as integer minor units (`amountMinor`, PostgreSQL `bigint`) plus an explicit ISO currency code.
- API money inputs should be decimal strings or minor-unit integers validated and converted once on the server. Do not calculate money with binary floating-point numbers.
- Configuration should migrate from JSON numbers to minor-unit integers before posting starts. If a compatibility input accepts decimal numbers temporarily, it must normalize immediately and must not become the source of truth.
- Every bill, payment, adjustment, refund, ledger entry, and document snapshot stores currency.
- Never aggregate different currencies. Admission-lifetime balances are grouped by currency even if the school currently uses only one.
- Zero is a valid configured fee value; blank means inherit/missing. Posted ledger entries must be strictly positive and use a separate debit/credit direction.

### 4.4 Pricing resolution

For ordinary fee elements, resolve in this order:

1. admission override for the selected session;
2. class override for the selected session and resolved enrollment class;
3. session element base amount/default;
4. unresolved.

For `requiredAtLevel: bill_generation` elements:

1. explicit billing-run class value, when class scope is allowed;
2. explicit billing-run school/session value, when school scope is allowed;
3. omitted from the bill when neither command value is present.

Bill-generation elements are optional for every run. Blank means the charge is
not assigned by that command, while an explicit zero remains a configured value.
Persisted admission overrides and configured defaults do not silently opt a
student into this category.
Billing-run values are inputs only for elements declared as bill-generation
values. They are not a generic way to overwrite all persisted prices.

The resolver returns `{ amountMinor, sourceKind, sourceId/sourceKey }`. The exact resolved output is copied into the bill line. Readiness preview and posting must call the same resolver and validator.

### 4.5 Posting invariants

- Posted bills, ledger entries, payments, adjustments, refunds, receipt numbers, and bill numbers are immutable.
- Corrections append reversals/adjustments; they never update or delete posted monetary facts.
- Each command accepts an idempotency key, unique within a school and operation type.
- Every reversal references one original entry; an entry can be reversed only once unless a later explicit reversal-of-reversal policy is added.
- Backdated `effectiveAt` and actual `recordedAt` are independent facts. Admission ledger sequence reflects insertion order; accounting views sort by effective date with sequence as a deterministic tie-breaker.
- Projections are caches. They must be rebuildable from the immutable ledger and continuously reconciled in tests/operations.
- Credit balances are represented explicitly and labelled as credit; they must not be displayed as a confusing negative due amount.

## 5. Proposed database model

Add ID prefixes to `packages/db/src/id.ts`, export tables from `packages/db/src/schema/index.ts`, and place the new schema in a focused `packages/db/src/schema/finance.ts` (split further only if the file becomes unwieldy).

### 5.1 Configuration

Retain the session-owned configuration boundary, but revise the Zod types in `packages/db/src/schema/jsonb/finance-config.ts`:

- currency;
- school timezone used for billing-period boundaries;
- billing cadence and anchor;
- due-date rule;
- fee elements with stable slug, display name, allowed scopes, billing behavior, required level, and base amount in minor units;
- session-specific class overrides in minor units;
- admission-specific session overrides in minor units.

Add validation that `requiredAtLevel` is compatible with `scopes`. Removing or renaming a fee element must not mutate historical bill lines.

Prefer a dedicated restricted admission-finance route for admission overrides. The general admission DTO must omit them.

### 5.2 Operational tables

| Table | Purpose and important fields | Constraints/indexes |
| --- | --- | --- |
| `finance_bill_run` | Batch header: school, session, period key/start/end, issue date, cadence, status, config hash/snapshot, run inputs, totals, creator, recorded time, idempotency key | unique idempotency key; one regular posted run per school/session/period; supplemental runs require explicit kind/reason |
| `finance_ledger_entry` | Append-only fact: school, admission, session, sequence, type, debit/credit, amount minor, currency, effective/recorded timestamps, recorder, note, reversal reference, idempotency key | amount > 0; unique admission/currency/sequence; unique reversal target; school-scoped idempotency; indexes for admission/session/time |
| `finance_bill` | One admission bill: optional run, linked debit ledger entry, source kind, human bill number, issue/due dates, admission/enrollment/class/section snapshots, total/currency | unique bill number per school; unique ledger entry; run/admission indexes |
| `finance_bill_line` | Immutable fee lines: bill, order, fee slug/name, amount, resolution source, pricing-rule snapshot, optional manual reason | amount >= 0; deterministic order; bill index |
| `finance_payment` | Payment metadata linked to one credit ledger entry: receipt number, method, external reference, payer, received time | unique receipt number per school; unique ledger entry; searchable method/reference/time indexes |
| `finance_payment_allocation` | Deprecated compatibility storage for facts created before account-credit payments were adopted | no API creates or reads rows; retain only so already-applied migrations and historical databases remain readable until a dedicated cleanup migration |
| `finance_adjustment` | Discount, waiver, write-off, debit correction, or credit correction linked to its ledger entry and optionally a bill/line | explicit reason code/note; optional approver; unique ledger entry; no embedded adjustment on payment |
| `finance_refund` | Refund debit linked to an original payment, with refund number, method/reference, reason, and recorder | cannot exceed unreversed/unrefunded payment; currency/admission match; unique ledger entry |
| `finance_number_counter` | Serialized school/fiscal-period counters for bill, receipt, and refund numbers | unique school/document-kind/fiscal-key; row locked during allocation |
| `finance_admission_balance` | Rebuildable lifetime balance cache by school/admission/currency, last sequence, debit/credit totals | PK/unique school/admission/currency; never authoritative |
| `finance_admission_session_activity` | Rebuildable activity cache by school/admission/session/currency for fast session views | unique school/admission/session/currency; semantics are entry attribution, not payment allocation |

Use composite tenant integrity where practical: add unique candidate keys such as `(id, school_id)` to parent tables and composite foreign keys from finance rows. Where a historical source ID intentionally has no FK, document that choice as in `packages/db/src/schema/artifact.ts:27-67` and always store the school plus human snapshot.

### 5.3 Ledger entry types and balance signs

| Entry type | Direction | Effect |
| --- | --- | --- |
| `bill` | debit | increases amount due |
| `manual_debit_adjustment` | debit | increases amount due |
| `payment` | credit | reduces the admission account balance or creates account credit |
| `discount` / `waiver` / `write_off` | credit | reduces a specific bill/line balance without cash collection |
| `refund` | debit | returns cash and increases the account balance accordingly |
| `reversal` | opposite of target | cancels a posted fact with a traceable counter-entry |

Admission balance is `sum(debits) - sum(credits)` for one currency. Positive is due; zero is balanced; negative is credit.

Bills remain immutable charge documents. Bill-specific adjustments produce a net charge, while payment state is represented only by the admission-wide balance; an account payment never marks a particular bill as settled.

### 5.4 Snapshot requirements

At bill posting, capture at least:

- admission ID, admission number, and display name;
- session ID and start/end year labels;
- source enrollment/student ID as a historical string;
- class ID/slug/label, section ID/slug/label, and roll number;
- fee element slug/name;
- resolved amount, source kind, and the source key/value used;
- currency, billing period, issue date, and due date;
- configuration hash/revision used by the preview/post command.

Generated documents must use these snapshots and as-of ledger facts, never current admission/class/session configuration.

## 6. API and service design

Create a focused module under `packages/api/src/routers/school/billing/`, composed into `packages/api/src/routers/school/school.router.ts`. Keep pure calculations and posting services separate from route handlers so preview, posting, reconciliation, and tests share the same logic.

### 6.1 Configuration APIs

- Keep `getSessionFinance` / `updateSessionFinance` for restricted session configuration.
- Add `getAdmissionFinanceValues({ schoolId, admissionId, sessionId })`.
- Add `updateAdmissionFinanceValues({ schoolId, admissionId, sessionId, values })`.
- Remove `financeValue` from general admission create/read/update DTOs once the dedicated API is available.
- Validate school, session, admission, fee-element, and allowed-scope relationships independently.

### 6.2 Billing run APIs

- `previewBillingRun`
  - input: school, explicit session, period/date, run-time values, optional admission/class selection;
  - output: configuration hash, eligible/skipped counts, totals, per-scope issues, and a paginated/reviewable breakdown;
  - no financial writes.
- `postBillingRun`
  - input: preview inputs, `expectedConfigurationHash`, idempotency key, and explicit regular/supplemental intent;
  - lock session/config and relevant enrollments/admissions in deterministic order;
  - rerun the same validator/resolver;
  - reject stale previews or duplicate regular periods;
  - write run, bills, lines, ledger entries, and projections atomically.
- `listBillingRuns` and `getBillingRun`
  - standard pagination/filtering by session, period, kind, recorder, and date;
  - detail returns admission bill rows and snapshot line details.
- `createManualBill`
  - explicit school/admission/session;
  - one or more structured fee lines, due date, reason, idempotency key;
  - resolve enrollment only for snapshot context; allow arrears handling under the adopted unregistered-admission policy.
- `reverseBill` / `reverseBillingRun`
  - privileged, reason-required correcting postings;
  - reject reversal where live bill-specific credit adjustments require coordinated reversal unless the transaction performs the complete correction.

There is no `force` duplicate-generation flag. A legitimate second charge in a period is an explicit supplemental run with a reason; an erroneous run is reversed.

### 6.3 Ledger and payment APIs

- `getAdmissionLedger({ schoolId, admissionId, sessionId?, currency?, page/cursor, filters })`
  - admission-wide by default;
  - optional session attribution filter;
  - returns opening/closing balances for the requested window, chronological bill/payment/adjustment/refund entries, and per-session summaries.
- `getAdmissionFinanceSummary`
  - lifetime balances by currency, selected-session activity, brought-forward balance, current due or credit, and posted/reversed bill counts.
- `listAdmissionBills` / `getAdmissionBill`.
- `listPayments` / `getPayment` with server-side admission number/name, method, reference, session, date, and status filters.
- `recordPayment`
  - amount, currency, method, reference, received/effective time, note, and idempotency key;
  - creates an admission-level credit entry, payment metadata, receipt number, and projection updates atomically, without accepting bill IDs.
- `recordAdjustment`
  - explicit type, amount or percentage input, target bill/line, reason, approval metadata, idempotency key;
  - percentage is converted to a fixed minor-unit amount and that fixed result is posted.
- `recordRefund` and `reverseLedgerEntry`
  - permission-separated, reason-required, immutable correction operations.

Every handler must constrain all identifiers together (`schoolId`, `admissionId`, `sessionId`, bill/payment IDs). Authorization of one supplied school is not proof that the remaining IDs belong to it.

### 6.4 Read/report APIs

- Session overview: billed, cash collected, discounts/waivers, refunds, due, credit, collection rate, admissions billed.
- Outstanding/aging report by admission and due-date bucket.
- Collection register by date, method, recorder, and external reference.
- Fee-element collection report.
- Class-wise billing/collection report using bill snapshots, not current placement.
- Reconciliation endpoint comparing immutable postings with projections.
- CSV export can be a later subphase, but list/report DTOs must be paginated and export-friendly from the start.

Define collection rate explicitly. Recommended default: cash collected net of refunds divided by bill debits, while discounts/waivers are reported separately rather than counted as collection.

### 6.5 Concurrency and consistency

- Preview returns a hash over the session config, relevant class/admission overrides, eligible enrollments, and run inputs.
- Posting locks the session first, then admissions/projection rows ordered by ID to avoid deadlocks.
- Unique constraints are the final defense against duplicate periods, document numbers, idempotency reuse, sequence races, and double reversal.
- Payment writes lock the admission account before appending the account credit.
- A transaction either posts all bills/lines/entries/projections or none.
- Projection rebuild reads ledger entries in sequence order and atomically replaces cached totals.
- Document rendering/storage is not part of the PostgreSQL transaction. Persist a retryable artifact job/status or compensate uploaded objects consistently with the current document subsystem.

## 7. Authorization plan

Add separate Rego actions rather than one broad finance mutation permission:

- read finance configuration;
- update session/admission pricing values;
- read billing runs and reports;
- preview/post billing runs;
- create manual bills;
- read admission ledgers;
- record payments;
- grant discounts/waivers/write-offs;
- issue refunds;
- reverse bills/ledger entries;
- read/generate/delete finance documents.

Recommended initial grants, preserving existing intent:

| Capability | Principal/manager | Accountant | Teacher/exam coordinator | Platform admin |
| --- | --- | --- | --- | --- |
| Read finance/billing/ledger | Yes | Yes | No | Explicit read grant |
| Update pricing configuration | Yes | Yes (matches current behavior) | No | Explicit update grant |
| Preview/post billing runs and manual bills | Yes | No | No | Only if explicitly granted |
| Record payments | Yes | Yes | No | Only if explicitly granted |
| Discount/waiver/write-off | Yes | Product decision for accountant | No | Only if explicitly granted |
| Refund/reversal | Yes | Product decision, preferably restricted | No | Only if explicitly granted |

Implementation workflow:

1. Edit `packages/opa/src/policies/school/catalog.rego`, school grants, system grants, and policy tests.
2. Run `pnpm --filter @campuspilot/opa generate:actions`.
3. Use generated `SCHOOL_ACTIONS` in backend middleware and exact `RequirePermissions` gates in Management.
4. Never edit `packages/opa/src/generated/*` manually or check raw role names in handlers.

The future student portal needs a separate authenticated user-to-admission ownership boundary. It must not receive a school staff finance role or prove ownership through a current `student` row.

## 8. Management application plan

Use the routes already reserved by the application rather than copying the old app's route tree.

### 8.1 Session Billing workspace

Build under:

- `/school/[schoolId]/sessions/[sessionId]/billing` — overview and readiness;
- `/billing/runs` and `/billing/runs/[billRunId]` — paginated history/detail;
- `/billing/payments` — payment register and admission search;
- `/billing/reports` — aging, collection, fee-element, and class reports.

The workspace should use route-backed secondary navigation on desktop and a section selector on mobile, following the admission/classroom patterns.

Overview:

- selected-session billed, collected, discounted/waived, refunded, due, credit, and collection rate;
- recent billing runs and payments;
- persistent `AppShellAlert` when finance configuration or required values are incomplete, with a permission-gated action to the existing finance editor;
- one primary `Create billing run` action for authorized users.

Billing-run flow:

1. Choose the explicit period/date, run type, and classes. All classes are selected by default and edited through a compact popover.
2. On a separate step, optionally enter school-wide or per-class bill-generation values. Blank values create no charge.
3. Call preview and show grouped issues by session, class, and admission.
4. Review eligible admissions, line totals, skipped records, and the configuration hash.
5. Confirm that entered run values become immutable bill-line snapshots, then post with the app dialog.
6. On a stale preview, retain the user's draft, refresh the review, and require confirmation again.
7. Show the posted run detail, document status, and any permitted reversal action.

Use operational tables with `TableSearchBar` and `TableFilterBar`, standard compact density, pagination, and local horizontal scrolling. Do not recreate the old hover-only billing calendar as the primary control.

### 8.2 Admission Ledger workspace

Replace the existing placeholder at `/school/[schoolId]/admission/[admissionId]/ledger`.

- Header summaries: total due or credit, billed, collected, adjustments, refunds.
- Default to All sessions, with an explicit session filter and brought-forward balance.
- Paginated chronological ledger table/timeline with entry type, effective date, session, debit, credit, balance, recorder, reference, and reversal status.
- Bill detail exposes line items and pricing/enrollment snapshots.
- Payments expose receipt, refund history, and remaining refundable amount.
- Permission-gated actions: manual bill, record payment, adjustment, refund, reversal, statement.
- Keep section navigation in the existing admission sidebar/mobile selector; do not duplicate Ledger in an action menu.

The ledger remains readable after admission unregistration. Whether collection/correction actions remain enabled follows the Phase 1 policy decision.

### 8.3 Forms and interaction rules

- Use TanStack Form with Zod validators for billing run inputs, manual charges, payments, adjustments, refunds, and statement cutoffs.
- Show adjacent validation errors and derive pending/submit state from `form.Subscribe`.
- Preserve blank versus zero.
- Do not add `useEffect` for form synchronization; use keyed component lifecycles, event handlers, and query/form baselines.
- Use app dialogs for posting confirmation, reversal, refund, discard, and navigation guards.
- API orchestration belongs in `apps/management/components/billing/*`; reusable views belong in `packages/components/src/finance/*` and receive data/callback props.
- Permission-gate both protected reads and each mutation entry point. Backend middleware remains authoritative.
- Do not expose Ledger navigation to general admission readers who lack finance-read permission.

### 8.4 Bill and receipt templates/documents

The existing Bill and Receipt settings pages are placeholders. Extend the current immutable document subsystem rather than restoring the legacy mutable artifact approach.

- Extend document types with `bill`, `receipt`, and optionally `statement`.
- Add typed finance document sources/contexts that reference `billId`, `paymentId`, `admissionId`, and session snapshots.
- Add explicit historical source identifiers to artifacts; do not overload `studentIds`.
- Pin every generated PDF to an immutable template revision.
- Store bill/receipt/refund numbers in finance tables before rendering.
- Render historical values and balances as of the source ledger sequence.
- A later template change creates a new artifact revision; it does not rewrite the original financial fact or silently replace a prior receipt.
- Reuse signed downloads, storage compensation, deletion states, sanitization, Gotenberg limits, and PDF verification from `packages/api/src/routers/school/document/README.md`.

## 9. Student portal readiness

The database and backend should make a future portal straightforward even though portal UI is not part of this delivery.

- Portal URLs and API identity use `admissionId`.
- A guardian/user may be linked to multiple admissions; ownership is an explicit association, not an email or current-enrollment inference.
- Portal-safe reads return the admission-wide balance, sessions, bills, payments, receipts, and statements, with optional session filters.
- Historical data remains visible after promotion because no query starts from the current student ID.
- Portal DTOs omit staff-only notes, approval details, internal idempotency keys, and sensitive recorder data.
- Portal downloads authorize admission ownership before returning a short-lived signed URL.
- Keep future portal mutations (online payments, disputes, receipt requests) separately permissioned and out of the first release.

## 10. Product decisions required before schema freeze

The repository and old application do not define these policies. Resolve them in Phase 1 rather than encoding assumptions in handlers:

1. Is `admissionNo` unique within a school? Recommended: audit duplicates and add `(schoolId, admissionNo)` uniqueness for lookup, while continuing to use `admissionId` as every FK.
2. What are the exact billing-period boundaries for monthly/quarterly/yearly cadence, which timezone applies, and is a quarter calendar- or session-anchored?
3. How is due date calculated, and what constitutes overdue?
4. Can regular bills be posted for inactive sessions? Recommended: read/correct historical sessions, but require an elevated explicit action for new backdated charges.
5. Can an unregistered admission receive late payments/refunds/corrections? Recommended: yes for settlement/correction; no new recurring batch bills.
6. Payments are admission-level account credits and are never allocated to individual bills.
7. Is overpayment allowed? If yes, require explicit confirmation and display it as admission credit.
8. Which roles/approval limits apply to discounts, waivers, write-offs, refunds, and reversals?
9. What are the human bill/receipt/refund number formats and fiscal reset rules?
10. Are percentage discounts, scholarships, installments, proration, taxes, late fees, and gateway payments required in v1 or deliberately deferred?

Record the accepted answers as JSDoc/domain documentation and API tests. Do not infer one policy from another.

## 11. Consecutive implementation phases

Each phase is intentionally self-contained so it can be executed in a fresh task context.

### Phase 1 — Domain decisions and restricted configuration boundary

What to implement:

- Resolve and document every decision in Section 10.
- Write `packages/api/src/routers/school/billing/README.md` with terminology, money rules, resolution precedence, lifecycles, account-credit policy, correction rules, and permission matrix.
- Remove finance overrides from general admission DTOs and add dedicated read/update finance routes.
- Add new Rego actions/grants/tests needed for configuration and future operational reads.

References to copy:

- Restricted DTO/router boundary: `packages/api/src/routers/school/session-finance/`.
- Rego workflow: `packages/opa/src/policies/school/catalog.rego`, `grants.rego`, `permissions_test.rego`, and system grants.
- Admission reference validation: `packages/api/src/routers/school/admission/admission.router.ts:64-131`.

Verification:

- General admission/session/student DTO tests prove no restricted finance field leaks.
- Principal/manager/accountant/platform behavior matches the approved matrix; teacher access is denied.
- `pnpm --filter @campuspilot/opa check` and focused API integration tests pass.

Anti-pattern guards:

- No direct role-name checks.
- No generated OPA edits.
- No active-session inference.

### Phase 2 — Exact-money configuration and database foundation

What to implement:

- Convert finance configuration values to the approved minor-unit representation with an explicit migration/compatibility strategy.
- Add finance enums, ID prefixes, operational tables, constraints, indexes, relations, and schema exports from Section 5.
- Add the generated migration and startup/migration-runner coverage.
- Add database-level tenant integrity and deletion restrictions for admissions/sessions that have finance history.
- Add reconciliation/projection rebuild primitives before using projections in reads.

References to copy:

- Immutable historical entity style: `packages/db/src/schema/artifact.ts:27-67`.
- Current session/admission/student ownership: `packages/db/src/schema/{session,admission,student}.ts`.
- ID prefix pattern: `packages/db/src/id.ts:6-23`.

Verification:

- Inspect generated SQL; do not handwave Drizzle output.
- Integration tests cover check constraints, composite tenant mismatches, duplicate numbers/idempotency, forbidden cascades, sequence uniqueness, and projection rebuild.
- Test amount conversion boundaries and currencies with non-two-decimal minor units if supported.

Anti-pattern guards:

- No money `number` arithmetic in the accounting domain.
- No JSONB ledger/history blob.
- No `studentId` owner FK.
- No cascade deletion of posted finance history.

### Phase 3 — Shared pricing/readiness engine and billing posting

What to implement:

- Pure config validator and fee resolver with the precedence in Section 4.4.
- Period calculation using approved cadence/timezone rules.
- Preview hash and grouped readiness issues.
- Idempotent regular/supplemental billing-run posting with ordered locks.
- Manual bills and bill/run reversal flows.
- Admission and session projections updated transactionally and rebuildably.

References to copy/adapt:

- Pure resolver/source snapshot concept: `../school-app/packages/orpc/modules/billing/generate-bill.ts:28-57`.
- Grouped readiness issue concept: `../school-app/packages/orpc/modules/billing/check-can-generate.ts`.
- Review/hash/stale-write pattern: `packages/api/src/routers/school/exam/README.md` and exam plan generation.
- Transaction and row-lock style: current session finance and exam routers.

Verification:

- Unit/table tests cover every precedence combination, blank versus zero, missing values, period boundary, and snapshot output.
- Concurrency tests prove duplicate calls create one run and stale previews create none.
- Failure at any bill/line/projection step rolls back the whole run.
- Moving an admission to a later session leaves its prior ledger intact and starts no new account.

Anti-pattern guards:

- Preview is not the only enforcement; posting recomputes it.
- No force duplicate mode.
- No live config joins for previously posted bills.

### Phase 4 — Account-credit payments, adjustments, refunds, and ledger reads

What to implement:

- Admission-wide ledger and finance summary services.
- Idempotent admission-account payment posting.
- Separate discount/waiver/write-off records.
- Refund and reversal commands.
- Paginated bill/payment/ledger/report routes.
- Stable human numbering and as-of balances for receipts.

References to copy/adapt:

- Standard pagination: `packages/api/src/paginations/index.ts` and student list routes.
- Typed route/middleware structure: `packages/api/src/routers/school/session-finance/session-finance.router.ts`.
- As-of cutoff concept: `../school-app/packages/orpc/modules/billing/aggregate-bill-context.ts`.

Verification:

- Test account credits, overpayment/negative balances, bill independence, discount-only adjustment, refund limits, one-time reversal, and concurrency.
- Test lifetime ledger plus every session filter, opening/brought-forward balance, and multiple currencies.
- Tenant/admission/session mismatch tests exist for every route.
- Rebuild projections and compare every total with source postings.

Anti-pattern guards:

- No discount field on payment.
- No payment reference to only a batch header.
- No mutation/delete of existing ledger entries.
- No unpaginated operational collections.

### Phase 5 — OPA completion and Management UI

What to implement:

- Finish operation-specific Rego actions and grants, generate contracts, and add allow/deny coverage.
- Replace Billing and Ledger placeholders with the workspaces in Section 8.
- Add exact permission gates to navigation, protected reads, and mutation controls.
- Implement all forms with TanStack Form/Zod and standard feedback/dialog patterns.
- Add AppShell finance-setup alerts and route metadata/breadcrumbs.

References to copy:

- UI rules: `apps/management/docs/ui-patterns.md:10-155,227-244`.
- Operational tables: `apps/management/components/admission-table.tsx` and shared data grid.
- Detail workspace: `apps/management/components/admission-workspace.tsx`.
- API adapter: `apps/management/components/session/session-finance-settings.tsx`.
- Existing reusable finance editor: `packages/components/src/session/session-finance-view.tsx`.

Verification:

- Authenticated browser checks at 320px, 390px, and desktop for empty, configured, posted, credit, overdue, error, stale-preview, and permission-denied states.
- Confirm no page-level horizontal overflow and keyboard/mobile usability.
- Confirm accountants do not see bill/refund actions they lack and teachers do not see finance reads.
- Type checks supplement but do not replace browser and integration evidence.

Anti-pattern guards:

- No API calls in shared components.
- No standalone input/submission `useState`, unapproved `useEffect`, native dialogs, hover-only primary actions, or local oversized controls.
- Do not copy old-app TSX/components wholesale.

### Phase 6 — Bill, receipt, and statement documents

What to implement:

- Extend document types/catalog/DTO/context/rendering for bills, receipts, and statements.
- Turn existing bill/receipt settings placeholders into the shared immutable template workflow.
- Generate finance artifacts from posted snapshots and as-of ledger sequence.
- Add single/bulk generation, history, signed download, retry/deletion behavior, and template-revision provenance.

References to copy:

- `packages/api/src/routers/school/document/README.md`.
- `packages/db/src/schema/artifact.ts`.
- Existing document template/editor/history Management components.
- Legacy billing context types only as a variable-inventory reference: `../school-app/packages/entity/billing/billing.schema.ts`.

Verification:

- Render PDFs and verify page count/dimensions/content.
- Regenerating an old receipt after later transactions preserves its number and as-of previous/remaining balance.
- Renaming/moving/deleting an enrollment does not change an old bill.
- Template changes create immutable revisions; signed downloads remain authorized.
- Storage/conversion failure and cleanup paths have integration coverage.

Anti-pattern guards:

- No live class/currency/config lookup for historical documents.
- No mutable S3 key overwrite as document history.
- No raw S3 keys or long-lived signed URLs in client caches.

### Phase 7 — Reporting, reconciliation, and portal-ready boundary

What to implement:

- Session dashboard/report routes and UI.
- Projection reconciliation/rebuild administration with observable mismatches.
- Portal-safe admission finance DTOs and an explicit ownership middleware contract, without exposing portal UI yet.
- Retention/index/performance review using realistic admission and ledger volumes.

References to copy/adapt:

- Existing dashboard aggregation contracts.
- Admission-scoped workspace/read patterns.
- Document ownership/download authorization.

Verification:

- Reports agree with the source ledger across session and lifetime views.
- Portal-safe DTO snapshot tests exclude staff-only fields.
- Explain/analyze critical admission, session, billing-run, payment-register, and aging queries against realistic fixtures.
- A new session enrollment can immediately read the same admission account without migration/carry-forward writes.

Anti-pattern guards:

- No portal ownership derived from current enrollment.
- No cross-currency rollup.
- No report based solely on potentially stale projections without reconciliation behavior.

### Phase 8 — Final verification and rollout

What to implement:

- Run migrations in a production-like environment before enabling UI entry points.
- Seed/disposable QA fixtures for multi-session promotion, partial payments, discount, credit, refund, reversal, and deleted enrollment snapshots.
- Deploy backend/migrations first, then Management UI and document support behind a feature gate if incremental rollout is needed.
- Document recovery, reconciliation, and artifact retry procedures.

Required checks:

```sh
pnpm --filter @campuspilot/opa generate:actions
pnpm --filter @campuspilot/opa check
pnpm --filter @campuspilot/api test
pnpm --filter @campuspilot/api exec tsc --noEmit
pnpm check-types
```

Also run the finance-focused integration/concurrency/document suites with PostgreSQL, OPA, Redis, MinIO, and Gotenberg available. If Docker or browser authentication is unavailable, report those validations as unverified rather than treating type checks as equivalent.

Final anti-pattern scan:

- no finance ownership by `studentId`;
- no active-session inference;
- no finance fields in general admission/session DTOs;
- no floating-point accounting;
- no mutable posted entries/documents;
- no broad generic finance mutation permission;
- no generated OPA edits;
- no API calls in shared components;
- no native confirmation dialogs or unapproved `useEffect`.

## 12. Acceptance scenarios

The implementation is complete only when these scenarios pass end to end:

1. An admission is billed in Session A, pays partially, moves to a different class in Session B, is billed again, and Management/portal-safe APIs show one continuous ledger plus correct per-session filters.
2. A Session A bill continues to show the Session A class, section, roll number, fee names, prices, currency, and balance context after current records/configuration change.
3. Two identical billing-post requests race; exactly one run posts and the other returns the same idempotent result or a stable conflict without duplicate charges.
4. A stale preview cannot post after enrollment or pricing changes.
5. A payment credits the admission account, can create a negative balance, and never changes the state of an individual bill.
6. A discount is independently authorized, reasoned, allocated, reported, and reversible; it never masquerades as cash collected.
7. A refund/reversal preserves the original transaction and receipt while producing a clear correcting trail.
8. Removing a student enrollment or unregistering an admission does not delete or orphan financial history or documents.
9. A teacher cannot see finance configuration, billing navigation, or admission ledger data; authorized finance roles see only their permitted actions; platform access follows explicit grants.
10. Projection rebuild produces the same admission balances, session activity, bill settlement, and report totals as the immutable source postings.
