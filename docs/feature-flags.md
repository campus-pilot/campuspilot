# School feature flags and subscription tiers

A feature says whether one school **has** a product area (student
management, the Cadet Portal, notices, WhatsApp notifications, the AI
assistant). Which features a school has comes from its **plan**: its
standing tier (Plus, Pro or Enterprise), or a higher tier of its active
billing period: a trial, paid or complimentary 28-day period
([School billing](school-billing.md)); a platform administrator can then
adjust a single feature for a single school in the admin app. A school's own staff can only
read them. This guide is the canonical reference: read it before adding a
feature or a tier, gating a procedure or screen on a feature, or changing
how tiers and adjustments are stored or enforced.

A school's **kind** (`school.kind`: a real school or a personal space) is
not a feature and not a tier: procedures declare the kinds they serve and a
gate in `requireAuth` holds them ([Personal space](personal-space.md)). A
personal space has the features of its plan like any school; its standalone
papers are gated on `assistant`.

## Tiers

A school has at most one standing tier (`school.tier`, no default; null
without one) and may be in a billing period of one; its features follow
the higher of the two, the **plan's tier** (`resolveSchoolPlan`, see
[School billing](school-billing.md)). What a tier includes is stated per
feature in the catalogue (`tiers`), never derived from the order of the
tiers:

| Feature | Plus | Pro | Enterprise |
| --- | --- | --- | --- |
| Staff, classes, sections, subjects, examinations (not a feature: every school) | yes | yes | yes |
| `studentManagement` | | yes | yes |
| `notices` | | yes | yes |
| `cadet` | | | yes |
| `whatsapp` | | | yes |
| `assistant` | add-on | add-on | add-on |

The assistant (and with it question papers) is in no tier: it is an
**add-on on every tier**, off until an administrator switches it on for the
school together with its monthly limit, because every request is paid model
usage. A Plus school is therefore the staff-only school of "The
`studentManagement` feature" below, typically with the assistant switched on
for question papers.

**No standing tier.** `school.tier` may be null (`addSchool` without a
tier, or `updateSchoolTier` with null; every self-created school). It then
has the plan of its active billing period, or **no plan**: a null plan tier
includes no feature (`schoolTierIncludes(null, key)` is false), the school's
adjustments still apply as on any tier, and the school is **read-only** (its
staff and students read, every change is refused with `SCHOOL_NO_PLAN`).
The admin app shows it as "No plan". See [School billing](school-billing.md).

**Adjustments.** On top of its tier an administrator can set one feature for
one school: *always on* (the school has it whatever its tier), *always off*,
or *follow the tier* (no adjustment). An adjustment is the administrator's
own decision about that school and is kept when the tier changes: a Pro
school given WhatsApp keeps it after a move to Plus or Enterprise until the
adjustment is removed. Requirements still apply (WhatsApp switched on for a
Plus school is inactive, because it needs student management).

**Changing the tier** (`systemAdmin.updateSchoolTier`) writes `school.tier`
and nothing else (null removes the subscription). Features the new plan
lacks stop at once, exactly as if each had been switched off (the tables
below); their data is kept. A trial changes the plan the same way while it
runs and when it ends.

**Existing schools** were put on tiers by migration `0073_subscription-tiers.sql`
so that no school gained or lost a feature on deploy: each got the lowest
tier that covers what it had (the Cadet Portal in use: Enterprise; student
management without it: Pro; neither: Plus), and whatever it had that its new
tier says otherwise became an adjustment (for example `notices` off on an
Enterprise school that never had notices, or `whatsapp` on for a Pro school,
since WhatsApp used to go to every school with student management). Stored
switches that only repeated the tier were removed, so those schools follow
their tier from then on. `subscription-tiers-migration.integration.test.ts`
runs the migration's statements against prepared rows.

A flag is not a permission. Permissions (OPA) decide *who* may act; a flag
decides whether the area exists for the school at all. Gate with both, each in
its own layer, and never infer one from the other.

## The catalogue

`packages/db/src/feature-flags/catalogue.ts` (Zod only, importable everywhere):

