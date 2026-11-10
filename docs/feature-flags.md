# School feature flags

A feature flag says whether one school **has** a product area (the Cadet Portal,
notices, the AI assistant). Platform administrators switch flags per school in the admin app; a
school's own staff can only read them. This guide is the canonical reference:
read it before adding a feature, gating a procedure or screen on one, or
changing how flags are stored or enforced.

A flag is not a permission. Permissions (OPA) decide *who* may act; a flag
decides whether the area exists for the school at all. Gate with both, each in
its own layer, and never infer one from the other.

## The catalogue

`packages/db/src/feature-flags/catalogue.ts` (Zod only, importable everywhere):

| Export | Meaning |
| --- | --- |
| `schoolFeatureCatalogue` | One entry per feature: `label`, `description`, `config` (a Zod schema; `z.null()` for a feature without settings). |
| `SchoolFeatureKey`, `SCHOOL_FEATURE_KEYS`, `schoolFeatureKeySchema` | The keys (`cadet`, `notices`, `assistant`). |
| `SchoolFeatureConfig<K>` | The config type of exactly one key. A caller holding key `K` never sees another key's shape. |
| `SchoolFeatureState<K>` | `{ enabled: boolean; config: SchoolFeatureConfig<K> \| null }`. |
| `SchoolFeatureFlags` | `{ [K in SchoolFeatureKey]: SchoolFeatureState<K> }`. |
| `SchoolFeatureEntry`, `schoolFeatureEntries(flags)` | One feature's state **with its key**, a union discriminated on `feature`. Use it whenever the key is not a literal (a loop, a form): a value whose key may be any feature cannot carry one feature's config for another. Build updates by spreading an entry, never by pairing `feature` and `config` by hand. |
| `parseSchoolFeatureConfig(key, raw)` | Validates stored or submitted jsonb against that key's schema; null means "no config". |
| `schoolFeatureFlagsSchema`, `schoolFeatureUpdateSchema` | API output schema; update input as a discriminated union on `feature`. |
| `SCHOOL_FEATURE_DISABLED_REASON`, `readSchoolFeatureDisabled(error)` | The disabled-feature error contract (below). |

Browser apps do not depend on `@campuspilot/db`; they import the same names from
`@campuspilot/api/routers/school/feature-flags/feature-flags.dto`.

## Storage and defaults

Table `school_feature_flag` (`packages/db/src/schema/school-feature-flag.ts`,
migration `0048_school-feature-flags.sql`): primary key `(school_id, feature)`,
`enabled`, `config` jsonb, `updated_by`, `updated_at`. `school_id` is
`ON DELETE CASCADE`: flags are the school's own configuration and go with it,
so `systemAdmin.deleteSchool` is never blocked by a flag row. (Migrations
0048 to 0053 were amended in place before their first release. A development
database that applied an earlier copy keeps what that copy created, for
example `NO ACTION` on this key, and must be recreated; no released database
has them.)

- `feature` is text, not a database enum: adding a feature needs no migration,
  and rows of a retired key are ignored by every read.
- **A missing row means disabled with no config.** A new school has no rows, so
  every feature is off until an administrator enables it.
- `enabled` and `config` are independent facts. Disabling keeps the config.
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
  not backfilled.
- Demo schools: `createDemoSchool` writes the features listed in
  `DEMO_SCHOOL_FEATURE_DEFAULTS` (`workflows/demo-school/constants.ts`, an
  exhaustive record) in the school's own transaction. `cadet` and `notices`
  are on; `assistant` is off (every assistant request is paid model usage, so
  an administrator enables it for a demo deliberately).
- `purge_demo_school` deletes the rows (migration `0049_demo-purge-feature-flags.sql`),
  and the assistant's rows and role list (`0056_demo-purge-assistant.sql`).
- `assistant` was not backfilled: it is off for every school until enabled.

## Reading and writing (API)

