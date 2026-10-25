# Identity, access, schools, and staff migration contract

## Scope

This contract covers legacy `school`, `staff`, `user`, and `account` rows,
school logos, and their target representation in `school`, `user`,
`school_member`, and `school_user_role`. Authentication sessions, verifications,
API keys, and student-portal identity are addressed separately because they are
not durable school membership facts.

## Source-to-target differences

| Legacy fact | Target fact | Required handling |
| --- | --- | --- |
| `school.id`, slug, name, location, registration number | same fields on `school` | map explicitly; target slug is globally unique |
| `school.logoS3Key` | `school.logoS3Key` | verify and retain the exact existing key/checksum in the shared bucket |
| `staff.email` + one `staff.role` | `user` + `school_member` + one or more `school_user_role` rows | resolve email identity and map role |
| teacher `staff.attributes` `{classId: sectionId[]}` | teacher role `meta.classIds` | if any valid section is assigned, map the class ID and deliberately widen access to the whole class |
| legacy `admin` staff role | target school-scoped `principal` | explicit approved mapping; never map to the system-level Better Auth `admin` role |
| legacy `manager`, `teacher`, `accountant`, `exam_coordinator` | same-named target role | copy only after target user and membership resolve |
| legacy user `image` | omitted | tracked I-10 policy omits provider image; target `image` and `profileImageS3Key` stay null |
| no legacy `profileImageS3Key` | target `profileImageS3Key` | leave null |
| legacy `session.isStudent` | no durable equivalent | never use as proof of student identity |
| legacy user IDs | target user IDs | preserve exactly after collision and identity validation |
| legacy staff password credentials | target `account` with `issuer="local:credential"` | retain only for approved staff after hash compatibility, ownership, and collision checks pass |
| legacy OAuth provider accounts and tokens | fresh target provider link | do not copy; the user links or signs in with the provider again |
| legacy sessions, challenges, OAuth tokens, and API-key state | no target state | intentionally omit and require a fresh sign-in |

Legacy staff IDs are referenced as `generatedBy`/`recordedBy` in finance. The
target financial tables require a target actor ID string but do not make a staff
row the financial owner. Preserve the source staff ID in migration provenance and
map the target recorder according to the finance contract; do not put a legacy
`stf_*` identifier into a target user relationship.

## School identity and logo migration

School matching must use an approved school map. Neither name, slug, location,
registration number, nor a production URL alone proves that two rows are the
same tenant. For each mapping, report all field differences and which side wins.

Before inserting or merging a school, audit:

- source and target slug collisions, including case-folded comparisons;
- blank or duplicate registration numbers without assuming they are unique;
- target schools already containing sessions, members, admissions, artifacts,
  or finance facts;
- missing logo objects, content types, unsafe formats, and checksum failures;
- source timestamps whose timezone interpretation is not approved.

Verify the logo content, size, and checksum using the target image safety
expectations, then retain its exact object key. The source and target explicitly
share the same bucket for this migration. Never persist a presigned URL and
never copy, overwrite, re-key, or delete the object.

Do not copy `hasCompletedOnboarding` or the detailed `school_onboarding` row.
CampusPilot onboarding is not implemented for this migration, so target
onboarding fields remain at their target defaults; see
[legacy-only.md](legacy-only.md).

## User and account policy

Normalize emails only through a reviewed identity report. CampusPilot's invite
schema lowercases new emails, while the database uniqueness constraint is on the
stored value. The importer must report:

1. exact duplicate source user emails;
2. duplicates after lowercase and whitespace normalization;
3. one email shared by multiple legacy staff rows in the same school;
4. a staff email with no legacy user;
5. a user with multiple school staff rows;
6. a source identity colliding with a different target user;
7. provider accounts whose `(issuer, accountId)` would collide in the target;
8. credential accounts with missing or duplicate records.

The legacy lockfile resolves Better Auth 1.6.2 while CampusPilot currently uses
1.7.1 and has different account-linking, cookie, API-key, and session contracts.
Create or provision only the staff/school users required by approved staff rows
and preserve their legacy user IDs when collision-free. Always omit sessions,
verification challenges, OAuth tokens, and API-key state so everyone signs in
again.

