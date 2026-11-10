# Cadet Portal

This guide is the canonical cross-layer reference for the Cadet Portal: the
student-facing app, its own Better Auth instance, the `cadet_*` tables,
`cadetRouter`, the cadet MCP, and the management actions that issue portal
passwords. Read it before changing cadet auth, any `cadet_*` table, the cadet
router or MCP, `apps/cadet`, password issuing in the admission workspace, or the
demo purge of cadet logins.

Where this guide and older design notes disagree, the code wins; every rule here
cites the file that enforces it.

## Naming and goal

**Cadet** is the code name for everything student-facing. "Student" is never used
for it, because `student` already names the enrolment table (one row per admission
per academic session). A cadet login belongs to an **admission**
(`admission`, unique per `(school_id, admission_no)`), so the portal spans every
session the student was enrolled in.

| Place | Name |
| --- | --- |
| UI copy | **Cadet Portal** (code names below are unchanged) |
| App | `apps/cadet` (Next.js), dev port **3004** (`apps/cadet/package.json`, `apps/cadet/Dockerfile`) |
| Production host | `cadet.campuspilot.in`: image `campuspilot-plus-cadet` from `release.yml` (built with `NEXT_PUBLIC_SERVER_URL`), served in-cluster at `cadet.campuspilot-plus.svc.cluster.local:3004` behind the Cloudflare tunnel |
| API routes | `/api/cadet/auth/*`, `/api/cadet/rpc/*`, `/cadet/mcp` |
| Router / procedure base | `cadetRouter`, `cadetProcedure` |
| Tables | `cadet_*` (`packages/db/src/schema/cadet.ts`) |
| Cookie prefix | `cpc_` (staff: `cp_`) |
| Redis key prefix | `server:cadet-auth:` (staff: `server:auth:`) |
| Env | `CADET_APP_URL`, `CADET_MCP_RESOURCE_URL` |
| OPA action | `school.admission.cadet_password.issue` |
| `createAdmission` flag | `generateCadetPassword` |
| Placeholder email | `<admissionId>@cadet.campuspilot.invalid` |

Students sign in with school code + admission number + a school-issued password
and see their own data: Home, Fees (one ledger and bill detail), Results (only
exams the school released to the portal), Growth (per class) and More. Students
can also connect AI apps through the read-only cadet MCP.

## Architecture

One API server (`apps/server`) and one API package (`packages/api`) serve both
staff and cadets. Isolation comes from a **second Better Auth instance** and a
**separate router with its own context type**, not from a separate server or
Postgres schema.

### Two Better Auth instances, one foundation

`packages/auth/src/auth-foundation.ts` holds what both instances share: logger,
Drizzle adapter, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, cookie attributes
(`sharedCookieOptions`), Redis secondary storage, `storeSessionInDatabase`, and
the `authDb` pool. Each instance declares only what differs:

| | Staff (`packages/auth/src/server.ts`) | Cadet (`packages/auth/src/cadet.ts`) |
| --- | --- | --- |
| Base path / OAuth issuer | `/api/auth` | `/api/cadet/auth` (`cadetOauthIssuer()`) |
| Cookie prefix | `cp_` | `cpc_` |
| Tables | staff auth tables | `cadet_*` via `cadetAuthSchema` |
| Redis prefix | `server:auth:` | `server:cadet-auth:` (`CADET_REDIS_KEY_PREFIX`) |
| Trusted origins | `CORS_ORIGIN` | `CADET_APP_URL` origin only |
| Sign-in | email/password, Google, API key | `POST /sign-in/admission` only |
| MCP OAuth | resource `MCP_RESOURCE_URL`, pages on management | resource `CADET_MCP_RESOURCE_URL`, pages on the cadet app |

Why they are separate:

- **Cookies.** A teacher who is also a parent must be signed in to management and
  the portal at once. Distinct prefixes let both sessions coexist; neither app
  reads the other's cookie. Better Auth's `multiSession` was rejected: it keeps
  one active session per instance, so the two apps would fight over it.
- **Redis.** Sessions and sign-in counters live under different prefixes, so a
  staff session token can never resolve as a cadet session or the reverse.
- **Issuer and resource.** Cadet MCP tokens are signed by the cadet JWKS
  (`cadet_jwks`) for the cadet issuer and audience. The staff gate never
  verifies them and the cadet gate never verifies staff tokens
  (`apps/server/src/http.ts`, `verifyMcpAccessToken` in
  `packages/auth/src/mcp-credential.ts`).

On the cadet instance `emailAndPassword` is disabled and `disabledPaths` blocks
`/sign-in/email`, `/sign-up/email`, `/update-user`, `/delete-user`,
`/change-email`, `/change-password`, `/set-password`, `/request-password-reset`
and `/reset-password`. Its `user.additionalFields` (`admissionId`,
`passwordSource`, `issuedAt`, `issuedBy`) are `input: false`. The shared MCP
OAuth plugins (`jwt`, `mcp`, `cimd`) come from `mcpOAuthPlugins()` in
`packages/auth/src/mcp-oauth.ts`, parameterised by `cadetMcpOAuthConfig()`.

### Routes and their order

All in `apps/server/src/http.ts`:

| Route | Handler |
| --- | --- |
| `POST/GET /api/cadet/auth/*` | `cadetAuth.handler` |
| `/api/cadet/rpc/*` | `cadetRpcHandler` (`cadetRouter`), context from `createCadetContextFromHeaders` |
| `/cadet/mcp` | `createMcpGate<CadetContext>` + `createCampusPilotMcpHandler<CadetContext>` with `cadetMcpCatalog = buildMcpCatalog(cadetRouter)` and its own `AsyncLocalStorage` |
| `GET /.well-known/oauth-protected-resource/cadet/mcp` | `cadetAuth.handler` |
| `GET /.well-known/oauth-authorization-server/api/cadet/auth` | `cadetAuth.api.getOAuthServerConfig()` |
| `GET /.well-known/openid-configuration/api/cadet/auth` | `cadetAuth.api.getOpenIdConfig()` |

