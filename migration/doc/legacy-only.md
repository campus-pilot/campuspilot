# Legacy-only and deferred data migration contract

## Purpose

Every source record needs a disposition even when CampusPilot has no destination
yet. This document prevents unsupported data from being silently dropped or
forced into an unrelated target field. The permitted dispositions are:

- `imported`: represented faithfully in an implemented target domain;
- `archived`: retained in an access-controlled migration archive, not loaded;
- `deferred`: preserved and blocked on a named target feature/decision;
- `intentionally_omitted`: not retained beyond required audit evidence, with
  explicit approval and reason;
- `blocked`: no safe disposition has been approved.

An “unused” legacy feature is not automatically disposable. Production discovery
must still count its rows/objects and confirm whether it contains data.

## Notices and notice templates

Legacy `notice` stores:

- `id`, `schoolId`, and `sessionId`;
- `title` and Handlebars-capable `content`;
- `pageSize` (`half` or `full` at the API boundary);
- `createdBy` (a staff ID by convention, not foreign-key enforced);
- creation/update timestamps.

The legacy app also stores one active `notice_template` object per school with
page-size metadata. Notice PDFs are rendered on demand; current code does not
persist them even though `notice_pdf` appears in a stale artifact enum. The
renderer uses a latest-session lookup rather than necessarily the notice's stored
session, a defect that must not become migration logic.

CampusPilot currently shows Notices and Notice template placeholders but exports
no notice table, API, `DocumentType`, renderer, or artifact source contract. By
explicit product decision, omit notice rows, notice-template artifact rows and
objects, and any discovered notice PDFs. Discovery records count-only
`intentionally_omitted` dispositions grouped by school/session/type; it does not
download, archive, transform, or import their content. Do not map notice data to
report cards or generic document artifacts.

## Detailed onboarding progress

Legacy `school_onboarding` contains explicit step booleans, `currentStep`, and
unstructured `attributes`. Completed onboarding normally deletes this row and
sets `school.hasCompletedOnboarding=true`, so absence of a row can mean either
completed or never/partially created depending on the school state.

CampusPilot onboarding is not part of the current migration. Do not copy
`school.hasCompletedOnboarding`, surviving `school_onboarding` rows, step flags,
`currentStep`, or attributes. Leave target onboarding/setup fields at their
target defaults and emit only count-only `intentionally_omitted` dispositions.
Do not derive target readiness, admission settings, finance readiness, or
template selections from these flags; verify those domains directly.

## School default session configuration

Legacy `school.defaultSessionConfig` is a template used by the UI when creating a
session. The server does not prove that it was copied into any existing session.
CampusPilot has no school-level default-session column.

Archive the exact JSON and report whether it differs from every session's stored
configuration. Do not apply it to all sessions, create a new session, or replace
missing session fields. Product may later add an explicit target default or
approve intentional omission after reviewing the archive.

## Feature flags

Legacy `school.features` is an unstructured map. CampusPilot has no equivalent
school feature map. Inventory every distinct key and true/false/null/invalid
value with school counts.

The known `template:ai` flag and the legacy feature map are intentionally
omitted and must not be imported into another field. The target template helper
is provider-neutral and sends no request to an AI service. Record key/value
counts only; if discovery finds a feature that appears to control durable data
outside AI/templates, stop and ask the user before omitting that feature.

## AI usage and quota

Legacy `ai_usage` records school, usage type, year, month, and count. Legacy
`ai_quota` records an explicit monthly limit per school and usage type. Current
observed usage is `template:ai`; CampusPilot has no target tables or integrated AI
provider.

Do not load or archive these rows. Emit count-only `intentionally_omitted`
dispositions by school, usage type, year, and month. A non-AI usage type or data
that appears tied to an unsettled invoice is unexpected and must be shown to the
user before omission.

Quota is explicit configuration and usage is an operational counter; do not
replace one with the other.

## Student portal identity and access

The legacy portal authorizes a Better Auth session marked `isStudent` and finds
admissions by exact email. That flag is session-local, not a durable user role or
foreign key. One email may expose multiple admissions and schools. CampusPilot
has no durable student/guardian identity link or equivalent portal.

