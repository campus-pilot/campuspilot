# OPA authorization rules

These instructions apply to `packages/opa` and to API code that consumes its
actions and policies.

## Authorization model

- Model every decision as three independent facts: `subject`, `action`, and
  `resource`. Never infer one fact from another because they currently happen
  to correlate.
- Authorization is deny-by-default. Missing actions, malformed inputs, missing
  role metadata, OPA errors, and undefined OPA results must never grant access.
- System roles are not superusers. Grant every system-role action explicitly in
  `src/policies/system/permissions.rego`; never add a wildcard or blanket admin
  bypass.
- Preserve every school role assignment as `{ role, meta }`. A user may hold
  any combination of roles in the same school, and one matching assignment is
  sufficient only when that policy explicitly says so.
- Query school role assignments by both `userId` and `schoolId`. A role in one
  school must never authorize a resource in another school.
- Class authorization must require a matching class-scoped assignment. For the
  teacher policy, `meta.classIds` must be an array containing the requested
  `resource.classId`. A null `meta`, null `classIds`, or empty `classIds` denies
  class-scoped teacher access.
- Authorization does not prove that a resource exists. Handlers must validate
  class, school, or other resource existence independently when needed.

## Defining actions

- Define action constants only in `src/actions/<level>.ts`. Do not place raw
  action strings in API routers, middleware, or application code.
- Name actions as `<level>.<resource>[.<subresource>].<verb>`, using stable domain
  language such as `school.member.invite` or `class.student.add`.
- Export a literal union from each action file and re-export new action groups
  from `src/actions/index.ts`.
- Register every new action in `AuthorizationResourceByAction` in
  `src/authorization.ts`. Select the exact `SystemResource`, `SchoolResource`,
  or `ClassResource`; do not derive scope from the action string.
- Keep `AuthorizationRequest` updated when introducing an entirely new resource
  level. The TypeScript contract must preserve the action/resource correlation.

## Writing policies

- Keep grants in the policy directory matching their resource level:
  `src/policies/system`, `src/policies/school`, or `src/policies/class`.
- Reuse validation rules from `src/policies/common.rego` instead of duplicating
  or weakening input validation.
- Add a new policy package to `src/policies/authorization.rego` when introducing
  a new authorization level. The root `decision` remains the sole API query
  target.
- Keep role-to-action grants explicit and reviewable. Do not use action-prefix
  matching or infer permission from similarly named actions.
- Class-level rules must compare requested IDs with scoped metadata explicitly.
  Do not treat the presence of the `teacher` role alone as class access.
- Add Rego tests beside the changed policy. Cover at least one allowed case and
  denials for the important boundary conditions, including wrong scope or
  missing metadata where applicable.

## Applying permissions in the API

- Use `protectedProcedure`, declare `.input(...)`, and then attach the matching
  middleware before `.handler(...)`:
  `requireSystemPermission`, `requireSchoolPermission`, or
  `requireClassPermission`.
- The input for school middleware must expose `schoolId`. The input for class
  middleware must expose both `schoolId` and `classId` as independent fields.
- Use action constants from `@campuspilot/opa/actions/*`; never duplicate an
  action as a string literal.
- Do not query OPA directly from routers. The API permission helpers assemble
  the authenticated subject and scoped role assignments consistently.
- For non-oRPC handlers, call `assertPermission` with a typed action/resource
  request instead of checking `session.user.role` directly.
- Do not add a reusable `systemAdminProcedure` or any direct
  `role === "admin"` authorization bypass. System access must pass through its
  explicit OPA action grant.
- OPA transport or response-validation failures must become an internal error;
  a valid negative decision must become forbidden.

## Required verification

- Run `pnpm check-types` after changing actions, resource mappings, or API
  middleware.
- Run the Rego suite with the repository's pinned OPA image:
  `docker run --rm -v "$PWD/packages/opa/src/policies:/policies:ro" openpolicyagent/opa:1.20.2 test /policies`.
- Keep an allow and deny test for every new action grant.
