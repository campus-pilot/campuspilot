# School trials

A platform administrator can give a school a **trial** of a subscription tier
(Plus, Pro or Enterprise) for a limited time: one calendar month by default,
longer or shorter as the administrator decides. A trial lives above the
subscription: while it runs, the school has the **higher** of its subscribed
tier and the trial's tier. It switches itself off at its end. A school with
neither a subscription nor an active trial has **no plan** and is read-only.
This guide is the canonical reference: read it before changing how trials
are stored, how a school's plan is decided, what a school without a plan may
do, or how plans are shown.

A trial is not a feature flag and not a suspension. The subscription
(`school.tier`), the trial (`school_trial`) and the suspension
(`school.suspended_at`) are separate facts, and each is read on its own.

## The facts

| Fact | Where | Meaning |
| --- | --- | --- |
| Subscribed tier | `school.tier` (nullable) | The tier the school pays for; null without a subscription. |
| Trials | `school_trial`, one row per trial | The history of trials; at most one is active. |
| Plan | computed, never stored | The tier the school's features follow, and where it comes from. |

Table `school_trial` (`packages/db/src/schema/school-trial.ts`, migration
`0072_school-trials.sql`): `id` (`trial_…`), `school_id` (ON DELETE CASCADE:
a trial is the school's own history and goes with it, also in the demo
purge), `tier` (CHECK: a catalogue tier), `starts_at` (default `now()`),
`ends_at` (CHECK: after `starts_at`), `ended_at` (set when an administrator
ends it early; CHECK: not before `starts_at`), `created_by`, `ended_by` (ON
DELETE SET NULL), `created_at`, `updated_at`.

**No overlap.** An EXCLUDE constraint (`school_trial_no_overlap`, with
`btree_gist`) refuses two trials of one school whose
`tstzrange(starts_at, coalesce(ended_at, ends_at))` overlap, so a school has
at most one active trial. drizzle cannot declare an EXCLUDE constraint: it
lives only in the migration, and the schema file says so.

**Active.** A trial is active at time t when
`starts_at <= t < least(ends_at, coalesce(ended_at, 'infinity'))`. Every read
compares with the database's `now()`
(`activeSchoolTrialCondition` in `@campuspilot/db/feature-flags/store`), so
"off at the end" needs no job: the next read after `ends_at` no longer finds
it. Trials always start now; there is no future start. Timestamps are stored
and compared in UTC.

## The plan

`resolveSchoolPlan({ subscribedTier, activeTrial })` in
`packages/db/src/feature-flags/catalogue.ts` is the one rule:

- the plan's tier is the **higher** of the subscribed tier and the active
  trial's tier (`schoolTierRank`: Plus below Pro below Enterprise, stated per
  tier). A trial never takes away what a school pays for; without a
  subscription the trial's tier applies;
