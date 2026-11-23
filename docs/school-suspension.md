# School suspension

A platform administrator can suspend a school that misuses the platform. A
suspended school is **read-only**: its staff and students still sign in and
see everything, and every change they ask for is refused. Nothing is deleted
or hidden, and lifting the suspension restores everything at once. This guide
is the canonical reference: read it before changing how a suspension is
stored, enforced or shown, and before adding a way to change school data that
does not go through an oRPC procedure.

Suspension is not a feature flag and not a tier. It is its own fact about a
school, and a suspended school keeps its tier and its features.

A school without an active plan (no standing tier and no active billing period) is
read-only in exactly the same way, through the same gate with its own reason;
see [School billing](school-billing.md). The two are separate facts: lifting a
suspension does not give a school a plan.

## The fact

`school.suspended_at` (null while the school is not suspended), with
`school.suspended_reason` (set exactly while it is suspended; a CHECK holds
that) and `school.suspended_by`. Migration `0073_subscription-tiers.sql`.

The reason is the administrator's own note. It is shown in the admin app
only; the school's staff and students are told to contact support (staff) or
their school (students) and never see it.

## Suspending and lifting

| Procedure | What it does |
| --- | --- |
| `systemAdmin.suspendSchool({ id, reason })` | Suspends the school. `reason` is required (1 to 1000 characters). Suspending an already suspended school replaces the reason and keeps the moment it was first suspended. |
| `systemAdmin.unsuspendSchool({ id })` | Lifts it and clears the reason. Does nothing to a school that is not suspended. |

Both need `system.school.update` (granted to `platform.admin` only) and are
hidden from MCP: taking a school's ability to work away is a human decision
made in the admin app. `systemAdmin.getSchool` and `listSchools` return
`suspendedAt` and `suspendedReason`; `listSchools` filters by `suspended`.

Admin app: the Suspension card on a school's Settings page
(`apps/admin/components/school-suspension-card.tsx`), and a "Suspended" badge
wherever a school is listed.

## What is refused

Every enforcement point asks through the school's write access,
`packages/api/src/school-access/school-access.service.ts`. One function,
`resolveSchoolWriteRefusal({ suspended, hasActivePlan })`, decides from the
two facts and answers `SCHOOL_SUSPENDED` or `SCHOOL_NO_PLAN`; **a suspension
wins** when both apply. Everything below holds for both reasons, each
refused with its own error.