Migrate admission email only as contact data. Production is expected to contain
no student portal users. Record separate counts for admission-email-linked
non-staff users, their accounts, and `session.isStudent`. Any nonzero count is a
blocking disposition until the tracked typed policy is changed; never copy session
tokens or grant school membership. A user who also has an approved staff row
follows the staff provisioning contract.

## Ephemeral and secret authentication state

The following are intentionally omitted from ordinary rehearsal/cutover imports:

- Better Auth `session` rows and cookies;
- `verification` rows;
- OAuth access, refresh, and ID tokens;
- API-key secret material and current rate-limit counters.

The source manifest records counts and non-secret status summaries only. Users
reauthenticate; API keys are reissued. If continuity becomes a requirement, it
needs a separate security-reviewed migration and explicit authorization before
any production secret is copied to a local environment.

Staff user/account provisioning is covered by
[identity-access.md](identity-access.md). Session continuity is not migrated;
the approved Prem Chandra rehearsal retains only compatible staff password
credentials under decision S-25. Provider tokens and all other authentication
state remain excluded.

## Historical template versions

Legacy template saves overwrite stable S3 keys and update the same artifact row.
The database cannot reconstruct prior revisions. Query source object versioning
and backups during discovery:

- if version history exists, inventory versions with checksums and decide which
  are legally/operationally required;
- if it does not exist, record historical revisions as unavailable rather than
  fabricating them from generated PDFs or the current marketplace source.

Only the active bytes referenced at the frozen cutoff are required for the main
template migration unless a separate history decision says otherwise.

## Admission photos

Student/admission photos are intentionally omitted under S-03/A-12. The
inventory records each non-null key as metadata-only evidence and does not
download it. The migration leaves target photo keys null and never copies or
deletes the source objects.

This exclusion does not include school logos, user/provider `image` metadata, or
document/template objects; each has its own policy.

## Unknown tables, columns, JSON keys, and objects

The checked-out legacy schema may differ from production. The extractor compares
the restored snapshot tables, columns, types, defaults, constraints, indexes,
enums, and any public views, materialized views, foreign tables, or sequences,
plus Drizzle history, with the tracked
`packages/legacy-migration/legacy-schema-contract.json` generated from legacy
Drizzle snapshot `0008_black_bishop`.
Any extra table, column, enum value, JSON variant, artifact type, or object prefix
is blocking until added to a domain contract and assigned a disposition.

Do not assume an empty application screen means an empty table. Do not discard
unknown JSON through schema parsing before recording its original bytes and path.

The checked-out legacy schema contains no separate persistence model for daily
attendance outside examination results, guardians as independent people,
homework/assignments, library, transport, inventory, payroll, messaging, or a
non-examination timetable. This is an inventory finding, not permission to
ignore an unexpected production table. Production discovery must block and add
a contract if any such data exists.

## Required exception and archive reports

- notice, notice-template, and discovered notice-PDF counts;
- schools with surviving onboarding rows and their state combinations;
- non-empty/default-session configuration variants;
- every feature key/value and affected school, count-only;
- AI quota/usage totals by usage type and month;
- student-portal email/admission ambiguity summary;
- sensitive auth-state counts, with no tokens or hashes;
- recoverable/unrecoverable versions of in-scope non-notice templates;
- non-null admission photo count;
- any source schema/object family absent from the documented inventory.

## Acceptance checks

- Source totals equal imported + archived + deferred + intentionally omitted +
  blocked for every table and object family.
- No deferred row appears in an unrelated target table.
- Any retained archive for in-scope deferred data can be decrypted and sampled
  by an authorized operator, and its checksums match the frozen manifest.
- Local rehearsal data contains no production tokens, API keys, OAuth secrets,
  verification values, or admission photos.
- Notice/portal placeholder screens do not falsely imply that legacy records
  were imported.
- Every intentional omission has named approval and a retention/destruction date.

## Source references and anti-pattern guards

Use:

- `../school-app/db/schema.ts`
- `../school-app/packages/entity/onboarding/onboarding.schema.ts`
- `../school-app/packages/orpc/modules/notice`
- `../school-app/packages/orpc/modules/template/notice-templates.ts`
- `../school-app/packages/auth/auth.ts`
- current target schema exports in `packages/db/src/schema/index.ts`
- current notice/template placeholder routes in `apps/management`

Do not create placeholder target rows, encode archived data in arbitrary JSON
columns, treat onboarding completion as feature readiness, or copy production
secrets into the local rehearsal.