The three cadet well-known routes are registered **before**
`/.well-known/oauth-protected-resource/*`, which sends everything else to staff
auth. Hono matches in registration order; moving them after the wildcard makes
staff auth answer for the cadet resource. `cadet-http.integration.test.ts`
covers this. Both MCP endpoints are top-level, not under `/api`: staff at `/mcp`,
cadet at `/cadet/mcp`. The cadet MCP is never nested under a staff resource path.

### CORS

`apps/server/src/config.ts`: the cadet origin (`CADET_APP_URL`) is **not** in
`CORS_ORIGIN` (staff auth trusts `CORS_ORIGIN`). The credentialed application CORS
returns the cadet origin only when the path starts with `/api/cadet/` or is
`/cadet/mcp`; on staff
RPC, MCP and blob routes it gets no CORS. Public discovery (`/.well-known/*`,
`/api/cadet/auth/.well-known/*`, `/api/cadet/auth/jwks`) uses `origin: *`
without credentials, as for staff.

## Database and identity model

Tables (`packages/db/src/schema/cadet.ts`, migrations
`packages/db/src/migrations/0029_cadet-portal.sql` and
`0030_demo-purge-cadet.sql`), all in `public`:

| Table | Notes |
| --- | --- |
| `cadet_user` | One login per admission. `admission_id` unique, not null, FK to `admission.id` **on delete cascade**. `password_source` (`cadet_password_source` enum: `issued`, `student_set`), `issued_at`, `issued_by` (FK to staff `user.id`, on delete set null). `name` is stored empty; `email` is the placeholder. |
| `cadet_session`, `cadet_account`, `cadet_verification` | Better Auth models; sessions and accounts cascade from `cadet_user`. The password hash is in `cadet_account` (`provider_id = 'credential'`, `account_id = user id`). |
| `cadet_jwks` | Signing keys of the cadet issuer. |
| `cadet_oauth_client`, `cadet_oauth_resource`, `cadet_oauth_client_resource`, `cadet_oauth_refresh_token`, `cadet_oauth_access_token`, `cadet_oauth_consent`, `cadet_oauth_client_assertion` | Cadet MCP authorization server. |

The cadet OAuth tables are column-for-column copies of the staff ones because the
same Better Auth models map onto them. `CadetOAuthTableShapeChecks` in
`packages/auth/src/mcp-oauth.ts` fails typecheck if a cadet table drifts from its
staff counterpart; `CADET_OAUTH_SERVER_TABLES` and `CADET_OAUTH_GRANT_TABLES`
(`mcp-credential.ts`) rely on that. Change both tables together.

Identity rules:

- **The admission is referenced only by `admission.id`**, the login only by
  `cadet_user.id`. The placeholder email is built from the admission id
  (`cadetPlaceholderEmail` in `packages/auth/src/cadet-policy.ts`); `.invalid`
  never delivers and email sign-in is disabled, so it can never authenticate.
- **The admission number is never stored at the auth level**: not in a `cadet_*`
  column, key or constraint, not in the email, session, Redis, token claims (the
  subject is `cadet_user.id`) or rate-limit keys. Sign-in resolves it against the
  live `admission.admission_no` each time. Renaming 2026 to 2027 makes 2027 work
  at once and 2026 stop; existing sessions are unaffected.
- `admission.email` is a contact field only; it is never the login.
- The student's name stays on the admission and is never copied to `cadet_user`.
- One login per admission. A parent with two children uses two logins for now.

## Sign-in

`POST /api/cadet/auth/sign-in/admission` with `{ schoolSlug, admissionNo,
password, oauth_query? }`, implemented by the `cadetAdmissionSignIn` plugin in
`packages/auth/src/cadet-sign-in.ts`. The form shows **School**, **Admission
number** and **Password**.

**Choosing the school** (`apps/cadet/components/school-combobox.tsx`). School is
a combobox (`@campuspilot/ui` `Combobox`, Radix + cmdk), not a free-text code.
After three characters it asks the public `searchSchools`, which returns up to
five schools matching the name or school code anywhere (exact code first, then
prefix matches, then by name). Picking one stores only its code (`school.slug`);
the school's name and logo are then shown in the field and above the form from
the public `getSignInSchool` (exact code). A school can share
`/sign-in?school=<school code>`: the code is the form's initial value, and a
code no school has says so under the field. Demo schools (`is_demo`) are never
suggested; they are returned only for their exact code.

Both procedures (`packages/api/src/routers/cadet/cadet-school-search.router.ts`)
are built on `co` without `cadetProcedure`, so they answer anonymous callers,
are `exposure: 'hidden'` on MCP, and return only the school code, name and a
5-minute presigned logo URL (in-page logos never use the `/blob` icon). Each
client IP may call them 30 times per 10 s together (`apps/server/src/http.ts`).

1. If the client IP is locked, refuse with `CADET_SIGN_IN_LOCKED`.
2. Join `school.slug` + `admission.admission_no` to the admission (registered or
   unregistered) and left-join its login and credential hash.
3. No admission: hash the password anyway (equal timing), count an IP failure,
   refuse with `INVALID_CADET_CREDENTIALS`.
4. Admission found: if `sign-in:admission:<admissionId>` is locked, refuse.
5. Verify the hash; an admission **without** a login hashes anyway and fails
   exactly like a wrong password.
6. Failure counts against both the IP and the admission. Success clears the
   admission's count, creates the session through `internalAdapter` and sets the
   `cpc_` cookie.

Every credential failure returns the same message. Limits
(`cadet-policy.ts`, `cadet-sign-in-limits.ts`, Redis under the cadet prefix):

| Key | Limit |
| --- | --- |
| Resolved admission id | 5 failures in 15 min locks for 15 min; checked before the password, so a locked admission cannot be probed further. Same for admissions with and without a login. |
| Client IP | 30 failures in 15 min locks that IP for 15 min. Failures only; success neither counts nor resets (a school lab may share one NAT). |

The window starts at the first failure (`EXPIRE … NX`); reaching the limit sets
the lock and resets the count.

