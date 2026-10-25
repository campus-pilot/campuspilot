# Admissions and session enrollments migration contract

## Scope and model

Legacy and CampusPilot both separate a durable `admission` from the `student`
row that enrolls that admission in one academic session. The importer must keep
that distinction. A student's current class, section, roll number, and session
do not become durable admission identity, and the admission intake class does
not prove a later enrollment placement.

Student/admission profile photographs are intentionally omitted under S-03 and
A-12. Set no target `photoS3Key`, perform no object read/copy/delete, and
inventory every non-null key as metadata-only reconciliation evidence. A
null/absent source photo is not an error.

## Admission mapping

| Legacy `admission` | Target `admission` | Handling |
| --- | --- | --- |
| `id`, `schoolId` | mapped IDs | explicit ID and tenant maps |
| `name`, `address`, `phoneNo` | same required fields | preserve exact text subject to target length validation |
| `admissionNo` | same, unique within target school | run the complete collision audit below |
| `email` | contact email | preserve; it is not a user/portal link |
| `dob` | date | preserve calendar date without timezone conversion |
| `fatherName`, `motherName` | same required fields | preserve; do not synthesize missing values |
| `admissionClassId` | mapped intake class | nullable; never replace it with current enrollment class |
| `registered` | same lifecycle flag | copy the explicit boolean |
| no authoritative transition time | `unregisteredAt` | remain null when unknown |
| `photoS3Key` | `photoS3Key` | deliberately not migrated |
| no document metadata | `documents` | default to `[]` unless separately authoritative source data is found |
| no durable session map | `financeValue` | built from legacy student finance under the finance contract |
| timestamps | timestamps | preserve only with approved timezone interpretation |

### Admission-number audit

For each school report:

- exact duplicates;
- duplicates after trimming;
- duplicates after case folding plus trimming;
- null or blank values;
- one number attached to multiple source admission IDs;
- a mapped source and existing target admission with different numbers;
- a source number colliding with a different existing target admission.

CampusPilot enforces exact `(schoolId, admissionNo)` uniqueness. Matching by
admission number is allowed only through an operator-approved map. The importer
must not silently trim, case-normalize, suffix, renumber, or select the newest
row.

### Required field defects

The source and target both declare several text fields required, but production
rows may still contain blank strings or values outside current API limits. Emit
field-level exceptions for every admission. Do not substitute placeholders such
as `Unknown`, copy father into mother, construct phone/email values, or use an
enrollment field as admission data without an explicit correction file.

`registered=false` may be copied because it is an explicit source fact.
`unregisteredAt` must stay null because neither `updatedAt`, last student row,
last bill, nor last session establishes the transition time.

## Student/enrollment mapping

| Legacy `student` | Target `student` | Handling |
| --- | --- | --- |
| `id` | identical enrollment ID | preserve the source ID exactly after collision validation |
| `schoolId` | mapped school | independently validate |
| `admissionId` | mapped durable admission | must exist in same school |
| `sessionId` | mapped session | must exist in same school |
| `classId`, `sectionId` | mapped placement | validate section belongs to class and school |
| `rollNo` | same nullable integer | validate positive API semantics and uniqueness |
| `financeConfig` | `admission.financeValue[targetSessionId]` | finance contract; remove from enrollment row |
| timestamps | timestamps | preserve only under approved timezone rule |

CampusPilot permits null class, section, and roll number to represent an
unassigned enrollment, although the normal create workflow derives class from a
required section. A legacy row with a broken placement must not be silently
detached. It is either repaired through an approved mapping or blocked. Null is
used only when the source explicitly represents no assignment or a decision
authorizes the loss.

The following uniqueness constraints must pass before writes:

- one student per `(admissionId, sessionId)`;
- one non-null roll number per `(sessionId, classId, sectionId)`;
- one mapped enrollment ID per source student ID.

PostgreSQL permits multiple null roll numbers under the composite unique
constraint. Do not treat that database behavior as permission to discard known
roll numbers.

## Relationship integrity

For every source admission and student, prove independently:

- source school maps to exactly one target school;
- intake class, when present, belongs to that school;
- student admission belongs to the same school;
- student session belongs to the same school;
- student class belongs to the same school;
- student section belongs to the mapped class and school;
- finance data uses the student's explicit mapped session;
- examinations/results that reference the student use the same session/school;
- document artifact scopes that reference the student can be parsed and mapped.