| Where | What |
| --- | --- |
| `@campuspilot/db/feature-flags/store` | `isSchoolFeatureEnabled(db, schoolId, key)` (the gate's question), `readSchoolFeatureFlags(db, schoolId)` (`{ features, invalidConfigs }`; never throws on a config), `getSchoolFeatureFlags(db, schoolId)` (its `features`), `readSchoolFeatureConfig(db, schoolId, key)` (`valid` with the config, or `invalid`). Shared with `@campuspilot/auth` (Cadet sign-in). |
| `packages/api/src/feature-flags/feature-flags.service.ts` | Re-exports the reads; `setSchoolFeature(db, { ...entry, schoolId, updatedBy })` (the input is a `SchoolFeatureEntry`); `assertSchoolFeatureEnabled(db, schoolId, key)` (decides from `enabled` only, returns nothing); `getSchoolFeatureConfig(db, schoolId, key)` (the typed config for a handler that uses it; `CONFLICT` when the stored value is invalid); `schoolFeatureDisabledError(key)`, `schoolFeatureConfigInvalidError(key)`. |
| `packages/api/src/permissions/feature.ts` | `requireSchoolFeature(key)` middleware: the gate, from `enabled` alone; adds nothing to the context. |
| `school.getFeatureFlags({ schoolId })` | Any member of the school (`requireSchoolMember`), no permission. Returns `{ schoolId, features, invalidConfigs }`. MCP hidden. |
| `systemAdmin.getSchoolFeatureFlags({ id })` | `system.school.feature_flags.read`. MCP advanced. |
| `systemAdmin.updateSchoolFeatureFlag({ id, feature, enabled, config })` | `system.school.feature_flags.update`. MCP hidden (a human platform decision; its input is a discriminated union). Returns all flags of the school. |

Both system actions are granted to `platform.admin` only
(`packages/opa/src/policies/system`).

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

Admin: `/school/{id}/usage/feature-flags`
(`apps/admin/components/school-feature-flags.tsx`), one card per catalogue
feature. A switch-only feature's card has an Enabled switch and Save. Each card
works on a `SchoolFeatureEntry` and builds its update by spreading it.
`DISABLE_WARNINGS` states everything switching a feature off does (keep it
complete: staff, students, notifications); it is shown under the switch (which
it describes, `aria-describedby`) and again in the app confirmation dialog that
saving a switch-off opens. Enabling saves at once. Each switch's accessible name
includes the feature's label.

A feature **with settings** is edited on its own page, where its switch and
its settings are saved together (switching it on needs settings): its card
here shows its state and links there. `SETTINGS_PAGES` in that file is an
exhaustive record over the features whose config is not `z.null()`, a
compile-time guard: a catalogue entry that gains a config does not compile
until it names its settings page. Today: `assistant` → School › AI
(`/school/{id}/usage/ai`, `apps/admin/components/assistant`), which uses the
same `DISABLE_WARNINGS` entry and confirmation dialog.

## The `assistant` feature: where it is enforced

Config: `{ monthlyLimitUsd: number | null, eligibleRoles: role[] }` (at least
one role, each once). Who may use the assistant is decided by
`resolveAssistantAccess` (feature, membership, an eligible role the school
switched on, the IST month spend under the limit); see
[In-app assistant](assistant.md#access).

| Surface | Behaviour when off |
| --- | --- |
| Every `/model/*` procedure (list, get, subscribe, send, approve, stop, delete, status) | Disabled-feature error (`feature: 'assistant'`); nothing is written. Open streams end at their next recheck. |
| Delegated token issue (`issueAssistantRunToken`) | Disabled-feature error: no token. |
| Worker, before every model request | The run fails with `feature_disabled`; changes already approved and made stay made. |
| `school.getAssistantAccess`, `school.updateAssistantRoles`, `school.getAssistantUsage` | Disabled-feature error after the permission check. |
| Management UI | The navbar panel button, sidebar link and ⌘K entry (`AssistantAccess`), the assistant pages (`FeaturePage`), Settings › AI assistant and Settings › Usage disappear. |

Conversations, runs, saved costs and the school's role list are kept while the
feature is off and come back when it is enabled. The admin usage pages
(`systemAdmin.getSchoolAssistantUsage`, `getPlatformAssistantUsage`) keep
showing past spend.

## Adding a feature

1. Add the entry to `schoolFeatureCatalogue` (label, description, `config`).
   Fix every exhaustive record the build then flags:
   `DEMO_SCHOOL_FEATURE_DEFAULTS`, the admin editor's `DISABLE_WARNINGS`, and
   the pinned key lists in tests. If the feature has notifications, name it in
   `notificationRequiredFeatures` for each of its types.
2. If it has settings, add its config control to the admin editor (the guard
   there fails until you do) and decide the demo's config. Read them in
   handlers with `getSchoolFeatureConfig`, after the gate; never parse a
   config inside a gate.
3. Gate the API: `requireSchoolFeature('<key>')` after the permission
   middleware on every procedure of the area; `assertSchoolFeatureEnabled`
   for partial paths and non-oRPC handlers. Add integration tests for off
   (disabled-feature error, nothing persisted) and on.
4. Gate the UI: `RequireFeature` around navigation and actions, `FeaturePage`
   around its pages.
5. No migration is needed unless an existing, already-used capability becomes a
   feature; then backfill `enabled = true` for existing schools in the same
   release, as 0048 did for `cadet`.
6. Tests: fixtures create schools with no feature. Name what a suite needs:
   `createTestSchool({ features: ['<key>'] })`, `createFinanceScenario({ features })`,
   `createResultsSchool({ features })`, or flip one with
   `setTestSchoolFeature(schoolId, key, enabled)`.
7. Update this guide's tables.
