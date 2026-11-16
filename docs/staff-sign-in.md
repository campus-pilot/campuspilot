# Staff sign-in: phone number, email and issued passwords

How staff (management and admin app users) sign in, how phone-only accounts
work, and who may set passwords or change sign-in details. The Cadet Portal
has its own instance and rules ([Cadet Portal guide](cadet-portal.md)).

## Ways to sign in

One staff Better Auth instance (`packages/auth/src/server.ts`), one password
per account:

| Method | Endpoint | Notes |
| --- | --- | --- |
| Email + password | `/api/auth/sign-in/email` | |
| Phone number + password | `/api/auth/sign-in/phone-number` | Better Auth `phoneNumber` plugin. Looked up in E.164. |
| Google | `/api/auth/sign-in/social` | Links to the account with the same verified email. |

Phone and email sign-in verify the **same** credential account
(`account.provider_id = 'credential'`), so they always share the password.
The management sign-in form has one "Email or phone number" field;
`parseSignInIdentifier` (`packages/components/src/staff-account/sign-in-identifier.ts`)
treats input containing `@` as an email and anything else as a phone number,
read as Indian when it has no `+` country code (the shared
`@campuspilot/db/phone` default), and converts it to E.164 before calling.

CampusPilot sends no SMS. The plugin's code endpoints (`/phone-number/send-otp`,
`/verify`, `/request-password-reset`, `/reset-password`) are in `disabledPaths`
(`STAFF_DISABLED_PHONE_PATHS`), and `/update-user` changes to the number,
including removing it, are refused (`changesOwnPhoneNumber`; the plugin alone
lets `null` through). Forgotten passwords are reset by staff (below).

## Data model (`user`, migration 0070)

| Column | Meaning |
| --- | --- |
| `phone_number` | Sign-in number in E.164, unique, nullable. |
| `phone_number_verified` | Required by the plugin (it drops unverified numbers on create). Written `true` whenever staff enter a number: their entry is the attestation, as a school invitation verifies an email. |
| `email_is_placeholder` | `true` when `email` is a generated `<uuid>@phone.campuspilot.invalid` placeholder. Better Auth needs a unique email on every user. |

Rules:

- Placeholder status is its own fact. Never infer it from the domain; read it
  through `staffIdentityColumns` / `toStaffIdentity`
  (`packages/api/src/users/staff-identity.ts`), which return `email: null` for
  placeholders. Every staff-facing DTO (`SchoolMemberDto`, `PlatformUserDto`,
  issued-password results) exposes `email: string | null` and
  `phoneNumber: string | null`.
- The check `user_placeholder_email_has_phone` guarantees an account with a
  placeholder email always has a phone number, so it can always sign in.
- `staffIdentitySearch` matches name, real email or phone number (spaces,
  dashes and brackets in the query are ignored for phones). Placeholder
  emails never match.
- UIs show an identity with `staffSignInLabel` (email, else the formatted
  number) and the session user's with `sessionUserSignInIdentity`.

## Adding staff by phone number

`school.inviteMember` takes exactly one of `email` or `phoneNumber` (a flat
object, because MCP tools need one; both or neither is a validation error).

- Email: unchanged. A new account gets the address as verified and no
  password; the person uses Google or adds a password in account settings.
- Phone: needs `school.member.password.issue` **in addition to**
  `school.member.invite`, checked before any write, and a signed-in person
  (`authMethod: 'session'`): AI apps, API keys and the assistant are refused,
  because the result carries the password. A new account is created
  with a placeholder email, the number and a generated password
  (`generateStaffPassword`, the `word-word-NN` format), returned once as
  `issuedPassword`. If someone already has that number they are just added to
  the school and `issuedPassword` is null.

Both invite dialogs (management and admin) use `InviteIdentifierTabs`;
management offers the Phone tab only behind `RequirePermissions` for the
password permission. The password is shown once in
`IssuedStaffPasswordDialog`.

## Setting passwords

Every path writes with `setStaffPassword` inside the caller's transaction
(creating the credential account if missing), then **after commit** calls
`revokeStaffAccess`, which deletes every session (Redis included) and every
AI-app connection (OAuth access/refresh tokens and consents). API keys are
kept. Nobody can view a password later; only set a new one.

| Path | Who | Limits |
| --- | --- | --- |
| `school.issueMemberPassword` | `school.member.password.issue`: principals (and platform admins) | Refuses your own account, platform administrators (`role = 'admin'`), and anyone who is a member of another school: a school may only take over accounts wholly its own. Generated password only. MCP hidden. |
| `systemAdmin.setUserPassword` | `system.user.password.set`: platform admins | Any account except your own. Typed (8+ characters) or generated. MCP hidden. |
| Account settings → Password (management) | The person | `changePassword` with `revokeOtherSessions`, or `auth.setPassword` when there is no password yet. |

Managers deliberately lack `school.member.password.issue`: they could
otherwise take over the principal's account. For the same reason, appointing
a principal (inviting with the `principal` role, or adding it in
`updateMemberRoles`) also needs `school.member.password.issue`, so a manager
cannot promote themselves first (`grantsPrincipalRole`).

## Changing sign-in details (admin app)

Admin → **Users** (`/users`, `apps/admin/components/users`) lists every
account (`systemAdmin.listUsers`) with email, phone, whether a password or
Google is set up, and schools. `systemAdmin.updateUserSignIn` replaces both
identifiers at once:

- A new email clears `email_is_placeholder` and is stored verified, so
  Continue with Google for that address links to the account. A real email
  can be changed but never removed.
- The phone number can be set, changed, or removed while a real email
  remains.
- Either identifier already used by another account is a conflict.

Changing or removing an identifier does not unlink an existing Google
account or sign anyone out.

## Checklist when extending

- Selecting `user.email` for display? Select `staffIdentityColumns` and map
  with `toStaffIdentity` instead.
- Building a session user by hand (`context.ts`, demo `job-context.ts`)?
  Include `emailIsPlaceholder`, `phoneNumber`, `phoneNumberVerified`.
- New way to set a password? Use `setStaffPassword` in the transaction and
  `revokeStaffAccess` after commit, behind its own permission, MCP hidden.
- If an email transport is added, skip placeholder emails as well as demo
  users.