## Passwords

### Format

`generateCadetPassword()` (`packages/auth/src/cadet-password.ts`):
`<word>-<different word>-<10..99>`, e.g. `happy-tiger-27`, from
`node:crypto.randomInt`. 524 curated child-friendly words → about 24.7 million
combinations. The list excludes one-edit neighbours, homophones, rude or unkind
readings and words over nine letters; unit tests in
`cadet-auth.integration.test.ts` enforce the mechanical rules, the rest is checked
by hand when adding a word.

The password is **issued, never derived** from profile data. Profile edits never
touch it. Only the hash is stored; staff can never view a password again, only
issue a new one. There is no PDF or printed slip.

### Issuing and resetting

| Path | Behaviour |
| --- | --- |
| `school.issueAdmissionCadetPassword({ schoolId, admissionId })` (`packages/api/src/routers/school/admission/admission.router.ts`) | Requires `school.admission.cadet_password.issue`. Works for registered **and** unregistered admissions. In one transaction: find the admission in the school, then `issueAdmissionCadetPassword` (`admission-cadet-password.ts`) → `issueCadetLogin` (`packages/auth/src/cadet-login.ts`), which upserts `cadet_user` on `admission_id` (the row lock serialises concurrent issues), sets `password_source = 'issued'`, `issued_at`, `issued_by`, and writes the hash to the credential account. **After commit**, `revokeCadetLoginAccess([userId])`. Returns `{ schoolSlug, admissionNo, password }` once. |
| `school.createAdmission({ …, generateCadetPassword })` | `generateCadetPassword: z.boolean().default(false)` (`admission.dto.ts`). When true, `school.admission.cadet_password.issue` is checked **in addition to** `school.admission.create`, and the login and hash are written in the admission's transaction (rolled back together). Output field `cadetPassword` is `null` unless requested. When false, no `cadet_*` rows are created. |

`issueCadetLogin` writes with Drizzle inside the caller's transaction (not
through the auth instance) so it commits or rolls back with the admission; it
hashes with Better Auth's `hashPassword`, the same hasher the cadet instance
verifies with. It does **not** revoke anything; callers do that after commit.

If revocation fails after a reset commits, staff get an error and no password,
and issuing again revokes again (`admission-cadet-password.integration.test.ts`).

**Permission.** OPA action `school.admission.cadet_password.issue`
(`packages/opa/src/policies/school/catalog.rego`, granted to `school.principal`
and `school.manager` in `grants.rego`, generated as
`SCHOOL_ACTIONS.ISSUE_ADMISSION_CADET_PASSWORD`). It is deliberately separate from
`school.admission.create`, so granting admission creation to another role later
does not grant password resets.

**Management UI.**

- `apps/management/components/create-admission-action.tsx`: the admission dialog
  offers a **"Generate Cadet Portal password"** checkbox (TanStack Form field,
  unchecked by default) only to users who hold the issue permission.
- `apps/management/components/admission-actions.tsx` and
  `admission-actions-model.ts`: the admission workspace's top-right overflow menu
  shows **"Issue portal password"** (permission-gated, shown for registered and
  unregistered admissions; Edit and Unregister stay registered-only). An app
  dialog titled "Issue a new Cadet Portal password?" warns that any previous
  password stops working and the student is signed out everywhere, including
  connected AI apps; its wording is correct whether or not a login exists.
- Both flows show `IssuedCadetPasswordDialog`
  (`packages/components/src/cadet-portal/issued-cadet-password-dialog.tsx`),
  titled "This password will only be shown once", with school code, admission
  number, password and a Copy details button that copies all three. The copy
  button uses `useMutation`, so consumers need a `QueryClientProvider`.

**Staff MCP.** `createAdmission` is a core write tool and exposes
`generateCadetPassword`; when true the password is returned in the tool result.
Accepted trade-off: the password lands in the AI app's history and should be
rotated. `issueAdmissionCadetPassword` is `exposure: 'hidden'` on MCP: a reset
returns a credential and signs a student out, so it stays a human action (RPC
only).

### Reset and revocation semantics

`revokeCadetLoginAccess(userIds)` (`packages/auth/src/cadet.ts`) deletes every
session **through the cadet instance's `internalAdapter.deleteUserSessions`**, so
the Redis copies go too, then deletes the logins' cadet OAuth access tokens,
refresh tokens and consents in one transaction. The cadet MCP gate checks the
consent on every request (`findLiveOAuthGrant` with `CADET_OAUTH_GRANT_TABLES`),
so an unexpired access token stops working immediately. It is idempotent.

## The `cadet` feature flag

Whether a school has the Cadet Portal is the per-school platform feature
`cadet` (`school_feature_flag`, switched by platform administrators in the
admin app; see [School feature flags](feature-flags.md)). There is no separate
school-level "enable portal" setting. Schools that existed when the flag was
introduced were enabled by migration 0048; a new school has it off until an
administrator enables it; demo schools are created with it on.

While the flag is off the portal is unavailable for that school on every
surface, and each decides from the same read
(`@campuspilot/db/feature-flags/store`):

| Surface | Behaviour |
| --- | --- |
| Sign-in (`cadet-sign-in.ts`) | The school's admissions are treated like an unknown school or admission number: `INVALID_CADET_CREDENTIALS`, the password is hashed anyway, only the IP failure counts, and the admission never locks. A correct password is refused too. |
| `cadetProcedure` | Checked on every call, so existing sessions stop at once: FORBIDDEN with `data: { reason: 'SCHOOL_FEATURE_DISABLED', feature: 'cadet' }`. Never UNAUTHORIZED, because the login is still valid. `apps/cadet`'s `AppFrame` shows "Cadet Portal unavailable" with Sign out. |
| Cadet MCP (`createCadetOAuthContext`) | Returns null, so the gate answers 401 like a revoked connection. |
| `issueAdmissionCadetPassword`, `createAdmission({ generateCadetPassword: true })` | Refused with the same FORBIDDEN after the permission check; nothing is written. |
| `getCadetPortalSettings`, `updateCadetPortalSettings` | Refused the same way. |
| `releaseExamToCadet`, `previewExamCadetRelease`, `sendStudentResultNotification`, `previewStudentResultNotification` | Refused the same way after their permission checks: nothing is released, stamped or notified. |
| A notice addressed to students, and its notifications | Cannot be saved or published; copies not sent yet are skipped (see [School notices](notices.md)). |
| `/blob/school/{id}/cadet.webmanifest` | 404, as for an unknown school. |
| Management | The Cadet Portal settings card, both password entry points and the examination's Cadet Portal release are hidden. |
| AI-app consent screen (`oauth-consent.tsx`) | "Cadet Portal unavailable", not "this app is not known". |

