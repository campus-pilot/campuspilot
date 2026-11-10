# School feature flags

A feature flag says whether one school **has** a product area (the Cadet Portal,
notices). Platform administrators switch flags per school in the admin app; a
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
| `SchoolFeatureKey`, `SCHOOL_FEATURE_KEYS`, `schoolFeatureKeySchema` | The keys (`cadet`, `notices`). |
| `SchoolFeatureConfig<K>` | The config type of exactly one key. A caller holding key `K` never sees another key's shape. |
| `SchoolFeatureState<K>` | `{ enabled: boolean; config: SchoolFeatureConfig<K> \| null }`. |
| `SchoolFeatureFlags` | `{ [K in SchoolFeatureKey]: SchoolFeatureState<K> }`. |
| `parseSchoolFeatureConfig(key, raw)` | Validates stored or submitted jsonb against that key's schema; null means "no config". |
| `schoolFeatureFlagsSchema`, `schoolFeatureUpdateSchema` | API output schema; update input as a discriminated union on `feature`. |
| `SCHOOL_FEATURE_DISABLED_REASON`, `readSchoolFeatureDisabled(error)` | The disabled-feature error contract (below). |

Browser apps do not depend on `@campuspilot/db`; they import the same names from
`@campuspilot/api/routers/school/feature-flags/feature-flags.dto`.

## Storage and defaults

Table `school_feature_flag` (`packages/db/src/schema/school-feature-flag.ts`,
migration `0048_school-feature-flags.sql`): primary key `(school_id, feature)`,
`enabled`, `config` jsonb, `updated_by`, `updated_at`.

- `feature` is text, not a database enum: adding a feature needs no migration,
  and rows of a retired key are ignored by every read.
- **A missing row means disabled with no config.** A new school has no rows, so
  every feature is off until an administrator enables it.
- `enabled` and `config` are independent facts. Disabling keeps the config.
- A stored config that no longer matches its schema makes the read throw; it is
  never silently replaced by a default.
- Migration 0048 backfilled `cadet = enabled` for every school that existed,
  because the Cadet Portal was already available to all of them. `notices` was
  not backfilled.
- Demo schools: `createDemoSchool` writes the features listed in
  `DEMO_SCHOOL_FEATURE_DEFAULTS` (`workflows/demo-school/constants.ts`, an
  exhaustive record) in the school's own transaction. Today both are on.
- `purge_demo_school` deletes the rows (migration `0049_demo-purge-feature-flags.sql`).

## Reading and writing (API)

| Where | What |
| --- | --- |
| `@campuspilot/db/feature-flags/store` | `getSchoolFeatureFlags(db, schoolId)`, `getSchoolFeature(db, schoolId, key)`, `isSchoolFeatureEnabled(db, schoolId, key)`. Shared with `@campuspilot/auth` (Cadet sign-in). |
| `packages/api/src/feature-flags/feature-flags.service.ts` | Re-exports the reads; `setSchoolFeature(db, { schoolId, feature, enabled, config, updatedBy })`; `assertSchoolFeatureEnabled(db, schoolId, key)`; `schoolFeatureDisabledError(key)`. |
| `packages/api/src/permissions/feature.ts` | `requireSchoolFeature(key)` middleware. |
| `school.getFeatureFlags({ schoolId })` | Any member of the school (`requireSchoolMember`), no permission. Returns `{ schoolId, features }`. MCP hidden. |
| `systemAdmin.getSchoolFeatureFlags({ id })` | `system.school.feature_flags.read`. MCP advanced. |
| `systemAdmin.updateSchoolFeatureFlag({ id, feature, enabled, config })` | `system.school.feature_flags.update`. MCP hidden (a human platform decision; its input is a discriminated union). Returns all flags of the school. |

Both system actions are granted to `platform.admin` only
(`packages/opa/src/policies/system`).

### Gating a staff procedure

```ts
.input(schema) // has schoolId
.use(requireSchoolPermission(SCHOOL_ACTIONS.X))
.use(requireSchoolFeature('notices'))
.handler(({ context }) => { context.feature.config /* typed for 'notices' */ })
```

Put the feature middleware **after** the permission middleware: a caller without
access gets the ordinary FORBIDDEN and cannot probe which features a school has.
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
| `/blob/school/{id}/cadet.webmanifest` | 404, identical to an unknown school. |
| Management UI | The Cadet Portal settings card, the "Generate Cadet Portal password" checkbox and "Issue portal password" are hidden (`RequireFeature`). |
| Cadet app | A signed-in student sees "Cadet Portal unavailable" with Sign out (`AppFrame`). |

Logins, sessions, grants and data are kept while the feature is off, and work
again when it is enabled. Not gated today: `releaseExamToCadet` /
`withdrawExamFromCadet` and the student notification fan-out (inbox rows, web
push, WhatsApp) still run for a school without the portal.

## The `notices` feature: where it is enforced

| Surface | Behaviour when off |
| --- | --- |
| Staff notice procedures (`routers/school/notice`: list, get, create, update, delete, preview, publish preview, publish, download) | Disabled-feature error (`feature: 'notices'`) after the permission check; nothing is written. |
| Document template procedures with `documentType: 'notice'` | Disabled-feature error after the permission check. Other document types are unaffected. |
| `listNotificationDeliveries` with a `notice` scope | Disabled-feature error. Other scopes are unaffected. |
| Cadet `listNotices`, `getNotice`, `getNoticeDownload` | Disabled-feature error (`feature: 'notices'`); the rest of the portal keeps working. |
| Cadet app | The Home notices block and the More row do not appear; `/notices` and `/notices/{id}` show "Notices are not available". The app reads the feature from the notice procedures' own error; there is no features read for students. |
| `getDashboard` | `actions.createNotice` is false. |

Addressing students also needs `cadet`: a notice whose `cadetScope` is not
`none` is refused with the disabled-feature error for `cadet` when it is
saved and again when it is published or its publication is previewed.
Notices, their cached PDFs and already emitted notifications are kept while
either feature is off.

## UI

Management (`apps/management/components`):

- `RequireFeature({ schoolId, feature, fallback?, children })`
  (`require-feature.tsx`): renders children only when enabled. Pending, failed
  and disabled all render `fallback` (default nothing), like
  `RequirePermissions`.
- `useSchoolFeature(schoolId, feature)`: `{ enabled, config, status }` typed by
  key, for code that needs the config or must tell loading from disabled.
- Both share one query per school (`school.getFeatureFlags`).
- `FeaturePage` / `FeatureUnavailable` (`feature-unavailable.tsx`): gate a whole
  page for a typed or bookmarked URL.
- Wrap a permission-protected entry point with `RequireFeature` **and**
  `RequirePermissions`.

Admin: `/school/{id}/usage/feature-flags`
(`apps/admin/components/school-feature-flags.tsx`), one card per catalogue
feature with an Enabled switch and Save. No feature has settings yet, so the
cards have no config controls; a compile-time guard in that file fails as soon
as a catalogue entry declares a config, so the control is added with it.

## Adding a feature

1. Add the entry to `schoolFeatureCatalogue` (label, description, `config`).
   Fix every exhaustive record the build then flags:
   `DEMO_SCHOOL_FEATURE_DEFAULTS`, the admin editor's `DISABLE_WARNINGS`, and
   the pinned key lists in tests.
2. If it has settings, add its config control to the admin editor (the guard
   there fails until you do) and decide the demo's config.
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
