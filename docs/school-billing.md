# School billing

CampusPilot bills schools the way a subscription business does: in **billing
periods of 28 days** (`BILLING_PERIOD_DAYS`), counted from the day a
school's billing starts (its trial, or its first payment), never in calendar
months. Each period is either a free **trial**, **paid** (by an invoice) or
**complimentary** (a gift from CampusPilot). While a period runs the school
has its tier; when the last period ends the school is read-only at once
(no grace) until the next period is paid. Payments are recorded by hand in
the admin app today; the model mirrors a payment provider's objects so one
(Stripe or another) can be connected later without changing it.

This guide is the canonical reference: read it before changing billing
periods, prices or invoices, how a school's plan is decided, what a school
without a plan may do, the AI spend window, or how plans are shown.

A plan is not a feature flag and not a suspension. The standing tier
(`school.tier`), the billing periods and the suspension
(`school.suspended_at`) are separate facts, each read on its own.

## The facts

| Fact | Where | Meaning |
| --- | --- | --- |
| Standing tier | `school.tier` (nullable) | A tier that never lapses and is not billed: contracts, demo schools, and schools that had a tier before billing existed. Null for every self-created school. |
| Billing periods | `school_billing_period`, one row per period | Trial, paid and complimentary periods; at most one is active. |
| Prices | `subscription_price` | The price of one period per tier (INR, in paise). |
| Invoices | `school_invoice` | Payments, each for one or more consecutive periods. |
| Plan | computed, never stored | The tier the school's features follow, and where it comes from. |

Migration `0075_school-self-creation-and-billing.sql` renamed `school_trial`
(from 0074) to `school_billing_period`; earlier trials became `kind = 'trial'`
rows and keep their `trial_…` ids. New ids: `bper_`, `inv_`, `price_`.

### `school_billing_period`

`school_id` (ON DELETE CASCADE), `kind` (`trial` | `paid` |
`complimentary`), `tier`, `starts_at` (default `now()`), `ends_at` (CHECK:
after `starts_at`), `ended_at` (set when cut short: ended early, its invoice
voided, or replaced by a payment that starts now; CHECK: not before
`starts_at`), `invoice_id` (set exactly for `paid` periods, CHECK), `created_by`,
`ended_by`.

**Active.** A period is active at time t when
`starts_at <= t < least(ends_at, coalesce(ended_at, 'infinity'))`. Every read
compares with the database's `now()` (`activeBillingPeriodCondition` in
`@campuspilot/db/feature-flags/store`), so a period ends with no job.

**No overlap.** An EXCLUDE constraint (`school_billing_period_no_overlap`,
`btree_gist`) refuses two periods of one school whose
`tstzrange(starts_at, coalesce(ended_at, ends_at))` overlap. A period voided
before it began has `ended_at = starts_at`, an empty range that overlaps
nothing. drizzle cannot declare the constraint: it lives only in migrations.

**Coverage.** `coveredUntil(periods, now)` (`billing.contract.ts`) walks the
periods from now while each starts no later than the previous one ends. A
payment made ahead extends it; a gap stops it. Admins see it on the Billing
card, schools as `planEndsAt`.

### `subscription_price` (a provider's Price)

`tier`, `currency` (`INR`), `unit_amount_minor` (paise), `period_days`,
`active`, `provider_price_id`. Prices are never edited: setting a tier's
price deactivates the old row and adds one (one active per tier and currency,
partial unique index), so an invoice always points at the price it was
charged at.

### `school_invoice` (a provider's Invoice)

`status` (`open` | `paid` | `void`; manual invoices are recorded `paid`),
`tier`, `price_id`, `currency`, `unit_amount_minor`, `period_count`,
`amount_minor` (what was charged; may be less than unit × count for a
discount), `period_start`, `period_end`, `paid_at`, `voided_at`, `voided_by`,
`provider` (`manual` | `stripe`), `provider_invoice_id` (unique),
`payment_reference` (UPI reference, cheque number), `note`. CHECKs tie `status`
to `paid_at` and `voided_at`. Amounts are integers in the smallest unit, as
providers store them.

## The plan

`resolveSchoolPlan({ subscribedTier, activePeriod })` in
`packages/db/src/feature-flags/catalogue.ts` is the one rule:

- the plan's tier is the **higher** of the standing tier and the active
  period's tier (`schoolTierRank`). A period never takes away a standing tier;
- `source` is the period's kind when its tier is higher or there is no
  standing tier, otherwise `standing`;
- neither: `{ tier: null, source: null }`, the school has **no plan**.

Features follow the plan's tier (`resolveSchoolFeatureSwitches`); per-school
adjustments apply on top. See [School feature flags](feature-flags.md).
`readSchoolPlan` and `readSchoolFeatureFlags` return `subscribedTier`, the
active `period` (`{ id, kind, tier, startsAt, endsAt }`, `endsAt` being when
it really ends) and the plan.

## A school without a plan is read-only

