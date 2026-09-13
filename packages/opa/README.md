# CampusPilot authorization

This package contains CampusPilot's typed authorization contract, OPA client,
and Rego policies. The API supplies facts; OPA decides whether those facts grant
a specific action.

Authorization asks one question:

> May this subject perform this action on this exact resource?

The answer is deny-by-default. Nothing is allowed merely because a user is
authenticated, has a system role, or has some role in a school.

## How a decision is represented

Every request contains three independent parts:

```json
{
  "subject": {
    "userId": "user-17",
    "systemRole": "user",
    "roleAssignments": [
      {
        "role": "teacher",
        "meta": { "classIds": ["class-a", "class-b"] }
      }
    ]
  },
  "action": "class.student.add",
  "resource": {
    "level": "class",
    "schoolId": "school-1",
    "classId": "class-b"
  }
}
```

In human terms:

> User `user-17` wants to add a student to `class-b` in `school-1`. The user is
> a teacher in that school and is assigned to `class-a` and `class-b`.

OPA allows this request because the teacher's `classIds` contains the requested
class. Changing `classId` to `class-c` denies the same request.

## Resource levels

Actions and resources are grouped by the level where authorization happens.

| Level | Example action | Required resource facts | Typical source of permission |
| --- | --- | --- | --- |
| System | `system.school.list` | `level: "system"` | An explicitly granted system role |
| School | `school.member.invite` | `level: "school"`, `schoolId` | A role assignment in that school |
| Class | `class.student.add` | `level: "class"`, `schoolId`, `classId` | A role assignment whose metadata includes that class |

The TypeScript `AuthorizationResourceByAction` map explicitly connects each
action to its resource type. Adding an action without registering its resource
scope fails type-checking.

## Current policies in plain English

### System school management

The `admin` system role may perform only the actions listed in the system
policy: list, read, create, update, update-logo, and delete schools. It may also
invite a school member because that cross-level action is explicitly listed.

Being a system admin does not imply permission for every action. For example,
an admin with no matching teacher assignment is denied `class.student.add`.

```ts
protectedProcedure
  .input(listSchoolsInputSchema)
  .use(requireSystemPermission(systemActions.listSchools))
  .handler(/* ... */);
```

Human translation:

> The caller must be authenticated, and their system role must explicitly
> contain permission to list schools.

### Inviting a school member

A principal or manager assigned to the requested school may invite a member.
A system admin may also do so because `school.member.invite` is an explicit
system-role grant.

```ts
protectedProcedure
  .input(inviteSchoolMemberInputSchema)
  .use(requireSchoolPermission(schoolActions.inviteMember))
  .handler(/* ... */);
```

The middleware reads `schoolId` from the validated input and loads all role rows
for the authenticated user in that school. A principal role in `school-a` does
not grant invitation permission in `school-b`.

### Adding a student to a class

The class entity and route do not exist yet, but the contract and middleware are
ready for them:

```ts
const addStudentInputSchema = z.object({
  schoolId: z.string().min(1),
  classId: z.string().min(1),
  studentId: z.string().min(1),
});

protectedProcedure
  .input(addStudentInputSchema)
  .use(requireClassPermission(classActions.addStudent))
  .handler(/* verify the class and add the student */);
```

The teacher policy behaves as follows:

| Teacher assignment | Requested class | Result |
| --- | --- | --- |
| `classIds: ["a", "b"]` | `b` | Allow |
| `classIds: ["a", "b"]` | `c` | Deny |
| `classIds: []` | `a` | Deny |
| `classIds: null` | `a` | Deny |
| `meta: null` | `a` | Deny |

Authorization only answers whether the user may act on the supplied class ID.
The future handler must independently confirm that the class exists and belongs
to the supplied school.

## Multiple roles

A user can hold any combination of roles in the same school. The API preserves
every assignment instead of collapsing them into one role:

```json
{
  "roleAssignments": [
    { "role": "exam_coordinator", "meta": null },
    {
      "role": "teacher",
      "meta": { "classIds": ["class-a", "class-b"] }
    }
  ]
}
```

OPA evaluates each assignment. In this example, the exam-coordinator role does
not grant `class.student.add`, but the teacher assignment can grant it for
`class-a` or `class-b`. An unrelated role neither grants the action nor cancels
a valid matching assignment.

## Project layout

```text
src/
├── actions/
│   ├── system.ts
│   ├── school.ts
│   └── class.ts
├── policies/
│   ├── authorization.rego
│   ├── common.rego
│   ├── system/
│   ├── school/
│   └── class/
├── authorization.ts
└── client.ts
```

- `actions/` is the TypeScript action catalog used by API call sites.
- `authorization.ts` maps actions to resource types and validates OPA results.
- `policies/common.rego` validates shared input facts.
- Each policy subdirectory contains grants and tests for one resource level.
- `policies/authorization.rego` combines the scoped policies and exposes the
  canonical `campuspilot/authorization/decision` query.
- `client.ts` contains the HTTP client and rejects malformed decisions.

## Adding an action

For a new class action such as taking attendance:

1. Add `takeAttendance: "class.attendance.take"` to
   `src/actions/class.ts`.
2. Map it to `ClassResource` in `AuthorizationResourceByAction`.
3. Add the explicit role grant and any metadata conditions in
   `src/policies/class/permissions.rego`.
4. Add allow and deny cases in the adjacent Rego test file.
5. Attach `requireClassPermission(classActions.takeAttendance)` after the
   route's input schema.
6. Run the TypeScript and Rego checks.

Do not introduce a raw action string in a router or a catch-all role rule in
Rego. Those bypass the compile-time catalog and make grants difficult to audit.

## Running locally

The development Compose service mounts `src/policies` read-only at `/policies`
and exposes OPA at the configured `OPA_URL` (normally
`http://localhost:8181`).

Start the service from the repository root:

```sh
docker compose -f docker/dev/compose.yml up -d opa
```

Run all policy tests with the pinned OPA version:

```sh
docker run --rm \
  -v "$PWD/packages/opa/src/policies:/policies:ro" \
  openpolicyagent/opa:1.20.2 test /policies
```

Run the TypeScript contract checks:

```sh
pnpm --filter @campuspilot/opa check-types
pnpm --filter @campuspilot/api exec tsc --noEmit
```

