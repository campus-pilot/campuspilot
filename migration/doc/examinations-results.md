# Examinations, results, assessments, and timetables migration contract

## Scope and target model

This contract covers session exam definitions and legacy `exam_plan`,
`exam_result`, and `exam_timetable`. CampusPilot retains those structures and
adds three independent domains:

- `exam_lifecycle`: ready, active, or completed for the whole examination;
- `exam_assessment_settings`: exam-wide working days;
- `exam_student_assessment`: exam-wide attendance and co-scholastic results.

The new facts must not be inferred from per-subject plan/result values. Legacy
per-subject fields remain on the target plan/result rows precisely so historical
data can be preserved without pretending it was exam-wide.

## Dependency and identity mapping

An examination is identified within one mapped school and session by an
`examSlug` declared in `sessionConfig.examConfig`. There is no independent exam
table. Import in this order:

1. mapped school, session, class, student, and class subject configuration;
2. session exam definitions;
3. exam plans;
4. exam results;
5. timetable;
6. lifecycle and exam-wide assessment rows using the approved rules below;
7. active templates after source IDs resolve.

CampusPilot now uses the legacy `expl`, `exrs`, and `ett` prefixes. Preserve each
legacy examination primary key exactly and keep an identity mapping in the run
manifest. Any invalid shape, duplicate, or target collision blocks the affected
scope and must be shown to the user; never generate a substitute ID.

For every row, independently prove school, session, class, plan, and student
ownership. A valid foreign key is not enough because several target tables store
denormalized school/session identifiers without composite tenant foreign keys.

## Exam definitions

Import `sessionConfig.examConfig[examSlug] = {name, order}` only after validating:

- non-empty stable slug and name;
- positive integer order;
- unique intended display order within the session;
- every plan/timetable/artifact exam slug exists in the same session;
- an existing target definition with the same slug is the approved identity,
  not merely a text collision.

Do not create a missing definition from a plan's slug automatically. Report the
orphan and require an explicit definition mapping. Do not merge two definitions
because they share a display name.

## Exam plans

| Legacy plan | Target plan | Handling |
| --- | --- | --- |
| IDs and ownership | mapped IDs/ownership | validate all relationships |
| `examSlug`, `classId`, `subjectSlug` | same logical keys | map class and preserve approved slug |
| `totalMarks` | same positive integer | preserve; do not force new-plan default 100 |
| `modeConfig` | same snapshot | validate target shape and totals |
| `totalWorkingDays` | legacy compatibility field | preserve on each plan and include in the agreement report |
| `status` | same plan status enum | copy exact value |
| timestamps | timestamps | preserve only under approved timezone rule |

Target uniqueness is `(sessionId, examSlug, classId, subjectSlug)`. Duplicate
source plans require an operator decision and cannot be resolved by latest
update, highest status, or most results.

Target `modeConfig` requires at least one mode. Each mode contains a
non-negative integer `maxMarks` and percentage in range; percentages must sum
to 100. Compare it with the mapped class subject's configured exam modes, but do
not replace the plan snapshot with current class configuration. A posted plan is
historical configuration in its own right.

Plan `status` and examination lifecycle remain separate target facts, but this
migration has an explicit aggregation rule in the lifecycle section below.

## Results

| Legacy result | Target result | Handling |
| --- | --- | --- |
| plan/student IDs | mapped plan/student IDs | student must be in same session/school |
| `marks` | same mode-keyed JSON | validate against the plan snapshot |
| `coScholastics` | legacy per-subject compatibility field | preserve as-is after schema validation |
| `daysAttended` | legacy per-subject compatibility field | preserve null and zero distinctly |
| `approved` | same explicit result approval | copy exact boolean |
| timestamps | timestamps | preserve with approved timezone interpretation |

Target uniqueness is `(examPlanId, studentId)`. Validate every mark key against
the plan's modes, require numeric non-negative values, and report values above
the mode maximum rather than clamping them. Missing marks remain missing; they
never become zero.

An approval on one subject result does not approve other subjects or the
exam-wide student assessment. Preserve each result's explicit approval only.

## Exam-wide assessment decision

Legacy `daysAttended`, `coScholastics`, and `approved` repeat on every
subject-result row. For each `(school, session, examSlug, student)` produce an
agreement report:

- `all-null`: every subject lacks the value;
- `single-value`: every non-null subject agrees and nulls also exist;
- `all-equal`: all subjects have the same value;
- `conflict`: two or more non-null values differ;
- `partial-subject-set`: the student lacks results for some plans;
- `invalid`: at least one value fails the target schema.

Likewise, report `exam_plan.totalWorkingDays` agreement per examination.

The approved rule is deterministic: sort the student's subject results by the
preserved `exam_result.id`, validate agreement independently for each field,
and select the first populated value for that field. A leading null on one
subject does not erase a value stored on another subject. Populate
`exam_student_assessment.daysAttended` and `coScholastics` only when every
populated subject value for that field agrees. Copy `approved` only when every
subject result has the same boolean. `all-null` stays null. A conflict, invalid
value, or missing result for a configured plan blocks that student's assessment
and the migration agent must ask the user. The assessment `updatedAt` is the
latest source result timestamp in the group because the row is a composite of
all subject results. Stable source-ID ordering is solely a reproducibility rule;
database scan order must never select the value.