Decision (the product owner may revisit it): a school without a plan is
treated like a suspended one, with **no grace period** after its last period.
Its staff and students sign in and read everything a read can reach; every
change is refused; nothing is deleted. Since the plan's tier is null, no tier
gives it a feature, so only what is not a feature (staff, classes, sections,
subjects, examinations), and any feature an administrator adjusted on, is
there to read.

The refusal uses the suspension's machinery (`packages/api/src/school-access`).
`resolveSchoolWriteRefusal({ suspended, hasActivePlan })` decides from the two
separate facts; a suspension wins when both apply:

```
ORPCError('FORBIDDEN', {
  message: 'This school has no active plan, so it is blocked: nothing can be changed and the features of a plan are off. Contact CampusPilot to continue.',
  data: { reason: 'SCHOOL_NO_PLAN' },
})
```

| Surface | Without a plan |
| --- | --- |
| Staff procedures (`requireAuth`) | Every procedure that is not an explicit read, for the input's `schoolId`, for **members** only: an outsider gets the ordinary permission refusal, and a platform administrator working through platform grants is not held. |
| Upload routes | `assertSchoolWritableByCaller`, after their permission check. |
| Cadet Portal (`cadetProcedure`) | Every procedure that is not a read (when the portal is open at all). |
| In-app assistant | `resolveAssistantAccess` answers `no_plan` (after the role): the user still sees the assistant and cannot send. |
| Question paper generation job | Fails with `no_plan` before asking the model. |

Clients tell the reasons apart with `schoolWriteRefusalOf(error)`,
`isSchoolNoPlanError(error)` or `isSchoolSuspendedError(error)`
(`school-access.contract.ts`, Zod only), never by the message.

## The AI limit counts per period

The assistant's spend limit (the feature config's `monthlyLimitUsd`, kept
under that name) counts spend over 28-day steps of the school's **active
billing period** (`schoolSpendWindow` in
`packages/api/src/assistant/spend.ts`), so every 28 days get exactly one
limit's worth however the calendar months fall; a trial that crosses a month
boundary no longer gets two. Paid and free periods are one step long; a longer
or extended trial gets one limit per 28 days from its start. A school without
a period (a standing tier alone) still counts the IST calendar month. The
spend cache key names the window (`assistant:spend:{school}:period:{id}:{step}`
or `…:{YYYY-MM}`).

**Schools see a percentage, never dollars.** Everything a school user sees
about AI use is the share of the **current window's** allowance used, with the
day it resets (`readSchoolWindowSpend`: the same window and the same cached
total the limit check reads, so the meter reads 100% exactly when the
assistant refuses). The share is computed with integers and rounded down to
one decimal (`spendPercentOfLimit`), shown as whole percents
(`@campuspilot/assistant-contract/allowance`).

- Settings › Usage › AI usage (`school.getAssistantAllowance`, principal and
  manager: `school.assistant.usage.read`) is the current window only: a meter
  ("62% of this period's AI allowance used", resets on the window's end,
  "Updated within the last 10 minutes": the total is the 10-minute spend cache)
  and each person's share, largest first (read fresh from the saved rows, so
  the shares may add up to a little more than the cached total). People who
  left the school and deleted accounts are listed too.
- Settings › AI assistant says whether the plan has an allowance and shows the
  same meter to those who may read usage.
- Everyone who may use the assistant sees the overall share in the panel
  (`getStatus().allowance`): a warning from 80%, and at 100% the composer is
  closed with "You've used 100% of this period's AI allowance. It resets on
  17 Dec." (the `limit_reached` refusal).
- A school without a limit sees no meter and no share: "Your plan has no AI
  usage limit."

No school-facing procedure returns the dollar limit or spend:
`school.getAssistantAccess` and `updateAssistantRoles` say `limited`, and
`school.getFeatureFlags` carries the assistant's config in a school-facing
shape (`{ limited, voice }`, `schoolFacingFeatureFlagsSchema`). The admin app
keeps dollars (`systemAdmin.getSchoolAssistantUsage`,
`getPlatformAssistantUsage`, the full config in `systemAdmin.getSchoolFeatureFlags`).

## Administration

All procedures are hidden from MCP (human platform decisions) and lock the
school row, so two administrators are applied one after the other; an
overlap that still reaches the database is answered CONFLICT.