| Export | Meaning |
| --- | --- |
| `SCHOOL_TIERS`, `SchoolTier`, `schoolTierSchema`, `schoolTierCatalogue` | The tiers (`plus`, `pro`, `enterprise`) with each one's label and description. |
| `schoolFeatureCatalogue` | One entry per feature: `label`, `description`, `config` (a Zod schema; `z.null()` for a feature without settings), `tiers` (the tiers that include it; empty for an add-on) and `requires` (the features it cannot work without). |
| `SchoolFeatureKey`, `SCHOOL_FEATURE_KEYS`, `schoolFeatureKeySchema` | The keys (`studentManagement`, `cadet`, `notices`, `whatsapp`, `assistant`). |
| `schoolTierIncludes(tier, key)`, `schoolTierFeatures(tier)` | Whether a tier includes a feature; the features of a tier. |
| `schoolTierRank`, `resolveSchoolPlan({ subscribedTier, activePeriod })`, `SchoolPlan`, `SCHOOL_PLAN_SOURCES` | How tiers compare, and the plan a standing tier and an active billing period give: the higher tier, its `source` (`standing`, or the period's kind), or no plan ([School billing](school-billing.md)). |
| `resolveSchoolFeatureSwitches(tier, adjustments)` | Every feature's switch for a plan's tier: the adjustment where there is one, otherwise the tier's answer. Used by the store and by the admin app to say what a plan change would do. |
| `resolveSchoolFeatureActivity(switches)`, `missingSchoolFeatureRequirements(key, flags)` | Which features are **active** (switch on and every required feature active), and which requirements of one feature are not. The one implementation of the rule below. |
| `SchoolFeatureConfig<K>` | The config type of exactly one key. A caller holding key `K` never sees another key's shape. |
| `SchoolFeatureState<K>` | `{ included, adjustment, enabled, active, config }`: whether the plan's tier includes it, the school's adjustment (`true`, `false` or null), the switch that results, whether the school has the feature now, and its settings (see "Switch and activity"). |
| `SchoolFeatureFlags` | `{ [K in SchoolFeatureKey]: SchoolFeatureState<K> }`. |
| `SchoolFeatureEntry`, `schoolFeatureEntries(flags)` | What is **stored** about one feature, with its key, a union discriminated on `feature`: `enabled` here is the adjustment (`true`, `false`, or null to follow the tier) and `config` the settings. Use it whenever the key is not a literal (a loop, a form): a value whose key may be any feature cannot carry one feature's config for another. Build updates by spreading an entry, never by pairing `feature` and `config` by hand; an entry written back unchanged changes nothing. |
| `ASSISTANT_DEFAULT_ROLES` | The roles the assistant is switched on for when it is enabled for a school with no role switched on (see [In-app assistant](assistant.md#access)). |
| `parseSchoolFeatureConfig(key, raw)` | Validates stored or submitted jsonb against that key's schema; null means "no config". |
| `schoolFeatureFlagsSchema`, `schoolFeatureUpdateSchema` | API output schema; update input as a discriminated union on `feature`. |
| `SCHOOL_FEATURE_DISABLED_REASON`, `readSchoolFeatureDisabled(error)` | The disabled-feature error contract (below). |

Browser apps do not depend on `@campuspilot/db`; they import the same names from
`@campuspilot/api/routers/school/feature-flags/feature-flags.dto`.

## Storage

The subscribed tier is `school.tier` (text with a CHECK; migration 0073) and
billing periods are rows of `school_billing_period` (migration 0075, [School billing](school-billing.md)).
What is stored per feature is the school's **adjustment** and the feature's
settings:

Table `school_feature_flag` (`packages/db/src/schema/school-feature-flag.ts`,
migration `0048_school-feature-flags.sql`): primary key `(school_id, feature)`,
`enabled` (the adjustment: true, false, or null to follow the tier), `config`
jsonb, `updated_by`, `updated_at`. `school_id` is
`ON DELETE CASCADE`: flags are the school's own configuration and go with it,
so `systemAdmin.deleteSchool` is never blocked by a flag row. (Migrations
0048 to 0053 were amended in place before their first release. A development
database that applied an earlier copy keeps what that copy created, for
example `NO ACTION` on this key, and must be recreated; no released database
has them.)

- `feature` is text, not a database enum: adding a feature needs no migration,
  and rows of a retired key are ignored by every read.
- **A missing row means "follow the tier", with no config.** A new school has
  no rows, so it has exactly the features of its tier. A school that does
  not exist has no tier and no feature, so a gate answers an unknown school
  like a school without the feature.
- `enabled` and `config` are independent facts. Disabling, or returning a
  feature to its tier (`enabled: null`), keeps the config.
- A stored config that no longer matches its schema (after a schema change)
  stops **only the code that uses that config**, with a clear error, and is
  never silently replaced by a default:
  - `getSchoolFeatureConfig(db, schoolId, key)` is the one read of a config. It
    throws `CONFLICT` with `data: { reason: 'SCHOOL_FEATURE_CONFIG_INVALID',
    feature }` ("The stored settings of … are not valid. A platform
    administrator must save them again.");
  - no gate reads the config: `isSchoolFeatureEnabled`,
    `assertSchoolFeatureEnabled` and the staff middleware
    `requireSchoolFeature` decide from `enabled` alone, so a stale config
    cannot turn a permission or feature check (Cadet sign-in, every notice
    procedure) into a 500;
  - the flag reads keep answering: `school.getFeatureFlags` and
    `systemAdmin.getSchoolFeatureFlags` return every feature's real `enabled`
    and name the features with unusable settings in `invalidConfigs` (their
    `config` reads null). The admin editor shows a warning on such a card and
    lets the administrator save it, which stores valid settings again.
- Migration 0048 backfilled `cadet = enabled` for every school that existed,
  because the Cadet Portal was already available to all of them. `notices` was
  not backfilled. (So most schools that existed before tiers are Enterprise
  schools, many with `notices` adjusted off.)
- Demo schools: `createDemoSchool` creates the school on `DEMO_SCHOOL_TIER`
  (`workflows/demo-school/constants.ts`: Enterprise) and writes no feature
  row, so a demo has student management, the Cadet Portal, notices and
  WhatsApp (which a demo still never sends: `skipped: demo_school`);
  `assistant` is off (every assistant request is paid model usage, so
  an administrator enables it for a demo deliberately). The demo seed still
  writes question papers and the `question_paper` template, through service
  functions, so they appear when the feature is enabled
  ([Demo schools](demo-school.md#question-papers)).
- `purge_demo_school` deletes the rows (migration `0049_demo-purge-feature-flags.sql`),
  and the assistant's rows and role list (`0056_demo-purge-assistant.sql`), question papers (`0059_demo-purge-question-papers.sql`) and chat images (`0062_demo-purge-assistant-attachments.sql`).
- `assistant` is in no tier: it is off for every school until enabled.

## Switch and activity

Each feature has these facts, kept apart:

- **`included`**: the school's plan's tier includes it.
- **`adjustment`**: what an administrator set for this one school (`true`,
  `false`), or null when the school follows its tier. This is what the admin
  editor writes.
- **`enabled`, the switch**: the adjustment when there is one, otherwise
  `included`.
- **`active`**: whether the school **has** the feature now: its switch is on
  and every feature it `requires` is active. Every gate (`isSchoolFeatureEnabled`,
  `assertSchoolFeatureEnabled`, `requireSchoolFeature`), every screen
  (`useSchoolFeature` returns `active` as its `enabled`), notification and tool
  list decides from this.

Today `cadet`, `notices` and `whatsapp` require `studentManagement` (a product
decision: a school without students has none of them). Switching student management off
leaves their switches as they are, so switching it back on restores them;
their gates refuse with their own key (`feature: 'notices'`), since that is the
feature the caller asked for. The admin editor says on such a card that the
feature is switched on but inactive, and why. Requirements must not form a
cycle (`catalogue.test.ts`).

## Reading and writing (API)

| Where | What |
| --- | --- |
| `@campuspilot/db/feature-flags/store` | `isSchoolFeatureEnabled(db, schoolId, key)` (the gate's question: is it active), `readSchoolFeatureFlags(db, schoolId)` (`{ tier, subscribedTier, period, features, invalidConfigs }`; never throws on a config; null for a school that does not exist; `tier` is the plan's tier, null for a school without a plan), `getSchoolFeatureFlags(db, schoolId)` (its `features`; every feature off for a school that does not exist), `readSchoolFeatureConfig(db, schoolId, key)` (`valid` with the config, or `invalid`), `readSchoolPlan(db, schoolId)` and `activeBillingPeriodCondition()`. The standing tier, the active billing period and the rows are read in one query. Shared with `@campuspilot/auth` (Cadet sign-in). |
| `packages/api/src/feature-flags/feature-flags.service.ts` | Re-exports the reads; `setSchoolFeature(db, { ...entry, schoolId, updatedBy })` (the input is a `SchoolFeatureEntry`: the adjustment and the config; switching the assistant on for a school with no role switched on also writes the default roles); `assertSchoolFeatureEnabled(db, schoolId, key)` (decides from the feature being active, returns nothing); `getSchoolFeatureConfig(db, schoolId, key)` (the typed config for a handler that uses it; `CONFLICT` when the stored value is invalid); `schoolFeatureDisabledError(key)`, `schoolFeatureConfigInvalidError(key)`. |
| `packages/api/src/permissions/feature.ts` | `requireSchoolFeature(key)` middleware: the gate, from `active` alone; adds nothing to the context. `gateRouterOnSchoolFeature(key, router)` appends it as the last middleware of every procedure of a router (after its permission checks), for areas that belong wholly to a feature. `schoolFeatureGatesOf(middlewares)` reads the gates back for the MCP catalog. |
| `featuresOfUserSchools(db, userId)` (service) | The features active in at least one of the user's schools, for the MCP tool list. |
| `school.getFeatureFlags({ schoolId })` | Any member of the school (`requireSchoolMember`), no permission. Returns `{ schoolId, tier, features, invalidConfigs }`. MCP hidden. |
| `systemAdmin.getSchoolFeatureFlags({ id })` | `system.school.feature_flags.read`. Returns the same shape (`tier` is the plan's tier) plus `subscribedTier` and the active `period`. MCP advanced. |
| `systemAdmin.updateSchoolFeatureFlag({ id, feature, enabled, config })` | `system.school.feature_flags.update`. `enabled` is the adjustment: `true`, `false`, or null to follow the tier. MCP hidden (a human platform decision; its input is a discriminated union). Returns the tier and all flags of the school. |
| `systemAdmin.updateSchoolTier({ id, tier })` | `system.school.feature_flags.update`. Writes the subscribed tier only (null removes it); adjustments and trials are kept. MCP hidden. Returns the plan and all flags. |
| `systemAdmin.addSchool({ ..., tier?, trial? })` | `tier` is optional (none: no subscription), and a trial can start with the school. `systemAdmin.listSchools` filters by `subscribedTier` (null: schools without one), `suspended` and `plan` (`trial`, `paid`, `complimentary`, `none`). Billing periods have their own procedures ([School billing](school-billing.md#administration)). |

Both system actions are granted to `platform.admin` only
(`packages/opa/src/policies/system`). Tier changes and the assistant's role
list use the feature flag actions; suspension is not a feature (see
[School suspension](school-suspension.md)).

### Gating a staff procedure

```ts
.input(schema) // has schoolId
.use(requireSchoolPermission(SCHOOL_ACTIONS.X))
.use(requireSchoolFeature('notices'))
.handler(async ({ context, input }) => {
  // Only a handler that uses the feature's settings reads them:
  const config = await getSchoolFeatureConfig(context.db, input.schoolId, 'notices'); // typed for 'notices'
})
```

Put the feature middleware **after** the permission middleware: a caller without
access gets the ordinary FORBIDDEN and cannot probe which features a school has.
Being enabled and having usable settings are separate facts: the middleware
answers the first and never fails on the second.
Where a feature only matters for part of a procedure (for example
`createAdmission` with `generateCadetPassword`), call
`assertSchoolFeatureEnabled` at that point instead.

### The disabled-feature error

Every surface throws the same error:

```
ORPCError('FORBIDDEN', {
  message: '<Label> is not enabled for this school.',
  data: { reason: 'SCHOOL_FEATURE_DISABLED', feature: '<key>' },
})
```

A permission denial is FORBIDDEN **without** that data. Clients tell them apart
with `readSchoolFeatureDisabled(error)` (returns the feature key or null), never
by the message. Tests use `expectFeatureDisabled` / `expectPermissionDenied`
(`packages/api/test/feature-flags.ts`).

## The `studentManagement` feature: where it is enforced

Part of Pro and Enterprise. A Plus school does not have it and is a
staff-only school (staff, classes, sections, subjects and examinations for
question papers); an administrator can also switch it off for one school of
a higher tier. Off means:

| Surface | Behaviour when off |
| --- | --- |
| Admissions (`admission.router`, admission settings, the admission photo and document routes in `admission.http.ts`) | Disabled-feature error after the permission check; nothing is written. |
| Students (`student.router`), fees and billing (`billing.router`: bills, runs, ledger, payments, reports, admission finance values), session finance (`session-finance.router`) | Disabled-feature error. |
| Examinations: students, results, attendance settings, timetables, result notifications and per-student remarks (`exam.router`, everything but definitions, plans, `transitionExam`, the Cadet release and question papers) | Disabled-feature error. An examination keeps its definition, subject plans, lifecycle and question papers. |
| Completing an examination (`transitionExam`, `transitionExamPlan`) | Does not wait for approved results, which can no longer be entered (`reviewResults: false`); a school that kept students from before is not stuck. A completed examination is therefore not proof of reviewed results: `releaseExamToCadet` checks them itself and refuses until the examination is reopened, finished and completed again. |
| Session settings (`createSession`, `updateSession`) | A configuration that changes co-scholastic areas, the grading scale or attendance is refused with the disabled-feature error (compared after schema defaults, so resubmitting them unchanged is fine). Examination definitions and years are not affected. |
| `listClasses` | `studentCount` is null for every class. |
| Documents (`DOCUMENT_TYPE_FEATURE` in `document.dto.ts`) | Every document type except `notice` (`notices`) and `question_paper` (`assistant`) belongs to student management: its templates, marketplace, previews, downloads and deletes are refused per call (those procedures also serve the other types, so they stay listed as tools). `previewDocument`, `generateDocument`, `getDocumentGenerationJob`, `listDocumentGenerationJobs` and `listDocumentArtifacts` only ever serve student management documents, so they carry the gate themselves (`GENERATOR_DOCUMENT_FEATURE`) and are withheld as tools. |
| Delivery log (`listNotificationDeliveries`, `resendNotificationDelivery`) | Disabled-feature error: every delivery there is a student notification. |
| Notifications `bill.issued`, `payment.received`, `billing.run_posted`, `exam.results_published`, `exam.results_publish_finished`, `exam.timetable_published(_staff)`, `notification.whatsapp_failed`, `notification.whatsapp_batch_failed` | Remote copies `skipped: feature_disabled`, resend refused (`notificationRequiredFeatures`). |
| `getDashboard` | `admissions` and `billing` are null; `classrooms` stays for a caller who may list classes, with `studentCount` null (school total and per class); `createAdmission`, `recordPayment` and `enterResults` are false. |
| Cadet Portal, notices and WhatsApp notifications | Inactive (they require student management), with their own disabled-feature errors. |
| In-app assistant | The worker drops every tool gated on a feature the conversation's school lacks (read fresh before each model request and tool call). The prompt names only the features that took a tool away, in the assistant's own wording (`unavailableSchoolWork`), also read per request and never stored with the run. The starter prompt about admissions is not offered. |
| External MCP clients | A tool gated on a feature none of the user's schools has is not listed (nor found through the advanced tools); every gated tool's description ends "Only for schools that have …"; a call for a school without the feature is refused. |
| Management UI | Sidebar: Admission, Documents and Billing (each on its own feature; the Operations group is left out when none of its items applies). Dashboard: the student tile and Class load; the Classrooms row shows classes and sections. Classroom: Students and Documents sections and Add student (Teachers is the default). Classroom list: the Students column. Examination: Results, Timetable, attendance, the documents menu and result notifications; the exam lands on Question paper, or More without the assistant (an exam with no subject plans shows plan creation and no tabs, as in every school). Settings: Documents (admission documents), every template but Question paper (and Notice), and on the session page co-scholastic areas, grading scale, attendance and financial configuration. ⌘K: the Admission command and the student search; the Templates command opens the first template the school has (`firstSettingsTemplate`, also used by the settings sidebar). Every page of these areas, opened by URL, shows "not enabled" (`FeaturePage` layouts). |

Kept and back when it is enabled again: admissions, students, bills, ledgers,
results, timetables, documents and every notification already recorded.

## The `cadet` feature: where it is enforced

"The school has the Cadet Portal" **is** the `cadet` flag; there is no separate
school-level switch. Off means the portal is unavailable everywhere:

| Surface | Behaviour when off |
| --- | --- |
| Sign-in (`packages/auth/src/cadet-sign-in.ts`) | Exactly like an unknown school or admission number: same `INVALID_CADET_CREDENTIALS`, the password is hashed anyway, only the IP failure is counted. Even a correct password is refused. |
| `cadetProcedure` (`packages/api/src/cadet/procedure.ts`) | Every call: the disabled-feature error with `feature: 'cadet'` (existing sessions stop at once). Anonymous callers still get UNAUTHORIZED. |
| Cadet MCP (`createCadetOAuthContext`) | No context, so the gate answers 401 like a revoked connection. The grant is kept. |
| `issueAdmissionCadetPassword`, `createAdmission` with `generateCadetPassword` | Disabled-feature error (after the permission check); nothing is written. Plain `createAdmission` is unaffected. |
| `getCadetPortalSettings` / `updateCadetPortalSettings` | Disabled-feature error (after the permission check). |
| `releaseExamToCadet`, `previewExamCadetRelease` | Disabled-feature error (after the permission check); nothing is released, stamped or notified, so the first release after the portal is enabled still notifies. |
| `sendStudentResultNotification`, `previewStudentResultNotification` | Disabled-feature error (after both permission checks). |
| Saving or publishing a notice addressed to students | Disabled-feature error for `cadet` (see the notices table). |
| `notice.published` copies not sent yet | Skipped (`feature_disabled`), resend refused; see [School notices](notices.md). |
| `/blob/school/{id}/cadet.webmanifest` | 404, identical to an unknown school. |
| Management UI | The Cadet Portal settings card, the "Generate Cadet Portal password" checkbox, "Issue portal password" and the examination's Cadet Portal release are hidden (`RequireFeature`). |
| Cadet app | A signed-in student sees "Cadet Portal unavailable" with Sign out (`AppFrame`); the AI-app consent screen says the same instead of blaming the app. |

Deliberately **not** gated, each for a stated reason:

- `withdrawExamFromCadet`: withdrawing only hides what was released, and must
  stay possible for a school whose portal was switched off.
- `unsubscribePush` (on `cadetLoginProcedure`, the cadet builder without the
  feature check): a student must be able to stop a device's notifications, which
  the app does when signing out. Sign-out itself also revokes the session's push
  subscriptions on the server (see [Cadet Portal](cadet-portal.md)).
- Bill and payment notifications (`bill.issued`, `payment.received`: inbox, web
  push, WhatsApp): fees are not a portal feature, and guardians are told about
  them whether or not the school uses the portal.
- Copies of a results release made while the portal was on.

Logins, sessions, grants and data are kept while the feature is off, and work
again when it is enabled.

## The `notices` feature: where it is enforced

| Surface | Behaviour when off |
| --- | --- |
| Staff notice procedures (`routers/school/notice`: list, get, create, update, delete, preview, publish preview, publish, download) | Disabled-feature error (`feature: 'notices'`) after the permission check; nothing is written. |
| Document template procedures with `documentType: 'notice'` | Disabled-feature error after the permission check. Other document types are unaffected. |
| `listNotificationDeliveries` with a `notice` scope | Disabled-feature error. Other scopes are unaffected. |
| Cadet `listNotices`, `getNotice`, `getNoticeDownload` | Disabled-feature error (`feature: 'notices'`); the rest of the portal keeps working. |
| Cadet app | The Home notices block and the More row do not appear; `/notices` and `/notices/{id}` show "Notices are not available". The app reads the feature from the notice procedures' own error; there is no features read for students. |
| `getDashboard` | `actions.createNotice` is false. |

| Notice notifications not sent yet (`notice.published`, also needs `cadet`; `notice.published_staff`) | Remote copies are recorded `skipped: feature_disabled` when planned and when sent; a resend is refused; the notice PDF source produces nothing. Inbox rows are still written and kept. |

Addressing students also needs `cadet`: a notice whose `cadetScope` is not
`none` is refused with the disabled-feature error for `cadet` when it is
saved and again when it is published or its publication is previewed. A stored
audience is never rewritten when `cadet` goes off. Notices, their cached PDFs
and inbox rows are kept while either feature is off; see
"Nothing new goes out while a feature is off" in [School notices](notices.md).

## The `whatsapp` feature: where it is enforced

Whether the school's notifications also go to guardians on WhatsApp. It is a
feature of the **channel**, not of a notification type
(`notificationChannelRequiredFeatures` in the notification catalogue), so it
takes away the WhatsApp copy alone; the inbox and web push are unaffected.
The platform switch `WHATSAPP_ENABLED` still applies to every school
(`skipped: disabled`); a school needs both.

| Surface | Behaviour when off |
| --- | --- |
| Fan-out (`planNotificationRows`, `decideDeliveries`) | The WhatsApp copy of every notification is planned `skipped: feature_disabled`. The dispatched event journals which channels lacked their feature (`channelsWithoutFeature`). |
| Sender (`sendDelivery`) | A WhatsApp copy queued while the school had the feature is recorded `skipped: feature_disabled` instead of being sent (`disabledChannelFeatureOf`). |
| `resendNotificationDelivery` for a WhatsApp copy | Disabled-feature error (`feature: 'whatsapp'`). |
| Forecasts before a send (results, notices, timetables; `forecastDeliveries`) | WhatsApp copies are counted as skipped (`feature_disabled`), so staff see that nothing goes out on WhatsApp. |
| Management UI | The timetable publish dialog does not name WhatsApp; the admission table hides its WhatsApp readiness column and filter. A guardian's WhatsApp number, verification and consent stay on the admission: they are the guardian's contact data and are used again when the school has the feature. |

Numbers, verification, consent, delivery history and provider receipts are
kept while the feature is off. Nothing is sent for a demo school either way.

## UI

Management (`apps/management/components`):

- `useSchoolFeature(schoolId, feature)`: `{ enabled, config, status, retry }`
  typed by key. `status` tells **three outcomes** apart, and screens must not
  fold them together:
  - `ready`: the flags are known; `enabled` is the truth, on or off;
  - `pending`: the first read is running;
  - `unknown`: the flags could not be read and none are held. This is not
    "disabled": offer `retry`, do not say the feature is not enabled.
  `enabled` is false while `pending` or `unknown`, so a plain check fails closed.
- An answer that does not say whether the school has the feature (no entry
  for it, or an entry without `active`, as an API one release older sends
  while a release rolls out) is `unknown` too, never a crash and never
  "disabled". Deploy the API before the apps.
- `useSchoolFeatureCheck(schoolId)` returns a check of any feature from the
  same query, for code that decides from several features at once (a
  navigation group that shows when any of its items does). Gate every item
  on its **own** feature; never on another feature that happens to go with it
  today.
- **Known flags survive a failed refetch.** TanStack Query keeps the last good
  data when a background refetch fails; `resolveSchoolFeature` reads the data
  first, so a network blip never closes an open page or drops unsaved input.
  (`permissionsSatisfied` and `SchoolAccessBoundary` follow the same rule, and
  `resolveQueryBoundary` in `@campuspilot/components/query-boundary` is the
  shared form of it for any read; the admin flag editor uses it.)
- **A disabled-feature answer refreshes the flags.** The app's query client
  (`lib/orpc.ts`) invalidates `school.getFeatureFlags` whenever any query or
  mutation fails with the disabled-feature error (`featureFlagsOutdatedBy`), so
  navigation and pages close as soon as the server says a feature is off. Code
  that calls `client.*` directly inside a form submit does the same in its catch.
- `RequireFeature({ schoolId, feature, fallback?, children })`
  (`require-feature.tsx`): renders children only when enabled. Pending, unknown
  and disabled all render `fallback` (default nothing), like
  `RequirePermissions`.
- `FeaturePage` (`feature-unavailable.tsx`) gates a whole page for a typed or
  bookmarked URL: the page when enabled, `FeatureUnavailable` ("not enabled")
  when known to be off, `FeatureUnknown` (with Retry) when the flags could not
  be read, nothing while the first read runs.
- All share one query per school (`school.getFeatureFlags`).
- Wrap a permission-protected entry point with `RequireFeature` **and**
  `RequirePermissions`.

Admin: `/school/{id}/usage/feature-flags`, "Plan and features"
(`apps/admin/components/school-feature-flags.tsx`).

- **The Plan card** (`school-plan-card.tsx`, `school-period-section.tsx`, `school-billing/`)
  shows and changes the school's subscription (a tier or No subscription)
  and its trial ([School billing](school-billing.md#what-the-admin-app-shows)).
  While a change is pending it says which features the resulting plan adds
  and switches off, computed with the catalogue's own rules
  (`planChangeEffect` with `resolveSchoolPlan`: the adjustments are kept,
  requirements apply). A change that takes a feature away, removing the
  subscription, and ending a trial are confirmed in an app dialog that lists
  each lost feature with its `DISABLE_WARNINGS` text.
- **One card per catalogue feature**, with badges for its state (Enabled or
  Disabled), whether the tier includes it, and "Adjusted for this school"
  when an adjustment is stored. A switch-only feature's card offers three
  choices: Follow tier (saying what the tier gives), Always on, Always off,
  written as the adjustment null, true, false. Each card works on a
  `SchoolFeatureEntry` and builds its update by spreading it.
- `DISABLE_WARNINGS` (`school-feature-warnings.ts`) states everything
  switching a feature off does (keep it complete: staff, students,
  notifications); it is shown under the choice and again in the app
  confirmation dialog that a save which turns a live feature off opens.
  Switching on saves at once.
- The add-school dialog asks for the subscription (or none) and an optional
  trial; the schools table, the platform overview and a school's header
  show the subscription, the trial and "No plan" as badges.

A feature **with settings** is edited on its own page, where its switch and
its settings are saved together (switching it on needs settings): its card
here shows its state and links there. `SETTINGS_PAGES` in that file is an
exhaustive record over the features whose config is not `z.null()`, a
compile-time guard: a catalogue entry that gains a config does not compile
until it names its settings page. Today: `assistant` → School › AI
(`/school/{id}/usage/ai`, `apps/admin/components/assistant`), which uses the
same `DISABLE_WARNINGS` entry and confirmation dialog.

## The `assistant` feature: where it is enforced

An add-on on every tier (in no tier's `tiers`), switched on per school on
its own page with its settings.

Config: `{ monthlyLimitUsd: number | null, voice: { enabled: boolean } }`.
Schools read it through `school.getFeatureFlags` as `{ limited: boolean,
voice: { enabled } }` (`schoolFacingFeatureFlagsSchema`): the dollar limit
never reaches a school; administrators read the full config.
`voice.enabled` is a switch inside the feature:
whether the school has [voice mode](assistant.md#voice-mode). It only narrows
the assistant, and settings saved before it existed read as off. A config
saved before the role lists were merged still carries `eligibleRoles`; it is
ignored. Who may use the assistant is decided by
`resolveAssistantAccess` (feature, membership, a role the assistant is
switched on for in the school's one role list, the school not suspended, the
spend in the school's billing period, or IST month without one, under the limit); see
[In-app assistant](assistant.md#access).

| Surface | Behaviour when off |
| --- | --- |
| Every `/model/*` procedure (list, get, subscribe, send, approve, decline, stop, delete, status) | Disabled-feature error (`feature: 'assistant'`); nothing is written. Open streams end at their next recheck. |
| Delegated token issue (`issueAssistantRunToken`) | Disabled-feature error: no token. |
| Worker, before every model request | The run fails with `feature_disabled`; changes already approved and made stay made. A run waiting for approval stays paused until the feature is on again. |
| `systemAdmin.updateSchoolFeatureFlag` | Enabling needs the settings (`monthlyLimitUsd`); BAD_REQUEST without them. Switching it on for a school with no role switched on switches on the default roles. |
| `school.getAssistantAccess`, `school.updateAssistantRoles`, `school.getAssistantAllowance` | Disabled-feature error after the permission check. |
| Management UI | The navbar panel button, sidebar link and ⌘K entry (`AssistantAccess`), the assistant pages (`FeaturePage`), Settings › AI assistant and Settings › Usage disappear. |
| Question papers (every `exam_question_paper` procedure and upload route, the chat image upload and the question paper MCP tools) | `assistant` also gates question papers; there is no separate flag (decision D26). After the OPA class permission, `requireQuestionPaperAssistantAccess` refuses with the disabled-feature error or the assistant's own refusal (`role_not_enabled`, `not_member`, `limit_reached` for generation only). The `question_paper` document template (settings, marketplace preview and selection) needs the feature too (`requireDocumentTypePermission`). A running generation job stops with `feature_disabled`. |
| Management UI (question papers) | The Question paper tab of an examination, its marketplace card and Settings › Templates › Question paper disappear; the exam lands on Results. |

Conversations, runs, saved costs and the school's role list are kept while the
feature is off and come back when it is enabled; so are question papers, their versions
and PDFs, and chat images (see [Question papers](question-papers.md#permissions-gate-and-who-sees-it)). The admin usage pages
(`systemAdmin.getSchoolAssistantUsage`, `getPlatformAssistantUsage`) keep
showing past spend.

## Adding a feature

1. Add the entry to `schoolFeatureCatalogue` (label, description, `config`).
   Decide `tiers` (which tiers include it; empty for an add-on that an
   administrator switches on per school) and `requires`. Fix every exhaustive
   record the build then flags: the admin editor's `DISABLE_WARNINGS`, the
   assistant's `UNAVAILABLE_WORK`, `DOCUMENT_TYPE_FEATURE` if it owns
   document types, and the pinned key lists in tests. If the feature has
   notifications, name it in `notificationRequiredFeatures` for each of its
   types; if it is a notification channel's, in
   `notificationChannelRequiredFeatures`. Update the tier table at the top of
   this guide. A demo school is on `DEMO_SCHOOL_TIER`: check that the demo
   should have the feature, and adjust it in `createDemoSchool` if not.
2. If it has settings, give it a settings page in the admin app and name it
   in `SETTINGS_PAGES` (the guard there fails until you do), and decide the
   demo's config. `setSchoolFeature` refuses to enable it without a config. Read them in
   handlers with `getSchoolFeatureConfig`, after the gate; never parse a
   config inside a gate.
3. Gate the API: `requireSchoolFeature('<key>')` after the permission
   middleware on every procedure of the area; `assertSchoolFeatureEnabled`
   for partial paths and non-oRPC handlers. Add integration tests for off
   (disabled-feature error, nothing persisted) and on.
4. Gate the UI: `RequireFeature` around navigation and actions, `FeaturePage`
   around its pages.
5. No migration is needed unless an existing, already-used capability becomes a
   feature, or the feature joins a tier whose existing schools must not get
   it (or must keep it): then write the adjustments for existing schools in
   the same release, as 0073 did for `whatsapp` and `notices`.
6. Tests: `createTestSchool()` without a `tier` makes the baseline school
   most suites need (student management and WhatsApp on, nothing else: a
   Plus school with those two adjusted on); `createTestSchool({ tier })`
   makes a school of exactly that tier. Name what a suite needs:
   `createTestSchool({ features: ['<key>'] })` (a feature with settings as
   `{ feature: '<key>', config }`), `createFinanceScenario({ features })`,
   `createResultsSchool({ features })`, or flip one with
   `setTestSchoolFeature(schoolId, key, enabled, config?)`. Without `config`
   the stored settings are kept, as an administrator's switch keeps them.
7. Update this guide's tables.

## Adding or changing a tier

1. Add the tier to `SCHOOL_TIERS` and `schoolTierCatalogue`, and name it in
   the `tiers` of every feature it includes. Nothing is inferred from the
   position of a tier in the list.
2. `school.tier` has a CHECK listing the tiers: generate a migration
   (`pnpm db:generate`), and in it move existing schools if a tier is removed
   or split.
3. Moving a feature between tiers changes what existing schools have. Decide
   for them explicitly in a migration (an adjustment that keeps what they
   had, or nothing if they should follow the new tier).
4. Update the tier table at the top of this guide and the admin copy.