Nothing is deleted or revoked when the flag is switched off: logins, sessions,
MCP grants and push subscriptions are kept and work again when it is switched
on. Three things stay possible on purpose: `withdrawExamFromCadet` (it only
hides what was released), `unsubscribePush` (a student can always stop a
device's notifications; it is on `cadetLoginProcedure`, the builder without the
feature check, and nothing else may use that builder without the same
reasoning), and signing out. Bill and payment notifications are not portal
features and are delivered regardless of the flag.

### A session that ends stops its device, on the server

A push subscription records the portal session that turned it on
(`cadet_push_subscription.cadet_session_id`; subscribing again from another
session moves it). When that session ends, **by any path**, its subscriptions
are revoked where the session row is deleted: a `BEFORE DELETE` trigger on
`cadet_session` (`cadet_session_revoke_push_subscriptions`, migration 0052)
sets `revoked_at` before the foreign key clears the link. No endpoint or hook
has to remember it, so a path added later cannot forget it:

| How the session ends | What deletes the row |
| --- | --- |
| Sign out (`/sign-out`) | Better Auth `deleteSession` |
| Sign out elsewhere (`/revoke-session`, `/revoke-sessions`, `/revoke-other-sessions`; enabled on the instance, not offered by the app) | Better Auth `deleteSession(s)` |
| Staff password reset or revocation, admission deletion, demo purge | `revokeCadetLoginAccess` (`deleteUserSessions`; it also revokes every subscription of the login, including ones without a session) |
| Expiry | Better Auth deletes an expired session when its cookie is next presented; any later cleanup job that deletes expired rows is covered the same way |

So a signed-out phone stops receiving the student's notifications even when
the app's own "turn off" request never arrives (offline) or is refused. The
app still calls `unsubscribePush` first, which also removes the browser's
subscription and covers rows stored before the session was recorded (their
`cadet_session_id` is null). Two limits, stated plainly: an expired session
that nobody presents again keeps its row, and so its device stays subscribed,
until that row is deleted; and a subscription stored before 0052 names no
session, so only `unsubscribePush` and `revokeCadetLoginAccess` revoke it.
The trigger is not part of the Drizzle schema; it lives in the migration.

## Lifecycle

| Event | Portal access |
| --- | --- |
| Unregister (`unregisterAdmission`, sets `registered = false`) | **Kept.** Registration and portal access are separate facts; the student keeps signing in and seeing past records. Staff can still issue passwords. |
| Profile edit | Password untouched. |
| Admission number edit | Only the username changes; sessions continue. |
| Delete (`deleteAdmission`: registered admissions without enrolment history only) | Inside the delete, `findCadetLoginId` then `revokeCadetLoginAccess` (Redis included), then the admission row is deleted and the `cadet_*` rows cascade. A refused delete keeps the login. |
| Login deleted while a token is live | `createCadetOAuthContext` reloads the login per request and returns null; `cadetProcedure` refuses if the admission is gone. |

## `cadetRouter` and `cadetProcedure`

- `packages/api/src/cadet/context.ts`: `CadetContext` is its own type
  (`db`, `headers`, `login: { userId, admissionId } | null`, `principal`:
  `anonymous` | `session` | `oauth` with grant). It is resolved only by
  `cadetAuth.api.getSession`, so `cp_` cookies and API keys are anonymous here.
  Cadets have no API keys.
- `packages/api/src/cadet/procedure.ts`: builder `co =
  os.$context<CadetContext>()`. `cadetProcedure` requires a login, binds
  `context.cadet = { userId, admissionId, schoolId }` from
  `cadet_user.admission_id` and that admission's `school_id`, and, for OAuth
  callers, refuses any procedure whose `meta.mcp.access` is not `read` or a grant
  without `mcp:read`.
- `packages/api/src/routers/cadet/cadet.router.ts`: **not** part of `appRouter`.
  Staff RPC, OpenAPI and MCP can never list or reach it, and its handler never
  reaches staff procedures (the types differ). Procedures today (records ones in
  `cadet-records.router.ts`, DTOs in `cadet.dto.ts`, logic in
  `cadet-academics.service.ts` and `cadet-fees.service.ts`):