Continue preserving the legacy compatibility fields on each subject result and
plan. Under approved decision S-26, create exactly one
`exam_assessment_settings` row for every in-scope `(session, examSlug)` with
`totalWorkingDays=81`. The checksum-bound mapping binds both the source agreement report
and the exact settings list; missing/extra exams, a value other than 81, or
source drift blocks before target writes.

## Examination lifecycle decision

The legacy source has plan statuses but no examination-wide lifecycle or
authoritative transition timestamps. Produce a status matrix for every exam:

- counts of draft, approved, active, and completed plans;
- classes/subjects missing plans relative to configuration;
- result and approval counts;
- timetable existence;
- earliest/latest source timestamps as evidence only.

Apply this approved rule only when all configured plans exist and all plan
statuses agree:

- all `completed` becomes lifecycle `completed`;
- all `active` becomes lifecycle `active`;
- all `draft` or all `approved` becomes lifecycle `ready`.

Mixed statuses, missing configured plans, or any unknown status block lifecycle
creation and must be shown to the user. `startedAt` and `completedAt` remain null
because the source has no authoritative transition timestamps. Never use plan
`createdAt`/`updatedAt`, result dates, or migration time for them.

## Timetable mapping

The shared grid remains one row per `(sessionId, examSlug)`, but the target
validator is stricter. It requires:

- unique target class IDs in `columns`, maximum 200;
- unique row IDs, maximum 500 rows;
- ISO calendar dates and `HH:mm` times with end after start;
- every present `cells` key to belong to `columns` (a missing key and explicit
  null are both empty in the current target contract);
- each cell to be null, one `{subjectSlug, modeSlug}`, or a non-empty array;
- mapped subjects/modes valid for that class;
- no overlapping occupied time ranges for a class on the same date.

Dates are calendar facts and must not shift through timezone conversion. Map
class IDs in both `columns` and every `cells` key. Preserve multi-subject arrays;
do not select one element for legacy template compatibility. Extra cell keys,
duplicate classes/rows, empty arrays, invalid times, unknown subjects/modes, and
overlaps are blocking exceptions.

Timetable presence does not establish lifecycle. A timetable may exist without
plans and plans may exist without a timetable; report those cases.

## Generated examination documents

Do not import legacy result/report-card, ID-card, admit-card, or timetable PDF
artifact rows or objects. Record count-only `intentionally_omitted`
dispositions. CampusPilot creates new artifacts from the migrated facts and
active templates when users download them. The new artifact is not represented
as the legacy original.

## Required exception reports

- missing or duplicate exam definitions/orders;
- orphan or duplicate plan identities;
- unknown class, subject, or mode slugs;
- invalid plan total marks or mode percentages;
- results with cross-session/cross-school students or plans;
- duplicate results, invalid/missing/out-of-range marks;
- per-subject working-day, attendance, co-scholastic, and approval agreement
  matrices;
- exams whose plan statuses are mixed or incomplete under the approved lifecycle rule;
- unknown lifecycle transition timestamps;
- timetable shape, relationship, limit, or overlap errors;
- unexpected generated-document types outside the approved omission rule.

## Reconciliation and acceptance

Reconcile per school/session/exam/class/subject:

- definition, plan, result, and approved-result counts;
- status counts and exact plan status mapping;
- result marks and total marks JSON checksums;
- null/zero/non-null attendance counts;
- co-scholastic and approval checksums;
- timetable column/row/occupied-cell counts and normalized checksum;
- source rows versus imported, omitted, deferred, and blocked dispositions.

Acceptance also requires:

- target exam list and class/subject plans match the approved source mapping;
- results are readable only in their mapped session and class;
- exam-wide attendance/co-scholastic values match their independently selected
  first populated source values and have no undisclosed cross-subject conflicts;
- lifecycle-gated actions reflect the approved unanimous-plan aggregation rule;
- timetable rendering preserves every class and multi-subject slot;
- representative historical and active result/document workflows pass through
  authenticated API and UI checks.

## Source references and anti-pattern guards

Use:

- `../school-app/db/schema.ts`
- `../school-app/packages/entity/exam/exam-plan.schema.ts`
- `../school-app/packages/entity/exam/exam-timetable.schema.ts`
- `packages/db/src/schema/exam.ts`
- `packages/db/src/schema/jsonb/exam-config.ts`
- `packages/api/src/routers/school/exam/README.md`
- `packages/api/src/routers/school/exam/exam.dto.ts`

Do not run normal plan generation over imported plans, standardize historical
totals to 100, promote conflicting/partial subject data, infer lifecycle from
mixed/incomplete plan status, or drop extra timetable cells to satisfy
validation.