| Procedure | What it does |
| --- | --- |
| `systemAdmin.getSchoolBilling({ id })` | Every period and invoice, newest first, and `coveredUntil`. |
| `systemAdmin.startSchoolTrial({ id, tier, endsAt })` | Starts a trial now (default in the admin app: 28 days). At most 367 days ahead (`MAX_TRIAL_DAYS`). CONFLICT while a period is active. |
| `systemAdmin.updateSchoolTrial({ id, periodId, tier?, endsAt? })` | Changes the **active trial's** tier or end. Paid and complimentary periods cannot be changed, only ended or voided. |
| `systemAdmin.endSchoolBillingPeriod({ id, periodId })` | Ends the active period now (any kind), or cancels an upcoming complimentary period so it never begins (`ended_at = starts_at`; an upcoming paid period is cancelled by voiding its invoice). Its invoice is unchanged; void it to record a refund. Idempotent. |
| `systemAdmin.addSchoolBillingPeriods({ id, kind, tier, periodCount, start, amountMinor?, paymentReference?, note? })` | Adds 1 to 13 consecutive periods (`MAX_PERIODS_PER_INVOICE`): `paid` creates the invoice (at the active price × periods unless `amountMinor` is given; refused without a price), `complimentary` none. `start: 'after_current'` begins where coverage ends (or now when uncovered), so a payment made early never loses time; `start: 'now'` cuts the active period at now and begins at once (an upgrade from a trial), refused while periods are already lined up after it. |
| `systemAdmin.voidSchoolInvoice({ id, invoiceId })` | Marks it void; its periods that are not over end now, upcoming ones never begin, past ones stay as history. Idempotent. |
| `systemAdmin.listSubscriptionPrices` / `setSubscriptionPrice({ tier, unitAmountMinor })` | The price catalogue; setting needs `system.subscription_price.update`. |
| `systemAdmin.updateSchoolTier({ id, tier })` | The standing tier; null removes it. |
| `systemAdmin.addSchool({ ..., tier?, trial? })` | `tier` is the standing tier; `trial: { tier, endsAt }` starts a trial with the school. |

`getSchool` and `listSchools` return `subscribedTier`, `planTier`,
`planSource` and the active `period`. `listSchools` filters `plan` by
`trial`, `paid`, `complimentary` (an active period of that kind) or `none`.

## What the admin app shows

- **Plan card** (Plan and features): the standing tier and the current
  period with End (and Change for a trial) or Start a trial.
- **Billing card** (below it): coverage, Add periods (paid or free, tier,
  number of periods, start, amount received, payment reference), the period
  history (upcoming free periods with Cancel) and the payments, each with Void.
- **Pricing page** (`/pricing`): the price of a 28-day period per tier.
- **Badges** wherever a school is listed: standing tier, "Trial · Pro · ends
  17 Dec" (or Paid / Free), "No plan", Suspended.
- Dates are picked and shown in IST (`apps/admin/lib/trial-dates.ts`); money
  in INR from paise (`apps/admin/lib/money.ts`).

## What the school sees

`school.listMySchools` (also `getSchool`, `updateSchool`) and
`cadet.getSchool` carry `isSuspended`, `hasActivePlan`, `hasSubscription`
(a standing tier), `planSource` and `planEndsAt` (the end of coverage while
periods give the plan, else null).

- **Management.** `ReadOnlySchoolBanner` shows the permanent warning.
  `PlanEndingBanner` shows "Your free trial ends on 17 Dec." / "Your plan is
  paid until 17 Dec." in the last 7 days of coverage only (`planEndingNotice`),
  saying the school is then blocked until the next payment unless it has a
  standing tier. A payment made ahead moves `planEndsAt`, so the notice goes away.
- **Cadet Portal.** `ReadOnlySchoolNotice`; students are not told about billing.

## Connecting a payment provider later

The rows already have the provider's shape; nothing about the plan changes:

1. Mirror each `subscription_price` as a provider Price (`provider_price_id`).
2. Create the provider subscription with a 28-day interval anchored on the
   school's coverage end.
3. On the provider's "invoice paid" webhook, call `addBillingPeriodsToSchool`
   (`packages/api/src/billing/billing.service.ts`) with `kind: 'paid'`,
   `start: 'after_current'`, the amount, and `provider: 'stripe'` with its
   invoice id (unique, so a webhook delivered twice is refused, not doubled).
4. A refund webhook calls `voidSchoolInvoice`.
Add the provider's customer and subscription ids (on `school` or a new table)
when connecting; manual and provider invoices then live side by side.

## Edge cases

- **A period ends while a teacher is mid-change.** The next write is refused
  with `SCHOOL_NO_PLAN`; reads keep working.
- **Paying during a trial** adds the paid periods after the trial
  (`after_current`) unless the administrator starts them now.
- **Self-created schools** start with one 28-day Plus trial by their creator
  (`created_by` is that person); see [Self-service school creation](school-creation.md).
- **Demo schools** have a standing Enterprise tier and no periods.
- **Precision.** Periods are written with millisecond JavaScript dates; a cut
  for `start: 'now'` uses the database's clock truncated to milliseconds, so
  the cut and the next start are the same instant.

## Extending

- A new enforcement point for writes goes through `school-access`
  (`assertSchoolWritableByCaller`, `assertSchoolWritable`).
- A new place that shows a plan reads it with `readSchoolPlan` or a join on
  `joinActiveBillingPeriod()`, and decides with `resolveSchoolPlan`; never
  compare tiers by hand.
- Tests set periods up with `createTestSchoolTrial` (`packages/api/test/fixtures.ts`)
  or `systemAdmin.addSchoolBillingPeriods`, and test expiry with timestamps
  in the past, never by waiting
  (`packages/api/src/billing/billing.integration.test.ts`).