For the approved Prem Chandra Public School rehearsal, I-05 is resolved in favor
of retaining compatible staff password credentials. The frozen source contains
exactly one staff credential account, and the importer must stop if a refreshed
snapshot contains zero or more than one. Its `accountId` equals its staff user
ID, its hash has the Better Auth Scrypt `salt:key` shape, and the installed legacy
and target `@better-auth/utils` password implementations have identical source
checksums and parameters (`N=16384`, `r=16`, `p=1`, `dkLen=64`). The target
verifier also parses the retained production hash successfully without exposing
it.

Copy an approved credential row only when all of the following hold:

1. the account belongs to a user provisioned from an approved staff row;
2. `providerId="credential"`, `accountId=userId`, and there is exactly one
   credential account for that user;
3. the hash matches the reviewed Scrypt format and is copied byte-for-byte;
4. target `(issuer, accountId)` and primary-key collision checks are clean;
5. the target writes `issuer="local:credential"` and leaves every token, token
   expiry, and scope field null.

Never log, decrypt, transform, or export a password hash for review. A retained
hash preserves the password but not the session: the user must perform a fresh
target sign-in. End-to-end acceptance requires the credential owner to try the
existing password; a hash-shape check and a failed random verifier probe do not
prove that the real password works. No operator needs to know or record it.

CampusPilot does not currently configure an email delivery callback for Better
Auth's forgotten-password/reset-password flow. Therefore, if the compatibility,
ownership, collision, or owner acceptance check fails, do not promise an emailed
password reset. The available self-service fallback is Google sign-in for the
same trusted email identity; otherwise stop for an explicitly designed account
recovery or administrator-assisted password setup procedure.

Preserve target system fields independently:

- target `user.role` is a system-level role, not a school role;
- `SYSTEM_ADMIN_EMAIL` determines system administration and must not be inferred
  from a legacy school `admin` row;
- new target users default to normal, not banned, unless an authoritative ban
  mapping exists;
- target `setupStatus` and onboarding fields remain at target defaults;
- `emailVerified` is preserved exactly under tracked I-07; it is never inferred
  from role, provider image, credential presence, or another correlated fact.

## School membership and role mapping

For each accepted staff row:

1. resolve exactly one target user;
2. create one `school_member` for the mapped school/user pair;
3. create the approved `school_user_role` row;
4. set `addedAt` from an authoritative source time, or use the migration time and
   record that the historical membership time was unavailable;
5. keep role `createdAt` separate from membership time when either fact is known.

The target model confirms two independent authorization levels. Better Auth
`user.role="admin"` is the platform/system administrator and is derived only
from `SYSTEM_ADMIN_EMAIL`. `principal` and `manager` are school roles stored in
`school_user_role`. Consequently, every legacy school `admin` becomes
`principal`; legacy `manager` remains `manager`. Neither mapping changes the
target user's system role.

The target permits multiple roles per member; the legacy source stores one row
with one role and has no uniqueness constraint documented for `(schoolId,
email)`. Multiple compatible legacy rows may become multiple role assignments
only after an operator confirms they represent the same person. They must not be
silently collapsed.

### Teacher scope

Legacy teacher attributes map class IDs to arrays of section IDs. CampusPilot's
teacher role stores only `{ classIds: string[] | null }`. A class key can be
mapped to a target class ID, but its section list cannot be faithfully stored.

Produce these categories:

- `all-sections`: the legacy list contains every mapped section in the class;
- `subset-sections`: only some sections are listed;
- `empty-sections`: a class key maps to an empty list;
- `unknown-class-or-section`: at least one identifier does not map;
- `invalid-shape`: attributes fail the legacy schema.

For `all-sections`, `subset-sections`, and a class key with at least one valid
assigned section, write the mapped class ID to `meta.classIds`. This is the
approved widening from section access to whole-class access. `empty-sections`
does not grant a class. `unknown-class-or-section` and `invalid-shape` remain
blocking and must be shown to the user because they do not prove a valid class
assignment.