| Procedure | MCP | Purpose |
| --- | --- | --- |
| `getAdmission` | core, read, module `account` | The signed-in admission, returned with management's `admissionDtoSchema` / `toAdmissionDto` (reuse DTOs; do not fork a cadet copy). |
| `getOAuthConsentClient({ clientId })` | hidden | Consent-screen facts from `cadet_oauth_client` only (`oauthConsentClientSchema` from `routers/auth/auth.dto.ts`); a staff client id is never found. |
| `listNotifications`, `getUnreadNotificationCount`, `markNotificationsRead`, `markAllNotificationsRead`, `dismissNotifications` | hidden | The student's notification inbox (`cadet-notification.router.ts`), bound to the session's admission through the shared visibility predicate in `packages/api/src/notifications/inbox.ts`; no delivery status. |
| `getProfile` | core, read, `account` | Name, admission number, school, the server-chosen **current** class record (active-session placement, else newest) and enrollments. Clients use `current`; they never pick "current" themselves. |
| `getFeeSummary` | core, read, `billing` | Lifetime balance, billed, paid, concessions, refunds per currency (staff `getAdmissionFinanceSummary`). |
| `listFeeLedger` | core, read, `billing` | Paginated ledger with running balances (staff `getAdmissionLedger`), narrowed: no recorder ids, notes or idempotency keys. |
| `getBill({ billId })` | core, read, `billing` | Lines, the bill's own concessions/corrections and net amount. Payments are account credits, so no per-bill "paid". |
| `listExams({ filters.recordId? })` | core, read, `exams` | Exams of one class record (default: current) with state `upcoming` / `in_progress` / `awaiting_release` / `released`; scores only when released. |
| `getExam({ examId })` | core, read, `exams` | One exam's state, independent of list paging. |
| `getExamResult({ examId })` | core, read, `exams` | Released exams only (otherwise NOT_FOUND): subjects, overall, delta to the previous released exam of the same class, attendance and activities (report-card rules, `exam/exam-assessment-rules.ts`), remark, optional class averages. |
| `getGrowth({ recordId? })` | core, read, `exams` | Every class record, overall % per released exam of the selected one; subject ids are scoped to the class record and never compared across classes. |
| `listRemarks({ filters.recordId? })` | core, read, `exams` | Teacher remarks of released exams, dated by the exam's release. |
| `listNotices({})` | core, read, `notices` | Published notices addressed to the student (paginated, newest first): `{ noticeId, title, publishedAt }`. Needs the school's `notices` feature. |
| `getNotice({ noticeId })` | core, read, `notices` | One addressed notice as content: `{ noticeId, title, publishedAt, bodyMode, text }`, never HTML (`text` is the plain body, or the readable text of a custom-template notice); anything else is NOT_FOUND. |
| `getNoticeDocument({ noticeId })` | hidden, read | The printed page of one addressed notice as sanitized `html` for the sandboxed iframe. App only: it is megabytes of markup with the logo embedded. |
| `getNoticeDownload({ noticeId })` | hidden, read | A five-minute URL of the notice's cached PDF (the file staff download). |

A **class record** is one class within one session's enrollment
(`{studentId}.{classId}`); an `examId` is `{recordId}.{examSlug}`. Records come
from the enrollment's placement plus any class whose plans hold the student's
results, so a student moved mid-session keeps the class they sat the exam in.
Remark, attendance and activities attach only to the record holding the results.

**Release and averages.** Results are visible only after the school's explicit
`releaseExamToCadet` (staff, exam transition permission, and the school's
`cadet` feature), which needs a completed exam and blocks reopening and legacy plan changes until
`withdrawExamFromCadet`. The release time is always when the call was made;
only the demo seed sets it, to the demo's creation time (see `docs/demo-school.md`). The **first**
release also notifies every registered student of the examination
(`exam.results_published`: inbox, web push, WhatsApp) in the same transaction,
recorded once per exam in `exam_result_publication`; the confirmation shows the
per-channel forecast (`previewExamCadetRelease`). Withdraw notifies nobody, and
neither does a re-release (D-43; see `packages/api/src/routers/school/exam/README.md`).
Release freezes marks and remarks, not labels or grading
(no snapshot). Remarks (`exam_student_remark`) are written in the management
student result page and are locked while released. Class averages appear only
when the school setting `cadet_show_class_averages` is on (school settings) and
at least `CADET_CLASS_AVERAGE_MIN_STUDENTS` (5) approved, registered students
contribute; the server returns null otherwise.

**Notices.** A student sees a notice when it is published, belongs to their
school, addresses students (`cadet_scope` is not `none`) and they are enrolled
in the notice's session; for `selected_classes` the enrollment's class must be
one of the notice's classes (`cadet-notices.service.ts`). Membership is
evaluated on each request, so a student moved to another class sees that
class's notices. Who was *notified* is fixed when the notice is published
(`notice.published`: inbox, web push, WhatsApp with the PDF; route
`/notices/{noticeId}`). The four procedures also require the school's
`notices` feature. The screens are `/notices` and `/notices/{noticeId}` (see
"Front end"); [School notices](notices.md) is the canonical guide.

## Cadet MCP

- Endpoint `/cadet/mcp`, **OAuth only**: the gate has no
  `createApiKeyContext`, and cookies are ignored.
- Scopes: `openid`, `profile`, `offline_access`, `mcp:read`
  (`CADET_OAUTH_SUPPORTED_SCOPES`); default and challenged scope `mcp:read`.
  `mcp:write` and `email` are not offered.
- Token policy is shared with staff (`mcpOAuthPlugins`): authorization code +
  refresh token only, PKCE, 1 h access tokens, 90-day rotating refresh tokens,
  CIMD, open DCR rate-limited to 5 per minute per IP. `clientPrivileges` is
  always false: nobody manages cadet clients through the OAuth CRUD endpoints.
  DCR registrations are tagged by `recordDynamicClientRegistration` with the cadet
  tables.
- Login and consent pages are on the cadet app: `/sign-in` and `/oauth/consent`
  (`CADET_OAUTH_LOGIN_PATH`, `CADET_OAUTH_CONSENT_PATH`).
- **Sign-in during authorization** (`apps/cadet/components/sign-in-form.tsx`,
  `apps/cadet/lib/auth-client.ts`): when the URL carries Better Auth's signed
  query (`sig`), the page says an app is asking to connect and posts through
  `oauthAuthClient` (with `oauthProviderClient()`, which forwards the signed
  query). That client is separate because it attaches the query to every non-GET
  request. The signed query expires at `exp` (Better Auth's default
  `codeExpiresIn`, 600 s, unchanged); an expired one shows "This connection
  request has expired" instead of the form.
- **Consent** (`apps/cadet/components/oauth-consent.tsx`): Allow/Cancel through
  one `useMutation` calling `oauth2.consent`; no scope picker (read only). It
  states in plain words when `offline_access` lets the app keep reading. If the
  session expired, it redirects to `/sign-in` **with** the signed query so the
  authorization resumes.

## Demo schools

- **No seeded cadet logins.** The demo seed's `createAdmission` calls keep
  `generateCadetPassword` at its default `false`. A demo user tries the portal by
  issuing a password from the admission workspace.
