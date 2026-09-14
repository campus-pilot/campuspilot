# CampusPilot authorization

This package contains CampusPilot's typed authorization contract, OPA client,
and Rego policies. Rego is the source of truth; generated TypeScript constants
keep API action names and resource shapes synchronized with it.

Authorization asks: **May this subject perform this action on this exact
resource?** The answer is deny-by-default. The model separates four concerns:

1. **Action definitions** give an action a stable `id`, TypeScript `key`, and
   target `resourceKind`.
2. **Role grants** connect a namespaced role to an action ID.
3. **Runtime assignments** state which namespaced roles this user actually has,
   where each assignment applies, and any metadata attached to it.
4. **Behavioral policies** validate resource scope and contextual restrictions.

## The declarations

An action is defined once in the domain's `catalog.rego`:

```rego
actions contains {
  "id": "school.member.invite",
  "key": "INVITE_MEMBER",
  "resourceKind": "school",
} if { true }
```

A grant refers only to that action ID, so it cannot repeat or disagree with the
action's key or resource kind:

```rego
grants contains {
  "role": "school.principal",
  "action": "school.member.invite",
} if { true }
```

Roles are namespaced. `platform.admin` belongs to the platform role vocabulary;
`school.principal`, `school.teacher`, and `school.exam_coordinator` belong to the
school role vocabulary. The namespace is not the runtime scope.

At runtime, scope is explicit:

```json
{
  "subject": {
    "userId": "user-17",
    "roleAssignments": [
      {
        "role": "school.teacher",
        "scope": { "kind": "school", "schoolId": "school-1" },
        "meta": { "classIds": ["class-a", "class-b"] }
      }
    ]
  },
  "action": "class.student.add",
  "resource": {
    "kind": "class",
    "schoolId": "school-1",
    "classId": "class-b"
  }
}
```

Human translation: user `user-17` is a teacher in `school-1`, is assigned to
classes `a` and `b`, and wants to add a student to class `b`. The role grant
makes the action possible; the class policy verifies the school scope and that
`meta.classIds` contains the requested class.

`meta: null`, `classIds: null`, an empty array, a different class, or a role
assignment scoped to another school all deny this request.

## Resource kinds are not business domains

`resourceKind` describes the containment boundary needed for authorization, not
the feature area. Finance and examinations can both use school resources while
retaining distinct action IDs such as `school.finance.invoice.approve` and
`school.examination.result.publish`.

| Resource kind | Required facts | Example |
| --- | --- | --- |
| `system` | `kind` | `system.school.list` |
| `school` | `kind`, `schoolId` | `school.member.invite` |
| `class` | `kind`, `schoolId`, `classId` | `class.student.add` |

Generated `AuthorizationResourceByAction` types prevent pairing an action with
the wrong resource shape in TypeScript.

## How checks flow

### Invite through a platform administrator

- The action definition says `school.member.invite` targets a school resource.
- `system/grants.rego` explicitly grants it to `platform.admin`.
- The API supplies `{ role: "platform.admin", scope: { kind: "platform" } }`.
- The system policy accepts platform-scoped assignments for explicitly granted
  system or school actions. It still rejects class actions.

Platform administrators are therefore not implicit superusers.

### Invite through a principal

- `school/grants.rego` grants the action to `school.principal`.
- The API loads every role row for the authenticated user and requested school.
- It supplies a runtime assignment whose scope contains that `schoolId`.
- The school policy requires the assignment's `scope.schoolId` to exactly equal
  the requested resource's `schoolId`.

A principal in school A cannot invite a member into school B.

### Add a student through a teacher

- The class action definition targets a class resource.
- `class/grants.rego` grants it to `school.teacher`.
- The class policy requires the teacher assignment to match the requested
  school and requires the requested class ID in `meta.classIds`.

A teacher may hold multiple classes, multiple roles in one school, or no
classes. All role assignments are preserved; any one assignment may satisfy a
policy, while an unrelated role does not cancel it. A teacher with no
provisioned classes is denied class-scoped actions.

Authorization does not prove that a class exists or belongs to a school. The
future handler must validate those domain facts independently.

## Generation flow

Every catalog and grants file uses the shared package
`campuspilot.authorization.catalog`. OPA merges its incremental `actions` and
`grants` sets. The root catalog exposes a `generation_manifest`, and the
generator evaluates:

```text
data.campuspilot.authorization.catalog.generation_manifest
```

The generator validates unique action IDs and keys, resource kinds, namespaced
roles, and that every grant references a declared action. It then emits
deterministic files in `src/generated`:

```ts
export const SCHOOL_ACTIONS = {
  INVITE_MEMBER: 'school.member.invite',
} as const;
```

Never edit generated files directly.

## Public imports

```ts
import { SYSTEM_ACTIONS } from '@campuspilot/opa/policies/system';
import { SCHOOL_ACTIONS } from '@campuspilot/opa/policies/school';
import { CLASS_ACTIONS } from '@campuspilot/opa/policies/class';
import type { ClassResource } from '@campuspilot/opa/resource';
import { isAuthorized } from '@campuspilot/opa/authorization';
import { OpaClient } from '@campuspilot/opa/client';
```

The export map is:

```json
{
  "exports": {
    "./policies/*": "./src/generated/*.ts",
    "./resource": "./src/generated/resource.ts",
    "./authorization": "./src/authorization.ts",
    "./client": "./src/client.ts"
  }
}
```

## Applying a permission in the API

```ts
protectedProcedure
  .input(inviteSchoolMemberInputSchema)
  .use(requireSchoolPermission(SCHOOL_ACTIONS.INVITE_MEMBER))
  .handler(/* ... */);
```

The scoped middleware reads IDs from validated input, assembles runtime role
assignments, and sends the typed request to OPA. Use
`requireSystemPermission`, `requireSchoolPermission`, or
`requireClassPermission` according to the action's generated resource kind.

## Adding an action

1. Define the action once in the appropriate `catalog.rego` with `id`, `key`,
   and `resourceKind`.
2. Add role-to-action references in the appropriate `grants.rego` files.
3. Add or extend behavioral conditions in `permissions.rego`.
4. Add allow and important denial cases in the adjacent Rego tests.
5. Run `pnpm --filter @campuspilot/opa generate:actions`.
6. Use the generated constant in typed API middleware.
7. Run the package checks and workspace type-check.

## Layout and commands

```text
src/policies/<kind>/catalog.rego      action definitions
src/policies/<kind>/grants.rego       namespaced role grants
src/policies/<kind>/permissions.rego  scope and contextual behavior
src/policies/<kind>/*_test.rego       policy tests
src/generated/                        generated TypeScript contract
src/authorization.ts                  runtime types and decision helper
src/client.ts                         OPA HTTP client
scripts/generate-actions.mjs          Rego-to-TypeScript generator
```

```sh
pnpm --filter @campuspilot/opa generate:actions
pnpm --filter @campuspilot/opa check:actions
pnpm --filter @campuspilot/opa check:policies
pnpm --filter @campuspilot/opa test:policies
pnpm --filter @campuspilot/opa check-types
pnpm --filter @campuspilot/opa check
pnpm check-types
```

The OPA service is available through `docker/dev/compose.yml` and normally uses
the configured `OPA_URL` at `http://localhost:8181`.
