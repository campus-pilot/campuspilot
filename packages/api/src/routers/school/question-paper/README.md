# Question papers (backend)

Feature design: `.sks/handlebar-based-question-paper-generation/design.md`
(sections C to E); the canonical feature guide `docs/question-papers.md` is written
with the last phase. Template and rendering rules: `docs/document-system.md`,
"Question papers".

A **paper** is one fact per `(session, exam, class, subject, mode)` of an exam. It has
uploaded **pages** (photos), at most one in-flight generation **job**, immutable
**versions** (the structured JSON of `@campuspilot/question-paper`, with a stored PDF
each) and **figures** (uploaded images printed inside a version).

## Files

| File | Responsibility |
| --- | --- |
| `question-paper.router.ts` | oRPC procedures and their MCP metadata |
| `question-paper.http.ts` | multipart upload and redirecting reads of page photos |
| `question-paper.access.ts` | the AI assistant gate |
| `question-paper.scope.ts` | what a paper key means today (plan, names, lifecycle) |
| `question-paper.service.ts` | lists, pages, deletion, figures, queueing a generation |
| `question-paper.version.service.ts` | validation, saving a version, previews, downloads |
| `question-paper.records.ts` | row helpers, the paper row lock |
| `question-paper.body.ts` / `.math.ts` / `.render.ts` | JSON to HTML body, KaTeX, the document around it |
| `question-paper.storage.ts` | object keys, uploads, best-effort deletes, presigned URLs |
| `question-paper.slot.ts` / `.context.ts` | the body slot and the template context |
| `../../../workflows/question-paper/` | the API side of the generation job (outbox, hand-over, model hook) |

## Who may do what

Every procedure and route checks, in this order:

1. **OPA class permission**: `class.exam.question_paper.read` (list, view, preview,
   download, versions) or `.manage` (upload, reorder, delete, generate, save). A
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

Six advanced MCP tools in module `exams` (reachable by external MCP clients through the
advanced-tool meta tools, and by the in-app assistant): `listQuestionPapers`,
`getQuestionPaper`, `listQuestionPaperVersions`, `learn_question_paper_generation`
(the literal name, decision D36; model-facing `school_learn_question_paper_generation`),
`validateQuestionPaperDraft` and `saveQuestionPaperVersion` (a write, so the assistant
asks the user to approve it). Everything else is *hidden*: a human action that is
never offered to MCP clients or the assistant (page photos, the AI job, previews and
downloads).

`getQuestionPaper`, `validateQuestionPaperDraft` and `learn_question_paper_generation`
declare `outputChars` in their MCP metadata (80,000 / 80,000 / 100,000) so the
assistant does not cut a paper or the guide at the default 24,000 characters.

A chat draft is not a database row: it is the input of a `validateQuestionPaperDraft`
tool call in the conversation. `saveQuestionPaperVersion({ draftId })` is accepted only
from the in-app assistant and finds the newest such call of *this conversation* (same
school, same user, not deleted) whose canonical content hashes to the id.

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
`QUESTION_PAPER_JOB_TIMEOUT_MINUTES` running, an env setting, default 20).

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
after the commit, every stored object. Template revisions are shared and stay.