- **Purge covers cadet** (`packages/api/src/workflows/demo-school/purge-workflow.ts`):
  the revoke stage calls `revokeCadetLoginAccess` for the school's logins
  (`schoolCadetLoginIds`, via `cadet_user` ⋈ `admission`); the data stage records
  them in `demo_school_purge.cadet_user_ids`; the second revoke re-runs it from
  that manifest. `purge_demo_school()` (migration `0030_demo-purge-cadet.sql`)
  explicitly deletes the school's `cadet_oauth_access_token`,
  `cadet_oauth_refresh_token`, `cadet_oauth_consent`, `cadet_oauth_client` (rows
  owned by those logins), `cadet_session`, `cadet_account` and `cadet_user`
  before `admission`. No S3 objects are involved.
- `demo-purge.integration.test.ts` issues a password, signs in, purges, and
  asserts no cadet rows remain and the old session and grant no longer
  authenticate.

## Front end (`apps/cadet`)

Mirrors management: Next.js 16, oRPC + TanStack Query, TanStack Form,
`@campuspilot/ui`, `@campuspilot/components` (theme provider).

| File | Role |
| --- | --- |
| `app/layout.tsx` | `QueryProvider` + `ThemeProvider`; title "Cadet Portal". |
| `app/(portal)/layout.tsx` → `components/app-frame.tsx` (`AppFrame`) | Session check (`authClient.useSession`, `redirect('/sign-in')`), top bar from `getProfile.current`, bottom nav; phone-sized frame from `md` up. |
| `app/(portal)/page.tsx`, `fees/`, `fees/[billId]/`, `results/`, `results/[examId]/`, `results/class/[recordId]/`, `growth/`, `growth/class/[recordId]/`, `more/`, `notices/`, `notices/[noticeId]/` | Screens in `components/{home,fees,results,growth,more,notices}`; shared headers and loading/error/empty states in `components/screen.tsx`. More holds Sign out (cadet session only; clears the query cache). |
| `app/sign-in/page.tsx` → `components/sign-in-form.tsx` (+ `school-combobox.tsx`) | `useForm` with a Zod `onSubmit` validator and per-field errors; school picker and `?school=` prefill as in Sign-in; the request is a `useMutation`, so a rejected sign-in does not disable Submit. Full navigation on success. |
| `app/oauth/consent/page.tsx` → `components/oauth-consent.tsx` | Cadet MCP consent. |
| `lib/orpc.ts` | `RPCLink` to `/api/cadet/rpc` with `credentials: 'include'`, typed `CadetRouterClient`. Never the staff `/rpc`. |
| `lib/auth-client.ts` | Better Auth clients at `CADET_AUTH_BASE_PATH`. |
| `components/cadet-school-chrome.tsx` | Signed-in pages only: links the school's Cadet manifest (`/blob/school/{id}/cadet.webmanifest`, per-school app id, scope = whole portal) and home-screen icon, and shows the phone install screen (shared `useInstallAppScreen`). Before sign-in the portal is not installable (the school is unknown). |
| `app/(portal)/notices`, `notices/[noticeId]` → `components/notices/` | The student's notices (`NoticesScreen`, infinite list) and one notice (`NoticeScreen`). A notice written as text is shown as text; a custom-template notice as its printed page (`getNoticeDocument`, asked for only then) in the shared empty-sandbox `DocumentPreview` (`fitPageWidth`), with its text shown while the page loads or cannot be loaded (the page is fixed at publication and can be megabytes, so it is downloaded once and not again on each return to the app); a list or notice already on screen stays when a refetch fails; both offer Download PDF (`getNoticeDownload`, a five-minute URL issued on the tap). Reached from Home's notices block (`HomeNotices`, shown only when the student has notices) and a row on More (`MoreNoticesRow`); the tab bar keeps five tabs. When the school's `notices` feature is off, the notice procedures answer the disabled-feature error: the block and the row do not appear and both routes show "Notices are not available" (`noticesSwitchedOff` in `notices-model.ts`), never an error. API-free pieces are in `packages/components/src/cadet-portal/cadet-notice.tsx`. |
| `app/(portal)/notifications` → `components/notifications/` | The inbox inside the portal frame; the top bar's bell links to it. `/notifications/open` resolves push clicks with the route builders in `cadet-notification-routes.ts`: a bill opens `/fees/{billId}`, a payment `/fees`, a result `/results/{examId}` built from the enrollment, class and exam named in the notification (`examResultHref` in `lib/route-param.ts`), a notice `/notices/{noticeId}` (`noticeHref`); anything else stays in the inbox. The device notification toggle is on the inbox and on More. |
| `public/sw.js` + `lib/web-push.client.ts` + `components/notifications/cadet-device-notifications.tsx` | Web push: the service worker (push → notification, click → `/notifications/open?type=…&<ids>` → route builders), registered only when the student taps **Turn on notifications** (permission requested inside the tap). One row per login and endpoint (`cadet_push_subscription`), so siblings on one phone each get their own; a login keeps its 10 most recently subscribed devices (older ones are revoked); sign-out turns this device off for that student, enforced on the server (see "Signing out stops the device, on the server"). A staff resend of a failed push goes to that same device only, never to a device that no longer receives notifications. iPhone/iPad: only inside the installed app. |

Env comes from `@campuspilot/env/cadet.client` (`NEXT_PUBLIC_SERVER_URL`). No
identity inputs: who the student is always comes from the `cpc_` session. Record
ids are path segments, not query parameters (`/results/class/{recordId}`,
`/growth/class/{recordId}`, `/results/{examId}`, `/fees/{billId}`, `/notices/{noticeId}`; build class
links with `classResultsHref`/`classGrowthHref` in `lib/route-param.ts`). They
are only looked up within the signed-in admission, and anything else is
NOT_FOUND. `/results` and `/growth` without a class show the server's current class. No `useEffect`;
follow the repository rules in `AGENTS.md` (TanStack Form for input, Query for
data, small components). Shared, API-free UI belongs in
`packages/components/src/cadet-portal`.

## Testing

