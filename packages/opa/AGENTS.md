# OPA authorization rules

These rules apply to `packages/opa` and API code consuming its authorization
contract.

## Model

- Treat subject, action, resource, role namespace, runtime scope, and metadata
  as independent facts. Never infer one merely because it currently correlates
  with another.
- Authorization is deny-by-default. Missing or malformed facts, missing grants,
  OPA failures, and invalid responses must never grant access.
- Action definitions contain exactly the reusable action metadata: non-empty
  `id`, upper-snake-case `key`, and supported `resourceKind`.
- Role grants contain a namespaced `role` and an action ID. Never duplicate the
  action key or resource kind in a grant.
- Runtime assignments contain a namespaced role and explicit scope. School
  assignments also preserve their metadata. Do not collapse multiple roles.
- Use `platform.<role>` for platform roles and `school.<role>` for school roles.
  A namespace identifies a role vocabulary; it does not substitute for scope.
- Platform administrators are not wildcard superusers. Every grant is explicit.

## Action definitions and grants

- Place action definitions in the relevant `catalog.rego` and grants in
  `grants.rego`. Both use `package campuspilot.authorization.catalog` so OPA
  merges the incremental sets.
- Name action IDs `<resourceKind>.<resource>[.<subresource>].<verb>`, such as
  `school.member.invite` or `class.student.add`.
- Supported resource kinds are `system`, `school`, and `class`. Adding another
  requires an explicit generator resource shape, API middleware, aggregator
  route, behavioral policy, and tests.
- Every grant must reference a declared action. Several roles may reference the
  same action definition.
- Never edit `src/generated/*.ts`. Run `pnpm generate:actions` after Rego catalog
  or grant changes and commit resulting artifacts.

## Behavioral policies

- Keep contextual logic in the directory matching the resource kind and reuse
  validation from `common.rego`.
- Verify `catalog.action_targets_resource(input.action, input.resource.kind)`.
- Use `catalog.role_has_action(assignment.role, input.action)` for grants. Do
  not introduce another permissions map or copy grants into behavioral rules.
- School policies must require a school-scoped assignment whose `schoolId`
  exactly matches the requested resource.
- Class policies must separately require the matching school scope and relevant
  class metadata. For teachers, `meta.classIds` must be an array containing the
  requested `classId`; null or empty values deny access.
- Authorization does not establish resource existence or parentage. Handlers
  validate those domain facts independently.
- Add allow tests and denial tests for scope, metadata, wrong resource kinds,
  and unknown actions as applicable.

## API usage

- Import actions from `@campuspilot/opa/policies/<kind>` and never use raw action
  strings at call sites.
- Attach the matching middleware after `.input(...)` and before `.handler(...)`.
  School input exposes `schoolId`; class input exposes independent `schoolId`
  and `classId` fields.
- The API authorization helper is the only place that converts database/session
  roles into namespaced, explicitly scoped runtime assignments.
- Query school assignments by both authenticated `userId` and requested
  `schoolId`, preserve every returned row, and let OPA make the decision.
- Do not add direct role checks, reusable admin bypasses, or router-level OPA
  calls. Non-oRPC handlers use typed `assertPermission`.
- Convert OPA transport/validation failures to internal errors and negative
  decisions to forbidden.

## Verification

- `pnpm generate:actions` regenerates the TypeScript contract from the evaluated
  Rego `generation_manifest`.
- `pnpm check:actions` detects drift and invalid catalogs/grants.
- `pnpm check:policies` performs strict compilation.
- `pnpm test:policies` runs Rego tests.
- `pnpm check` runs all package checks.
- Run workspace `pnpm check-types` after changing consumers.
