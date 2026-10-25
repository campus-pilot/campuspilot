# Academic sessions, classrooms, and configuration migration contract

## Scope

This contract covers the structural and configuration fields on legacy
`school`, `school_session`, `class`, and `section`. Finance fields are governed
by [finance.md](finance.md); examinations that consume session/class config are
governed by [examinations-results.md](examinations-results.md).

## Field mapping

### School-level fields

| Legacy field | Target | Handling |
| --- | --- | --- |
| `school.activeSessionId` | `school_session.isActive` | map the referenced session only after tenant/session validation |
| `school.defaultSessionConfig` | no target field | archive and resolve by decision; do not apply it to sessions automatically |
| `school.financeSchema` | session finance configuration | see finance contract; never copy blindly to every session |
| `school.features` | no target field | see legacy-only contract |

`activeSessionId` is an explicit legacy value, but it is not trusted without
checking that the row exists and belongs to the same school. If it is missing,
orphaned, or points across schools, no target session is activated until an
operator chooses one. Dates and “latest session” do not substitute for that
decision.

### Sessions

| Legacy `school_session` | Target `school_session` | Handling |
| --- | --- | --- |
| `id` | identical `id` | preserve the source ID exactly and record an identity mapping |
| `slug` | no column | retain in migration provenance; do not use as target identity |
| `schoolId` | mapped `schoolId` | independently validate tenant ownership |
| start/end years | same | preserve after validating `end > start` and target uniqueness |
| `sessionConfig` | same JSON domain | parse with the target schema |
| `financeConfig` | target finance config | transform through finance contract |
| no field | `financeClassOverrides` | constructed from approved legacy class mappings |
| source active pointer | `isActive` | exactly one approved target row or none |
| timestamps | timestamps | interpret timestamp-without-time-zone values as `Asia/Kolkata` |

CampusPilot has no session slug and enforces unique `(schoolId,
sessionStartYear, sessionEndYear)`. Two source sessions with the same school and
years cannot be loaded as separate target sessions. They require an explicit
merge, correction, or block; never keep the newest one automatically.

The session JSON shape is intentionally explicit:

```text
examConfig[examSlug] = { name, order }
coScholasticAreas[areaSlug] = { name }
gradingScale[gradeKey] = { label, minScore }
attendanceTracking = { enabled }
```

Parse the original JSON without filling product facts from other data. Schema
defaults may make an absent property operationally valid, but the manifest must
still distinguish `source-absent` from `source-explicit-default`.

Audit exam-definition order uniqueness, blank/invalid slugs, duplicate names,
grade threshold ordering, values outside the target integer constraints, and
unknown keys. Unknown keys are preserved in the extract and require a disposition
rather than being dropped by Zod parsing unnoticed.

### Classes and sections

Most source fields are structurally compatible, but CampusPilot adds mandatory,
unique display order:

| Legacy | Target | Handling |
| --- | --- | --- |
| class ID/slug/label/school | class equivalents | map IDs and validate tenant |
| class `attributes` | class `attributes` | preserve the target `{[key]: unknown}` JSON map and report non-object values |
| class `config` | class `config` | validate and transform as below |
| class `financeConfig` | session `financeClassOverrides` | finance contract and explicit session applicability |
| no class order | `class.displayOrder` | operator-approved deterministic ordering |
| section ID/slug/label/class/school | section equivalents | validate both class and school ownership |
| section `attributes` | section `attributes` | preserve the target JSON map as above |
| no section order | `section.displayOrder` | operator-approved deterministic order within each class |

The source database does not record display order. Alphabetical slug/label,
source creation time, primary key, and current UI order are only candidate
ordering proposals, not facts. The dry run must show the chosen order per school
and class. The approved mapping stores explicit positive integers and remains
stable across reruns.

Target class/section slugs must satisfy the current public DTO rules and unique
constraints. Report exact, case-folded, and normalized collisions. Do not mutate
slugs automatically because slugs are referenced by subjects, finance override
keys, templates, and user-visible URLs.

## Class subject configuration

The legacy and target both model:

```text
subjects[subjectSlug] = {
  name,
  books: [{ title, publication?, author? }],
  examModes[modeSlug] = { name, percentage }
}
```

CampusPilot additionally validates that non-empty exam mode percentages total
100 (within 0.001). For every class:

1. retain the original JSON and checksum in the source manifest;
2. validate keys, names, books, percentages, and unknown fields;
3. report subjects whose mode percentages do not total 100;
4. map slugs exactly unless an approved slug map says otherwise;
5. prove every imported examination plan/result/timetable reference resolves to
   the final class, subject, and mode slugs.

Do not “fix” percentages by normalization. A 30/30 pair may indicate a missing
mode, not a request to scale both to 50. Invalid configuration is blocking for
the affected class until corrected by an approved mapping.

## Tenant and relationship audit

The importer must enforce relationships more strictly than the individual
foreign keys:

- a session's school equals its mapped school;
- a class belongs to the mapped school;
- a section's `schoolId` equals its parent class's school;
- every class referenced by an admission, student, teacher, exam, timetable, or
  finance configuration belongs to the same school;
- every section referenced by a student or legacy teacher belongs to the mapped
  class and school;
- every session-dependent record points to a session in the same school.

Any cross-school relationship is a blocking data-integrity exception, not a
candidate for name-based repair.

## Import order and idempotency

1. Insert or map the school.
2. Insert all sessions inactive.
3. Insert classes with final slugs and approved display orders.
4. Insert sections with approved per-class display orders.
5. Import downstream admissions, students, teacher scopes, exams, and finance.
6. Activate the explicitly mapped session only after all required session data
   is valid.

Use source-to-target identity maps for all relationships; imported entity IDs
remain byte-for-byte equal to their source primary keys. The target class slug is
final before finance class overrides are written because those overrides are
keyed by slug rather than ID.

On rerun, compare normalized source content with the target row recorded for
that source identity. Identical content is a no-op; different content is a drift
error unless a reviewed merge policy exists.

## Required exception reports

- active-session pointer missing, cross-tenant, or ambiguous;
- duplicate session year ranges;
- invalid or unknown session configuration keys;
- invalid exam, grade, co-scholastic, or attendance configuration;
- class/section slug and target natural-key collisions;
- proposed display-order assignments and collisions;
- section school/class mismatches;
- invalid class attributes or subject/book/mode data;
- exam modes whose percentages do not total 100;
- legacy class finance values with no explicit target-session applicability;
- non-empty `defaultSessionConfig` or feature flags without target disposition.

## Acceptance checks

- Session counts reconcile by school and year range.
- No school has more than one active session, and the active session equals the
  approved source mapping.
- Session and class JSON parse through the target Zod schemas.
- Class and section lists appear in the approved display order.
- Every downstream class/section/session reference resolves within the same
  school.
- Historical sessions remain readable without being made active.
- Finance data is absent from general session API responses and is visible only
  through its authorized routes.
- Two executions with the same mapping do not reorder classrooms or create rows.

## Source references and anti-pattern guards

Use:

- `../school-app/db/schema.ts`
- `../school-app/packages/entity/school/session-config.schema.ts`
- `../school-app/packages/entity/classroom/class-config.schema.ts`
- `packages/db/src/schema/session.ts`
- `packages/db/src/schema/class.ts`
- `packages/db/src/schema/jsonb/session-config.ts`
- `packages/db/src/schema/jsonb/class-config.ts`
- `packages/api/src/routers/school/session`
- `packages/api/src/routers/school/class`

Do not infer active state from dates, copy legacy class finance JSON back onto a
target class, use row order as display order, normalize invalid percentages, or
delete unknown JSON keys without an archived disposition.