| Surface | Behaviour while suspended |
| --- | --- |
| Staff procedures (the management app, API keys, connected AI apps over MCP, the in-app assistant's tool calls) | `requireAuth` (`packages/api/src/index.ts`) refuses every protected procedure that is not an explicit read (`mcp.access`; a procedure without metadata counts as a write) for the school named by the input's `schoolId`. It is on the builder, not on each procedure, so a new procedure is covered without anyone remembering. Reads are untouched. |
| Upload routes outside oRPC (admission photo and documents, question paper pages, the school logo) | Each write handler calls `assertSchoolWritableByCaller` after its permission check. Reads there keep working. |
| In-app assistant | `resolveAssistantAccess` answers `school_suspended` (or `no_plan`): the user still sees the assistant and their conversations (`canSee`), and cannot send, approve, attach, delete a conversation or remove an unsent attachment (`assertCanChange`), so no model money is spent; stopping a run and declining an approval still work, since they only stop spending. A turn that is running is refused at its next model request, like a reached limit. A question paper generation job in flight fails with `school_suspended` (or `no_plan`) before its next model request (retries included) and before it saves. |
| Cadet Portal procedures | `cadetProcedure` refuses every procedure that is not a read (turning notifications on for a device, marking notifications read). Sign-in and every read keep working. |
| Cadet actions on `cadetLoginProcedure` (turning a device's notifications off) | Not held, for the reason they are not held by the `cadet` feature: they only undo something on the student's own device, and sign-out uses them. |

A deliberate exception for a read: downloading a question paper version is a
read, and when the version has no stored file in the format asked for (its PDF
was removed, or it is the version's first Word download) the download makes the
file and stores it as an artifact, also for a suspended school or one without a
plan, like restoring a removed PDF (see [Question papers](question-papers.md#word-download)).
Nothing the school's people wrote changes; the stored file is derived from a
version that already exists.

Not affected: signing in and out, a person's own account (password, profile),
and anything a platform administrator does through the `systemAdmin`
procedures (decided from the procedure's explicit `platformAdministration`
metadata, which `platformAdminProcedure` sets on every one of them, never from
its path). Notifications already queued when the school is suspended still go
out; nothing new is created, because creating one is a change.

### Who is held

The staff gate holds the school's **members**. It runs before the procedure's
own permission check, so it must tell an outsider nothing: only a member gets
the suspended error, and anyone else falls through to the permission check,
which answers them exactly as for a school that is not suspended. It decides
from membership and the two facts alone.

A platform administrator works on a school through platform grants without
being a member and is therefore not held, so the platform can still correct a
suspended school's data. An administrator who is also a member (the principal
of a demo school they created) is held like every member and lifts the
suspension first. An administrator impersonating a staff member acts as that
member and is refused like them.

## The error

Every surface throws the same error for a suspended school:

```
ORPCError('FORBIDDEN', {
  message: 'This school is suspended. You can still view everything, but nothing can be changed. Contact CampusPilot support.',
  data: { reason: 'SCHOOL_SUSPENDED' },
})
```

A school without a plan gets the same error with `SCHOOL_NO_PLAN` and its
own message ([School billing](school-billing.md#a-school-without-a-plan-is-read-only)).
A permission denial is FORBIDDEN without that data, and a disabled feature
carries `SCHOOL_FEATURE_DISABLED`. Clients tell them apart with
`schoolWriteRefusalOf(error)`, `isSchoolSuspendedError(error)` or
`isSchoolNoPlanError(error)`
(`packages/api/src/school-access/school-access.contract.ts`, Zod only,
importable by the browser apps), never by the message. The upload routes
answer with the same status and message; their HTTP error body carries no
`data`, so only the message identifies it there.

## What the school sees

Screens are **not** changed for a suspended school: buttons stay, a change is
sent, and the server's refusal is shown where that screen shows a failed save.
One permanent warning explains why.

- **Management.** `school.listMySchools` carries `isSuspended` (and
  `hasActivePlan`) for each school. `ReadOnlySchoolBanner`
  (`apps/management/components/school-plan-banners.tsx`), mounted in the
  school shell next to the demo banner, registers an `AppShellAlert` warning
  with the message above (or the no-plan message), on every page of the
  school. It has no action and cannot be dismissed. The app's RPC link reads
  the school list again whenever any call fails with either refusal
  (`lib/orpc.ts`), so the warning appears in a tab that was open when the
  school was suspended.
- **Cadet Portal.** `cadet.getSchool` carries `isSuspended` (and
  `hasActivePlan`). `ReadOnlySchoolNotice` (`apps/cadet/components`) shows
  "Your school is suspended. You can still view everything, but nothing can
  be changed. Contact your school." at the top of every signed-in page (or
  the no-plan notice). A refused change re-reads the school.

## Extending

- A new staff procedure needs nothing, provided its input names the school
  `schoolId` and its `mcp.access` is honest.
  `school-suspension.integration.test.ts` walks the school router and fails
  if a procedure that is not a read has no `schoolId` input.
- A new way to change school data outside oRPC (an HTTP route, a webhook
  acting for staff) calls `assertSchoolWritableByCaller` after its permission
  check.
- A new Cadet procedure that changes data is covered by `cadetProcedure`.
  Put it on `cadetLoginProcedure` only if a student must still be able to do
  it in a suspended school, and say why.
- A PDF generation job (docs/document-system.md "Generation jobs") is refused
  at start like any write; one already accepted runs to its end if the school
  is suspended meanwhile (it only produces the PDF that was requested).
- A background job that changes a school's data on its own schedule is not
  held today (there is none that staff do not start). If one is added, decide
  explicitly whether it runs for a suspended school and for a school without
  a plan.