Do not use a valid foreign key in one direction as evidence for the other
relationships. The target schema intentionally leaves several of these as
application invariants rather than composite database foreign keys.

## Admission contact email and users

Admission email is contact data. In the legacy student portal it may have been
used to find admissions after a user authenticated, but there is no durable
admission-to-user foreign key. Therefore:

- copy the contact email to the admission;
- report emails shared by multiple admissions or staff users;
- do not create a target user merely because an admission has an email;
- do not create `school_member` or staff roles for an admission;
- intentionally omit student/guardian portal identity and access state; admission
  contact email remains ordinary admission data.

See [identity-access.md](identity-access.md) for the user/account policy.

## Admission documents and photos

The legacy schema has no admission-document metadata equivalent to the target
`admission.documents`. If production discovery finds an undocumented object
convention, stop and add a reviewed source contract before importing it.

The legacy school also has no equivalent of target
`school.admissionSettings.documentTypes`. Initialize the target default empty
list unless the school supplies an explicit post-migration configuration. Do not
derive document-type settings from filenames, generated artifacts, or empty
admission document arrays.

The target document JSON supports at most 10 types, 10 files per type, and 10 MiB
per file. Each file requires an ID, target S3 key, original filename, content
type, size, and ISO upload time. Do not invent those facts from an arbitrary
object key.

Profile photographs remain out of scope even though both schemas expose a photo
column and document templates can render photos. Templates must tolerate null
photo data. School logos and active Handlebars templates remain in scope;
generated PDFs have their own intentional-omission policy.

## Registration and historical records

Registration is independent from enrollment and historical finance/examination
facts:

- import historical enrollments, results, bills, and documents for both
  registered and unregistered admissions;
- do not reactivate an unregistered admission because it has a recent student
  row;
- do not unregister an admission because no current student row exists;
- do not delete historical enrollment rows merely because the normal API would
  now prevent mutations for an unregistered admission.

Any target API restriction on creating/updating unregistered students is a
runtime rule, not a reason to falsify the historical lifecycle during a reviewed
direct import.

## Import order and idempotency

1. Map schools, sessions, classes, and sections.
2. Insert/map durable admissions without finance values and without photos.
3. Insert/map students with the explicit session placement.
4. Apply approved session-partitioned admission finance values.
5. Import exams, finance facts, and artifacts that reference the mapped IDs.

Use the source primary key as provenance and a persisted identity map as the foreign
key authority. Existing target admissions are merged only through an explicit
mapping; admission number or email alone never triggers an update.

## Required exception reports

- admission-number collision audit;
- missing/invalid required admission fields;
- intake classes outside the admission's school;
- duplicate `(admission, session)` students;
- duplicate roll numbers within session/class/section;
- cross-school or class/section relationship mismatches;
- invalid or missing enrollment placements;
- legacy student finance rows without a mapped session/admission;
- admissions sharing emails with other admissions or staff identities;
- non-empty source photo-key count recorded as blocking pending explicit policy;
- any discovered admission-document source lacking a reviewed contract.

## Acceptance checks

- Admission and enrollment counts reconcile per school and session.
- Every admission shows the correct registration state and intake class.
- Every student appears only in its mapped session/class/section with its source
  roll number.
- Historical sessions do not leak into the active-session student list.
- Source-to-target admission and student mappings are one-to-one except for
  explicitly approved merges.
- `admission.photoS3Key` is null for all rows imported by this migration.
- Admission contact emails do not create staff authorization.
- Finance values are partitioned by the mapped target session ID.

## Source references and anti-pattern guards

Use:

- `../school-app/db/schema.ts`
- `../school-app/packages/entity/admission/admission.schema.ts`
- `../school-app/packages/orpc/modules/student`
- `packages/db/src/schema/admission.ts`
- `packages/db/src/schema/student.ts`
- `packages/db/src/schema/jsonb/admission-config.ts`
- `packages/api/src/routers/school/admission`
- `packages/api/src/routers/school/student`

Do not identify students by name, roll number, email, current class, or the
latest session; do not promote `student` to the durable owner; do not infer
unregister timestamps; and do not migrate profile photographs.