- `source` is `trial` when the trial's tier is higher or there is no
  subscription, otherwise `subscription`. A trial of the same or a lower tier
  changes nothing while it runs (it is still listed as the school's trial);
- neither: `{ tier: null, source: null }`, the school has **no plan**.

Features follow the plan's tier exactly as they follow a tier
(`resolveSchoolFeatureSwitches(planTier, adjustments)`); per-school
adjustments still apply on top. The feature store reads the subscribed tier,
the active trial and the adjustments in one query, so every gate
(`isSchoolFeatureEnabled`, `requireSchoolFeature`, Cadet sign-in, the
notification sender) follows trials without knowing about them. A school
without a plan has no feature that a tier gives; its adjustments still
apply. See [School feature flags](feature-flags.md).

`readSchoolFeatureFlags` returns `tier` (the plan's tier), `subscribedTier`
and `trial` (`{ id, tier, startsAt, endsAt }` or null). `readSchoolPlan`
returns the two facts and the plan they give.

## A school without a plan is read-only

Decision (the product owner may revisit it): a school without a plan is
treated like a suspended one. Its staff and students sign in and read
everything a read can reach; every change is refused; nothing is deleted.
Since the plan's tier is null, no tier gives it a feature, so only what is
not a feature (staff, classes, sections, subjects, examinations), and any
feature an administrator adjusted on, is there to read. The Cadet Portal
needs Enterprise: when an Enterprise trial ends without a subscription the
feature closes and student sign-in is refused, as for any school without it.

The refusal uses the suspension's machinery, generalised into the school's
write access (`packages/api/src/school-access`). One function,
`resolveSchoolWriteRefusal({ suspended, hasActivePlan })`, decides from the
two separate facts; a suspension wins when both apply. Every enforcement
point of [School suspension](school-suspension.md#what-is-refused) refuses a
school without a plan with its own reason:

```
ORPCError('FORBIDDEN', {
  message: 'This school has no active plan. You can still view everything, but nothing can be changed. Contact CampusPilot to continue.',
  data: { reason: 'SCHOOL_NO_PLAN' },
})
```

| Surface | Without a plan |
| --- | --- |
| Staff procedures (`requireAuth`) | Every procedure that is not an explicit read, for the input's `schoolId`, for **members** only: an outsider gets the ordinary permission refusal, and a platform administrator working through platform grants is not held. |
| Upload routes | `assertSchoolWritableByCaller`, after their permission check. |
| Cadet Portal (`cadetProcedure`) | Every procedure that is not a read (when the portal is open at all). |
| In-app assistant | `resolveAssistantAccess` answers `no_plan` (after the role, like `school_suspended`): the user still sees the assistant and their conversations and cannot send. |
| Question paper generation job | Fails with `no_plan` before asking the model. |

Clients tell the reasons apart with `schoolWriteRefusalOf(error)`,
`isSchoolNoPlanError(error)` or `isSchoolSuspendedError(error)`
(`school-access.contract.ts`, Zod only), never by the message.

## Administration

| Procedure | What it does |
| --- | --- |
| `systemAdmin.startSchoolTrial({ id, tier, endsAt })` | Starts a trial now. `endsAt` is an ISO date-time with offset, in the future and at most 366 days ahead (`MAX_TRIAL_DAYS`, a guard against a mistyped year). CONFLICT while the school has an active trial: change or end that one instead. |
| `systemAdmin.updateSchoolTrial({ id, trialId, tier?, endsAt? })` | Changes the **active** trial's tier or end (extend or shorten; the end stays in the future and after the start). A trial that ended or ran out cannot be changed (CONFLICT). |
| `systemAdmin.endSchoolTrial({ id, trialId })` | Sets `ended_at = now()` and `ended_by`. Idempotent: a trial that has already ended keeps its first end, and one that ran out by itself is left as it is (so `ended_at` always lies inside the trial). |
| `systemAdmin.listSchoolTrials({ id })` | The history, newest first, each with `active` decided by the database's clock. |
| `systemAdmin.updateSchoolTier({ id, tier })` | `tier: null` removes the subscription: the school is then on its trial, or has no plan. Adjustments and trials are kept. |
| `systemAdmin.addSchool({ ..., tier?, trial? })` | `tier` may be left out or null (no subscription); `trial: { tier, endsAt }` starts a trial in the same transaction. A school with neither has no plan; that is allowed. |

The trial procedures need `system.school.update` (reads `system.school.read`),
like suspending, and are hidden from MCP: what a school has is a human
platform decision. Each write locks the school row, so two administrators
are applied one after the other; an overlap that still reaches the database
is answered CONFLICT.

`systemAdmin.getSchool` and `listSchools` return `subscribedTier`, the plan's
`planTier` and `planSource`, and `trial` (the active one or null).
`listSchools` filters by `subscribedTier` (null: none), `suspended`, and
`plan`: `trial` (an active trial, whether or not it gives the plan) or `none`
(no plan).

## What the admin app shows

- **Plan card** on the school's Plan and features page
  (`apps/admin/components/school-plan-card.tsx`, `school-trial-section.tsx`):
  the subscription (a tier or No subscription; removing it, or a change that
  takes features away, is confirmed with what the school keeps or that it
  will have no plan) and the trial (the active one with its end and the days
  left, Change with a quick "+1 month", End trial with a confirmation; or
  Start a trial, one calendar month ahead by default), with earlier trials
  below. What a change does to features is worked out with the catalogue's
  own rules (`planChangeEffect` with `resolveSchoolPlan`).
- **Badges** wherever a school is listed or headed (`school-badges.tsx`): its
  subscription, "Trial · Pro · ends 17 Dec", "No plan" in warning style, and
  Suspended.
- **Organizations table**: a Plan filter (on a trial, no plan).
- **Add school**: a subscription (or No subscription) and an optional trial;
  with neither it says plainly that the school will have no plan.
- **Dates** are IST (`apps/admin/lib/trial-dates.ts`): an end is picked as an
  IST day and ends at the last second of that day there.

## What the school sees

`school.listMySchools` (also `getSchool`, `updateSchool`) and
`cadet.getSchool` carry, as separate facts, `isSuspended`, `hasActivePlan`
and `trialEndsAt` (ISO string; set only while a trial gives the plan).
Screens are not changed for a read-only school: a change is sent and the
server's refusal is shown where that screen shows a failed save.

- **Management.** `ReadOnlySchoolBanner` (`school-plan-banners.tsx`, in the
  school shell) shows a permanent `AppShellAlert` warning with the
  suspended or the no-plan message, suspension first. `TrialEndingBanner`
  shows "Your trial ends on 17 Dec. Contact CampusPilot to keep using these
  features." in the trial's last 7 days only (`trialEndingNotice`), nothing
  during the rest of it. The RPC link and the assistant client read the
  school list again on either refusal (`lib/orpc.ts`).
- **Cadet Portal.** `ReadOnlySchoolNotice` shows "Your school's plan has
  ended. You can still view everything. Contact your school." (or the
  suspended notice); a refused change says the same and reads the school
  again. Students are not told about trials.

## Edge cases

- **A trial ends while a teacher is mid-change.** The next write is refused
  with `SCHOOL_NO_PLAN`; reads keep working; features follow the plan at once.
- **A trial below the subscription** has no effect while it runs (the higher
  tier wins). The admin app still lists it as the school's trial and says it
  changes nothing.
- **Notifications** queued during a trial and sent after it are decided by
  the existing send-time feature check (WhatsApp needs Enterprise, so its
  copies are `skipped: feature_disabled` after an Enterprise trial).
- **Demo schools** are created on their subscribed Enterprise tier and never
  need a trial.

## Extending

- A new enforcement point for writes goes through `school-access`
  (`assertSchoolWritableByCaller`, `assertSchoolWritable`), which covers both
  reasons; see [School suspension](school-suspension.md#extending).
- A new place that shows a school's plan reads it with `readSchoolPlan` or a
  join on `activeSchoolTrialCondition`, and decides with `resolveSchoolPlan`;
  never compare tiers by hand.
- Tests set a trial up with `createTestSchoolTrial({ schoolId, tier,
  startsAt?, endsAt?, endedAt? })` (`packages/api/test/fixtures.ts`) and test
  expiry with an `ends_at` in the past, never by waiting.
  `createTestSchool({ tier: null })` makes a school without a plan.