| Suite | Covers |
| --- | --- |
| `packages/auth/src/__tests__/cadet-auth.integration.test.ts` | Password generator and word list; sign-in, uniform errors, lockout (with and without a login), live admission number, unregistered sign-in, disabled email paths, trusted origin, no admission number at auth level; full cadet OAuth flow in `cadet_*` tables only; no write scope. |
| `packages/auth/src/__tests__/cadet-sign-in-limits.integration.test.ts` | Redis limiter window and lock; per-IP limit counts failures only; admission and IP locks independent. |
| `packages/api/src/routers/cadet/cadet.router.integration.test.ts` | `getAdmission` equals management's DTO, survives unregister, rejects anonymous, accepts read grant; consent client is cadet-only; staff/cadet session isolation; router separation. |
| `packages/api/src/routers/school/admission/admission-cadet-password.integration.test.ts` | `generateCadetPassword` default, transaction and rollback, both permissions; issue/reset, revocation, revocation failure; unregister keeps access; delete revokes and cascades. |
| `packages/api/src/workflows/demo-school/demo-purge.integration.test.ts` | Purge removes cadet rows and access. |
| `packages/api/src/routers/school/feature-flags/feature-flags.router.integration.test.ts`, `packages/api/src/routers/system-admin/feature-flags/feature-flags.router.integration.test.ts` | Flag storage, `requireSchoolFeature`, the staff read and the admin procedures; Cadet Portal settings refused while `cadet` is off. The cadet suites above also cover the flag switched off (sign-in, sessions, MCP, password issuing, manifest). |
| `apps/server/src/cadet-http.integration.test.ts` | Well-known order, cadet issuer discovery, MCP challenge and token isolation, RPC cookie isolation, CORS scoping, sign-in through the server. |
| `packages/opa/src/__tests__/authorization.integration.test.ts`, `packages/opa/src/policies/school/permissions_test.rego` | The issue permission's grants. |
| `apps/cadet/lib/auth-client.test.ts`, `apps/cadet/components/{sign-in-form,oauth-consent}.test.tsx` | Signed-query helpers, sign-in form, consent redirect. |
| `packages/api/src/routers/cadet/cadet-notices.integration.test.ts`, `apps/cadet/components/notices/notices-screen.test.tsx`, `apps/cadet/components/{home/home-screen,more/more-screen}.test.tsx`, `packages/components/src/cadet-portal/cadet-notice.test.tsx` | Notice visibility and the `notices` feature; the list, text and printed-page reading, PDF download, not found and unavailable states; the Home block and More row appearing only for a school with notices. |
| `packages/components/src/cadet-portal/issued-cadet-password-dialog.test.tsx` | Shown-once dialog and copy. |
| `apps/management/components/admission-actions-model.test.ts` | Menu gating and confirmation copy. |

Integration suites start Postgres and Redis with Testcontainers (Docker must be
running). Run one package with `pnpm --filter @campuspilot/auth test`,
`pnpm --filter @campuspilot/api test`, `pnpm --filter server test`,
`pnpm --filter cadet test`, `pnpm --filter @campuspilot/components test`,
`pnpm --filter management test`; add a file path after `--` to run one file in a
Vitest package. The serial finance group in `packages/api/vitest.config.ts` does
not involve cadet files.

## Rules

### Do

- Reference admissions by `admission.id` and logins by `cadet_user.id` everywhere
  at the auth level; resolve the admission number live at sign-in only.
- Bind every cadet procedure's admission and school from `context.cadet`.
- Give every `cadetRouter` leaf MCP metadata; mark reads `access: 'read'`.
- Reuse management DTOs (`admissionDtoSchema`, `oauthConsentClientSchema`) for
  cadet outputs where the shape is the same.
- Revoke through `revokeCadetLoginAccess` (cadet instance + OAuth tables) whenever
  a password changes or a login is removed, after the write commits.
- Check `school.admission.cadet_password.issue` on every path that issues a
  password, in addition to any other action's permission.
- Keep `createAdmission`'s `generateCadetPassword` a plain boolean defaulting to
  `false`.
- Change a cadet OAuth table and its staff counterpart together, keeping
  `CadetOAuthTableShapeChecks` green.
- Cover every new school-owned cadet table in `purge_demo_school` (new migration),
  the purge workflow's revoke stages if it holds credentials, and the purge test.
- Register new cadet `/.well-known/*` routes before the staff wildcard.

### Don't

- Don't store, copy, hash, or key anything at the auth level by admission number
  (tables, constraints, email, session, Redis, token claims, rate-limit keys).
- Don't add `admissionId`, `schoolId` or other identity inputs to cadet
  procedures.
- Don't mount cadet procedures on `appRouter` or staff procedures on
  `cadetRouter`, and don't serve `cadetRouter` with a staff context.
- Don't let the cadet origin onto staff routes or into `CORS_ORIGIN` / staff
  `trustedOrigins`.
- Don't share cookies, cookie prefixes, Redis prefixes, issuers, JWKS or OAuth
  tables between the instances.
- Don't enable email/password, sign-up or the account endpoints on the cadet
  instance; a future student password change must set
  `passwordSource: 'student_set'` and revoke other sessions deliberately.
- Don't derive passwords from profile data, store plain passwords, or offer a way
  to view an issued password again.
- Don't delete cadet sessions only in the database: that leaves Redis copies
  valid until expiry.
- Don't infer portal access from `registered`, or revoke access on unregister.
- Don't seed cadet logins for demo schools.
- Don't add a Cadet surface (procedure outside `cadetProcedure`, route, blob,
  staff action) without the `cadet` feature check, and don't add a second,
  school-level "portal enabled" switch. The only ungated actions are the ones
  listed under the flag table, each of which only undoes something.
- Don't return rendered HTML or embedded images from a core MCP tool; give the
  content as text and keep the page in a hidden, app-only procedure (as
  `getNotice` / `getNoticeDocument` do).
- Don't accept API keys or grant `mcp:write` on the cadet MCP without a new
  decision, and don't expose `issueAdmissionCadetPassword` over staff MCP.