## Authentication state that must not be copied by default

- `session`: tokens were issued under the legacy secret, cookie prefix, base URL,
  and session extension. Force reauthentication instead.
- `verification`: values are short-lived challenges tied to the source auth
  environment. Let them expire in the source.
- `apikey`: secrets and rate-limit state must be reissued under CampusPilot's
  current policy. Preserve only a redacted inventory when audit requires it.
- OAuth access, refresh, and ID tokens: never copy them between environments.

If product requires session or API-key continuity, stop and design it as a
separate security migration with Better Auth documentation and threat review.

## Student identities

The legacy portal treats `session.isStudent` plus admission email matching as
authorization. CampusPilot currently has no durable admission-to-user link and
no equivalent student session field. Admission emails may be migrated as contact
data, but they do not authorize portal access and must not create school staff
membership.

Production is expected to have no student portal users and CampusPilot has no
student portal. The frozen evidence separately counts admission-email-linked
non-staff users, their accounts, and `session.isStudent` rows. Any nonzero count
is blocking unless the tracked typed student-portal policy is changed and reviewed; the
current release does not authorize omission. This does not remove admission or
student academic records or their contact email fields. A person who also has
an approved school staff row is provisioned solely through that staff identity.

## Idempotency and merge behavior

Identity writes use the source system plus source primary key as provenance.
Natural keys are collision detectors, not idempotency keys. On a non-empty local
or production target, each collision needs one approved action:

- map to the existing target row;
- create a distinct target row with an approved value change;
- omit the source row with a reason;
- block the migration.

Never update an existing target user's password, provider links, system role,
ban state, profile image, or verification status merely because the email
matches. An idempotent rerun may accept an existing credential only when its
source ID, user ID, account ID, issuer, provider, and password hash all match.

## Required exception reports

- school identity and slug conflicts;
- missing or invalid school logos;
- email normalization and target identity collisions;
- staff rows without users and users without expected staff rows;
- duplicate school memberships or roles;
- unexpected legacy roles that cannot follow the approved role map;
- teacher scope rows with invalid or unknown class/section IDs;
- staff provisioning or user-ID collisions;
- unexpected student-session identities, because production is expected to have none;
- source actors referenced by finance/documents but not mapped to target users.

## Acceptance checks

- Every migrated school can be selected only by its authorized members.
- Principal, manager, teacher, accountant, and exam coordinator grants match the
  approved role map, including negative tests for unrelated schools.
- Teacher class restrictions work with mapped target class IDs, and every
  subset-section widening appears in the reviewed migration report.
- No legacy session token, verification value, OAuth token, or API key works in
  the target.
- The owner of the one retained Prem Chandra credential completes a fresh target
  sign-in using the existing password; no legacy session/token state was
  imported. Other staff use Google sign-in. Email password reset is not an
  available acceptance fallback in the current target configuration.
- Every retained credential has `issuer="local:credential"`,
  `providerId="credential"`, `accountId=userId`, a compatible hash, and null
  access/refresh/ID token, token-expiry, and scope columns.
- Every logo downloads through the target authorization route and its bytes
  match the copied-object manifest.
- Target system administrators are exactly those configured by target policy,
  not all legacy school administrators.

## Source references and anti-pattern guards

Use these definitions directly when implementing the importer:

- `../school-app/db/schema.ts`
- `../school-app/packages/auth/auth.ts`
- `../school-app/packages/rbac/teacherAttributesSchema.ts`
- `packages/db/src/schema/auth.ts`
- `packages/db/src/schema/school.ts`
- `packages/db/src/schema/school-member.ts`
- `packages/db/src/schema/school-user-role.ts`
- `packages/db/src/schema/jsonb/role.ts`
- `packages/api/src/routers/school/member/member.dto.ts`
- `packages/auth/src/server.ts`

Do not invent a role, place school roles in `user.role`, copy legacy `admin` as a
system administrator, widen an empty/invalid teacher assignment, or treat a
successful row insert as proof that fresh authentication works.
