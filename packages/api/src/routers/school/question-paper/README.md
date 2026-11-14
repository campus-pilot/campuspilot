# Question papers (backend)

The canonical feature guide is `docs/question-papers.md` (product model, data model,
the HTML fragment and its sanitiser, renderer contract, the job, chat, extension checklist, verification).
This README is the file map and the backend rules. Template and rendering rules:
`docs/document-system.md`, "Question papers".

A **paper** is one fact per `(session, exam, class, subject, mode)` of an exam. It has
uploaded **pages** (photos), at most one in-flight generation **job**, immutable
**versions** (the sanitised HTML fragment a model wrote, with a stored PDF
each) and **figures** (uploaded images printed inside a version).

## Files

| File | Responsibility |
| --- | --- |
| `question-paper.router.ts` | oRPC procedures and their MCP metadata |
| `question-paper.http.ts` | multipart upload and redirecting reads of page photos |
| `question-paper.access.ts` | the AI assistant gate |
| `question-paper.scope.ts` | what a paper key means today (plan, names, lifecycle) |
| `question-paper.service.ts` | lists, pages, deletion, figures, queueing a generation |
| `question-paper.version.service.ts` | validation (`checkQuestionPaperDraft`), saving a version, previews, downloads |
| `question-paper.sanitize.ts` / `.css.ts` | the `question_paper_body` sanitiser profile (allowlists, NO ANIMATION, scoped CSS, caps) |
| `question-paper.output.ts` / `.tree.ts` | the exact output grammar (tokens, balance) and the parse5 tree check (the browser builds the grammar's tree inside `.qp-body`); both run at save and at every render |
| `question-paper.lean.ts` | keeps the validate tool's result small |
| `question-paper.records.ts` | row helpers, the paper row lock |
| `question-paper.body.ts` / `.math.ts` / `.render.ts` | stored fragment to HTML body (sanitise again, figures, KaTeX), the document around it |
| `question-paper.storage.ts` | object keys, uploads, best-effort deletes, presigned URLs |
| `question-paper.slot.ts` / `.context.ts` | the body slot and the template context |
| `question-paper.attachments.ts` | chat attachments used as figures (`asat_` ids), copied into the paper when saving |
| `question-paper.copy.ts` | starting from an earlier paper: the copy sources list, the key rules and copying the source's figures (`copyQuestionPaperVersion` itself is in the version service) |
| `../../../workflows/question-paper/` | the API side of the generation job (outbox, hand-over, model hook) |

## Who may do what

Every procedure and route checks, in this order:

1. **OPA class permission**: `class.exam.question_paper.read` (list, view, preview,
   download, versions) or `.manage` (upload, reorder, delete, generate, save, copy). A
   teacher only for the classes in their role's `meta.classIds`; principal, manager and
   exam coordinator for every class of the school; nobody else.
2. **The assistant gate** (`requireQuestionPaperAssistantAccess`): the school has the
   `assistant` feature, the user is a member, and one of their roles is both eligible
   (platform) and switched on (school). It runs *after* OPA so a caller without access
   learns nothing about the school's features. Starting a generation additionally
   needs the school to be under its monthly limit (`useModel`); reading, editing and
   saving what exists never spends model money.
3. **The paper**: the key must name a real plan and mode (`resolvePaperScope`).
   Writes also need the active session and an exam that is not `completed`.

`listQuestionPapers` and `learn_question_paper_generation` are school-level
(`READ_EXAM_PLANS` / `READ_EXAMS`) and filter or skip class checks accordingly.

`copyQuestionPaperVersion` checks `.manage` on the target's class and `.read` on the
SOURCE paper's class (`readSourceClass`, from `input.source`), both before the gate;
`listQuestionPaperCopySources` checks `.manage` and `.read` on the paper's class (the
sources are of the same class).

## Concurrency

All changes to a paper's pages, jobs and versions run under a `FOR UPDATE` lock of the
paper row.

- `page_revision` is the token of reorder, delete page and generate
  (`expectedPageRevision`): any page change bumps it.
- `latest_version_no` is the token of `saveQuestionPaperVersion`
  (`expectedVersionNo`); a stale value is CONFLICT. It is its own column, never
  `max(version_no)`.
- One job in flight per paper (partial unique index). While it exists, uploading,
  reordering and deleting pages and deleting the paper are refused with CONFLICT.
- The printed version number must equal the stored one, so a save renders after
  reading `latest_version_no` and re-checks it under the lock. An agent save with a
  stale `expectedVersionNo` is CONFLICT; an AI job save (no expectation) renders again
  (up to 3 times) when another version landed in between.
- Storage is outside the transaction: bytes are uploaded first and deleted again
  if the row cannot be written; deletes after a commit are best effort and logged.

## Tools for agents

Seven advanced MCP tools in module `exams` (reachable by external MCP clients through the
advanced-tool meta tools, and by the in-app assistant): `listQuestionPapers`,
`getQuestionPaper`, `listQuestionPaperVersions`, `getQuestionPaperDraft` (in-app assistant only: reads back an unsaved draft by `draftId`), `learn_question_paper_generation`
(the literal name, decision D36; model-facing `school_learn_question_paper_generation`),
`validateQuestionPaperDraft` and `saveQuestionPaperVersion` (a write, so the assistant
asks the user to approve it). Everything else is *hidden*: a human action that is
never offered to MCP clients or the assistant (page photos, the AI job, previews,
downloads and starting from an earlier paper).