## Extending the portal

**Adding a cadet procedure**

1. Add it to `cadetRouter` on `cadetProcedure`, with no identity inputs; read the
   student's data with `context.cadet.admissionId` / `schoolId`.
2. Reuse the staff DTO and mapper when the shape matches; if a field must not
   reach students, add a deliberately narrower schema rather than editing the
   staff one.
3. Declare `.meta({ mcp: { exposure, access, destructive, module } })`; add an
   `MCP_MODULES` entry (`packages/api/src/mcp-metadata.ts`) for a new portal
   area. Writes are refused for OAuth callers until write access is decided.
4. Add integration tests next to `cadet.router.integration.test.ts`: own data
   only, another admission's data unreachable, anonymous and staff sessions
   refused, MCP grant behaviour. The cadet MCP catalog picks the procedure up from
   its metadata; check `cadet-http.integration.test.ts` still lists the tools you
   expect.

**Adding a screen**

1. Add the route under `apps/cadet/app/(portal)`; its layout wraps it in
   `AppFrame`, which does the session check. (`PortalShell` is only for the
   signed-out sign-in and consent pages.)
2. Load data with `orpc.<procedure>.queryOptions()`; use `useForm` + Zod for any
   input; no `useEffect`.
3. Put reusable, API-free pieces in `packages/components/src/cadet-portal`.
4. Check the screen at phone width, as for management screens.
5. If the area is a per-school feature, handle its disabled-feature error as a
   state (hide entry points, show a calm unavailable screen), as the notice
   screens do with `noticesSwitchedOff`.

**Adding a cadet table**: prefix `cadet_`, reference the login by
`cadet_user.id` (cascade) or the admission by `admission.id`, never the admission
number; extend `purge_demo_school` and the purge test; if Better Auth reads it,
add it to `cadetAuthSchema`.

## Known gaps and deferred decisions

- **Hidden, not built**: calendar, the Updates
  screen, push/WhatsApp settings, online payment (a disabled "coming soon"
  button), guardian/sibling switching and connected-AI-app settings.
- **No finance PDFs for cadets**: bill, receipt, adjustment and statement
  downloads are out of scope until the document system can serve them to cadets
  safely. The only document a student can download is a notice addressed to
  them (one cached file, identical for every reader; see [School notices](notices.md)).
- **Notices have no tab and no unread state** of their own: they are reached
  from Home, More and the notification inbox.
- **No bill due dates** exist in the data; none is shown.
- **Release is per exam**, not per class; release times come from the server
  clock (also in demos). Averages have known limits (collusion at exactly 5,
  differencing across withdraw/re-release), documented at
  `CADET_CLASS_AVERAGE_MIN_STUDENTS`.
- **"New result" is not tracked**: Home announces the latest released result
  for `NEW_RESULT_ALERT_DAYS` (14) days after its release, whether or not it was opened.

- **Guardian accounts**: one login per admission; a multi-child guardian login
  (likely a link table, phone OTP considered) is not designed.
- **Student password change**: account endpoints are disabled; later work must
  record `student_set`.
- **No staff "revoke portal access" action**: unregistering keeps access; only
  deleting the admission removes it. Staff can rotate the password to sign the
  student out.
- **No "has login" indicator** in management; the admission DTO does not carry it
  (declined for now).
- **Admission-number probing**: a nonexistent number never locks, a real one locks
  after 5 failures, so existence can be inferred. Accepted as low risk; revisit
  (possibly with an app check).
- **Staff MCP returns passwords** from `createAdmission`; to revisit.
- **Expired signed OAuth query** (10 min) requires restarting from the AI app.

## Operations

### Environment

| Variable | Where | Meaning |
| --- | --- | --- |
| `CADET_APP_URL` | `@campuspilot/env/server` (`packages/env/src/server/auth.env.ts`); the worker needs it too, because the purge workflow imports the cadet auth instance | Cadet app origin: cadet trusted origin, CORS on `/api/cadet/*` and `/cadet/mcp`, MCP login/consent pages. Its own value, never derived from `PUBLIC_APP_URL`. Local: `http://localhost:3004`; production: `https://cadet.campuspilot.in`. |
| `CADET_MCP_RESOURCE_URL` | server, worker | Canonical cadet MCP URL and token audience; no query, fragment or trailing slash. Local: `http://localhost:3000/cadet/mcp`; production: `https://api.campuspilot.in/cadet/mcp`. |
| `NEXT_PUBLIC_SERVER_URL` | cadet app (`packages/env/src/cadet.client.ts`) | API origin. Local: `http://localhost:3000`; production: `https://api.campuspilot.in`. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | cadet app (build time) | Web push public key, equal to the server's `VAPID_PUBLIC_KEY`. Unset: the portal does not offer notifications. |
| `WEB_PUSH_ENABLED`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | server, worker (`packages/env/src/server/web-push.env.ts`) | Web push kill switch (default off, off locally) and VAPID identity (`npx web-push generate-vapid-keys`; subject `mailto:`/`https:`), required when enabled. |

Example values are in `apps/server/.env.example` and `apps/cadet/.env.example`.
Cookie attributes (`COOKIE_DOMAIN`, `SAME_SITE_COOKIE`, `SECURE_COOKIES`) are
shared with staff; the portal and API must share a cookie domain in production.

### Local development

1. Apply migrations (including `0029`/`0030`) as usual.
2. Run `pnpm dev:server` and `pnpm dev:cadet` (port 3004), plus
   `pnpm dev:management` to issue passwords.
3. A school needs the `cadet` feature (admin app → the school → Feature
   Flags); existing and demo schools have it, a newly added school does not.
   In management, open an admission → overflow menu → **Issue portal password**
   (as principal or manager), or tick **Generate Cadet Portal password** when
   creating an admission. Copy the details from the shown-once dialog.
4. Sign in at `http://localhost:3004/sign-in` with the school slug, admission
   number and password. Issue again to rotate it and sign the student out.

Use a test or demo school only; never write issued passwords into the repository
or share real students' credentials.