`getQuestionPaper`, `getQuestionPaperDraft`, `validateQuestionPaperDraft` and `learn_question_paper_generation`
declare `outputChars` in their MCP metadata so the assistant does not cut a paper or the
guide at the default 24,000 characters: `getQuestionPaper` returns the whole fragment (`html`)
and declares `QUESTION_PAPER_PAPER_OUTPUT_CHARS` = twice the fragment limit plus 40,000 (JSON
escaping); validate never echoes the fragment, lists at most 40 problems and 40 removed-item
lines (`leanLines`) and declares 40,000; learn declares 40,000. All are derived in
`question-paper.dto.ts` from `QUESTION_PAPER_LIMITS`.

A chat draft is not a database row: it is the input (`html`) of a `validateQuestionPaperDraft`
tool call in the conversation. `saveQuestionPaperVersion({ draftId })` is accepted only
from the in-app assistant and finds the newest such call of *this conversation* (same
school, same user, not deleted) whose canonical html hashes to the id.
`getQuestionPaperDraft({ ...scope, draftId })` uses the same lookup (so the same scoping and
the same refusal outside the in-app assistant) and returns the draft *cleaned* (at most the
fragment limit, what a save would store) with the paper's facts; it is the way back when the
chat has replaced an old `validateQuestionPaperDraft` input with a note (a saved paper is
read with `getQuestionPaper`).

## Starting from an earlier paper

`listQuestionPaperCopySources` lists the saved papers of the same school, class
(`class_id`: a class is a school-level row, the same in every session) and subject, from any
session, exam and mode, without the target and papers that have no version.
`copyQuestionPaperVersion` saves a new version of the target through
`saveQuestionPaperVersion` with source `copy` (same checks, locks, `expectedVersionNo` CONFLICT,
current template, the target's `plan_max_marks`, no model call). The source is only read; its
`qpf_` figures are verified (size and sha256) and copied into the target before anything is
written, or the copy fails with `copy_figure_unavailable`. `source_version_id` is
`ON DELETE SET NULL`, so deleting the source later leaves the copy intact. Reasons:
`copy_source_mismatch`, `copy_source_is_target`, `copy_source_not_found`,
`copy_figure_unavailable`. See the guide, "Starting from an earlier paper".

## Generation (API side)

`startQuestionPaperGeneration` checks, before any cost: a model is configured in this
process (`workflows/question-paper/model.ts`; the process that serves the API must call
`configureQuestionPaperModel`), a template is selected, the paper has pages and the
caller saw the current `page_revision`, the model can read every page (a HEIC page
needs a model that accepts HEIC; pages are never dropped silently), and no job is in
flight. It inserts the `queued` job (the outbox row, with the ordered page ids) and
returns; the hand-over to the worker (`sendQuestionPaperStart`, signed with
`WORKER_CONTROL_SECRET`) happens after the commit and never blocks the request. The
30 s sweep in `apps/server` (`sweepQuestionPaperOutbox`) re-sends what Restate did not
accept, and fails jobs that can no longer progress (`dispatch_failed` after 10
minutes unaccepted, `not_started` after 5 minutes accepted, `not_finished` after
`QUESTION_PAPER_JOB_TIMEOUT_MINUTES` running, an env setting, default 40). Starting a job is refused while the school has
`QUESTION_PAPER_MAX_RUNNING_JOBS_PER_SCHOOL` (default 3) queued or running jobs.

Inputs: the paper key, `expectedPageRevision` and optional `instructions`, the
teacher's note on what to change ("Keep the questions but change the numbers"). The
DTO (`generationInstructionsSchema`) turns CR/CRLF into `\n` and trims; empty is none
(`null`); at most `QUESTION_PAPER_GENERATION_INSTRUCTIONS_MAX_CHARS` (2,000) characters;
any other control character is refused, never stripped. They are stored on the job row
(`instructions`, never changed) and change no check, limit or cost.
`getQuestionPaperDetail` returns them on `activeJob` and `lastFinishedJob`;
`getQuestionPaper` (an agent tool) does not.

The worker side lives in `workflows/question-paper/`: `control-service.ts`
(`QuestionPaperControl.startGeneration`, signed), `workflow.ts` (the Restate workflow),
`generation.ts` (the steps, shared with the integration tests), `prompt.ts` (the job's own
instructions, never shown to chat), `cost.ts` (`assistant_model_request` rows with
`source = 'question_paper'`). A job ends `succeeded` (a version saved through
`saveQuestionPaperVersion` with source `ai_job`) or `failed` with an `error_code` from
`QUESTION_PAPER_JOB_FAILURES` and its safe `error_message`; the page polls the job row.

## Deleting

`deleteQuestionPaper` and `deleteExamPlan` (via `deleteQuestionPapersOfPlan`) delete the
rows (pages, jobs, versions and figures cascade), the PDF artifacts of the versions and,
after the commit, every stored object, including figures copied from another paper (they
are the target's own rows and objects). Deleting a paper that was copied from clears
`source_version_id` on the copies and nothing else. Template revisions are shared and stay.

## Demo seed

`workflows/demo-school/steps.ts` (`seedQuestionPaper`) calls `resolvePaperScope`,
`addQuestionPaperPage` and `saveQuestionPaperVersion` directly as the demo's principal,
because a demo school keeps the `assistant` feature off and the procedures refuse
without it. If you change those functions' signatures or what they check, the seed and
its test (`demo-question-papers.integration.test.ts`) must follow. See
`docs/demo-school.md`.
