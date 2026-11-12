# Question papers

AI-assisted question papers: a teacher photographs a handwritten paper (or
dictates it to the assistant in chat), and CampusPilot turns it into a
structured document that prints on the school's own letterhead. This is the
canonical guide. Template and rendering rules shared with the other document
types are in [Document system](document-system.md#question-papers); the chat
side of the assistant is in [In-app assistant](assistant.md).

Read this before changing the `exam_question_paper_*` tables, the
`question-paper` router or its MCP tools, the structured paper schema
(`packages/question-paper`), the renderer, the generation job
(`packages/api/src/workflows/question-paper`), chat image attachments, the
`question_paper` document type, the Question paper tab in the management app or
the demo seed's question papers.

## Product model

- A **paper** is one fact per `(session, exam, class, subject, mode)`, the
  natural key of an exam plan. "Mode" is the school-defined assessment mode of
  a subject (theory, practical, ...). One paper per key; sections of a class do
  not get their own.
- It has up to 20 uploaded **pages** (photos of the handwritten paper, kept in
  the order the user chose), at most one in-flight **generation job**, any number
  of immutable **versions** and the **figures** (uploaded images printed inside a
  version). Pages are *source material*: the printed paper paginates on its own and
  the number of uploaded pages means nothing for the generated one. Never map or
  validate them one to one.
- A **version** is the structured JSON document (below) plus a stored PDF. It never
  changes. Every change (a regeneration, a chat edit) is a new version; any version
  can be previewed and downloaded. There is no approved or final state, no hand
  editing of a generated paper in the UI and no answer key.
- The **heading and footer come from the school's `question_paper` template**
  (a full document type, see below), never from the AI. The AI only writes the body.
- Two ways in, one set of rules:
  1. **Manual**: the Question paper tab of an examination (upload, reorder,
     *Generate with AI*, preview, download). Generation is a durable worker job.
  2. **Chat**: the in-app assistant or an external MCP client reads attached photos
     or an existing paper, writes the JSON itself, validates it, shows drafts and saves
     a new version only when the user says so. No model call is made by the server
     for this path: the agent is the author, the server validates and stores.
  Both end in the same function, `saveQuestionPaperVersion`, so validation, the marks
  check, rendering and printing are identical.
- Images **inside** a paper come only from uploaded images. Image links are not
  supported. A diagram the AI cannot reproduce becomes a **figure placeholder**
  (with a description); the user attaches the real image in chat and a new
  version prints it. The manual screen never embeds images: that is chat's job.
- Languages and scripts: Hindi and other Indian languages, Urdu (right to left)
  and mathematics (LaTeX through KaTeX) are first class. `language`, `script` and
  `direction` are separate fields and never inferred from one another.

## Permissions, gate and who sees it

Every procedure and upload route checks, in this order (the order matters: a caller
without access must learn nothing about the school's features):

1. **OPA class permission** `class.exam.question_paper.read` (list, view, preview,
   download, versions) or `.manage` (upload, reorder, delete, generate, save).
   Granted to teacher (only for the classes in the role's `meta.classIds`), principal,
   manager and exam coordinator (every class). `listQuestionPapers` and
   `learn_question_paper_generation` are school level (`READ_EXAM_PLANS` /
   `READ_EXAMS`).
2. **The assistant gate** (`requireQuestionPaperAssistantAccess`,
   `question-paper.access.ts`): the school has the `assistant` feature, the user is a
   member and one of their roles is both eligible (platform) and switched on (school).
   This is the assistant's own decision (`resolveAssistantAccess`), not a copy of its
   rules. Starting a generation additionally needs the school to be under its
   monthly limit; reading, editing and saving what exists never spends model money,
   so a school at its limit keeps its papers. There is **no separate feature flag**:
   question papers are part of the `assistant` feature, and their cost counts under AI
   usage as "Question paper".
3. **The paper**: the key must name a real plan and mode (`resolvePaperScope`).
   Writes also need the active session and an exam whose lifecycle is not
   `completed` (read from `exam_lifecycle`, never inferred from the plan). Once an
   exam is completed, papers are read-only; preview and download still work.

The management app mirrors this: the Question paper tab, its marketplace card and
its settings page exist only when the `assistant` feature is on and (for the tab)
the user's role may use it. While the answer is loading the tab is absent and
Results stays the default (`useAssistantGate`).

## Data model

Schema in `packages/db/src/schema/exam-question-paper.ts` (and `assistant.ts` for the
attachment table). All rows carry `school_id`. Nothing has a foreign key to
`exam_plan`: plans are deleted and regenerated, and `deleteExamPlan` deletes the
affected papers itself.

| Table | Holds |
| --- | --- |
| `exam_question_paper` | The paper: unique key, `latest_version_no` (token of saving a version, never `max(version_no)`), `page_revision` (token of page changes) |
| `exam_question_paper_page` | One photo: position, original and two derivatives (`model` JPEG the AI reads, `thumb`), `derivative_status` (`ready` or `unsupported` when the server cannot decode it, for example HEIC), size, sha256 |
| `exam_question_paper_job` | One generation: `queued`, `running`, `succeeded`, `failed`; ordered `page_ids` and the `page_revision` it ran on; provider, model, request count; `error_code` and the safe `error_message` (and developer-only `error_detail`); hand-over facts (`handed_over_at`, attempts, last error). A partial unique index allows one queued or running job per paper |
| `exam_question_paper_version` | Immutable: `version_no`, the JSON `content`, its sha256, `source` (`agent` or `ai_job`) with the job id, page ids or conversation id, `total_marks`, `plan_max_marks`, `warnings`, the pinned `template_revision_id` and the `pdf_artifact_id` |
| `exam_question_paper_figure` | An uploaded image a version prints (JPEG, or PNG up to 400 KB when it has transparency), owned by the paper, deduplicated by `source_attachment_id` |
| `assistant_attachment` | A chat image (below) |
| `assistant_model_request` | The job's cost rows: `source = 'question_paper'`, `question_paper_job_id`, no chat run |

The PDF of a version is an `artifact` row (`kind: pdf`, `document_type:
question_paper`, class, session and exam filled) under
`schools/{schoolId}/documents/`. `pdf_artifact_id` is `ON DELETE SET NULL`: if the
artifact is ever deleted, the next download prints the version again from its stored
JSON and pinned template and stores the new PDF. Every object lives under
`schools/{schoolId}/` (`exam-question-papers/pages|figures/{pageId|figureId}...`; objects written before
this scheme keep their `{paperId}` keys, deletes use the key stored on the row), which is
what the demo purge sweeps.

## Lifecycle

```
upload pages -> (generate: queued -> running -> succeeded | failed) -> version n
chat: attach photos -> draft(s) -> user: "save" -> approval -> version n
```

- **Pages.** `POST` multipart through the API server (field `page`, 15 MB per file, 20
  per paper, JPEG, PNG, WebP and the HEIC family; the bytes decide, not the file
  name). Upload, reorder (`expectedPageRevision`) and delete page run under the paper's
  row lock. Objects are written to storage first, with no lock held, and removed again
  if the short transaction that follows (exam and plan re-checked under their locks,
  paper locked, row inserted) is refused.
  Derivatives are made at upload (EXIF rotation applied, 1800 px, at most about
  600 KB for the model copy, a 360 px thumbnail). The header is read first and an
  image over 40 megapixels is refused before any decode (413); the image is then
  decoded once, at most two at a time per process (at most eight more uploads wait; the
  next is refused with 429), and both derivatives come from
  that one decode (`files/image-derivative.ts`). The upload route allows 120 a minute
  per IP (a school shares one address). A HEIC the server's `sharp`
  cannot decode is kept as `unsupported`: it still previews in browsers that can,
  and a model that cannot read it makes generation fail with a clear message
  instead of dropping the page (D46). The browser converts HEIC to JPEG itself where
  it can (Safari).
- **Generation** (manual only). See "The generation job".
- **Save.** `saveQuestionPaperVersion` validates the document (`checkQuestionPaperDraft`),
  copies chat-attachment figures into the paper, picks the school's currently
  selected template, renders the HTML, prints the PDF with Gotenberg, uploads it,
  and in one transaction inserts the artifact, the version and bumps
  `latest_version_no`. The printed version number must equal the stored one: an
  agent save with a stale `expectedVersionNo` is CONFLICT; a job save renders again
  (up to 3 times) when another version landed in between. A job's save is
  idempotent per job id. Every write transaction (page add, reorder, delete,
  figure, delete paper, start, save) first takes the school session row `FOR SHARE`
  and the plan row of the paper's class and subject `FOR SHARE`, then re-reads the exam
  lifecycle (`assertPaperWritableLocked`; the order is the one `deleteExamPlan` uses:
  session, plan, paper). Completing an exam takes the session row `FOR UPDATE` and
  deleting a plan takes the plan row `FOR UPDATE`, so a write cannot commit to a
  completed exam or re-create a paper for a plan that was just deleted (NOT_FOUND). A paper
  locked this way is the BAD_REQUEST with `data.reason = 'paper_locked'`; a paper
  that is too large or complex to print fails a job as `paper_unprintable`, and
  `checkQuestionPaperDraft` also totals the KaTeX HTML and the stored figures (base64,
  12 MB cap) so validate, save and the job agree. A stored version previews and re-prints with its saved `plan_max_marks`
  (class, subject, mode and exam names still come from the live plan).
- **Delete.** `deleteQuestionPaper` (refused while a job is in flight) and
  `deleteExamPlan` delete the rows (pages, jobs, versions, figures cascade), the
  PDF artifacts and, after the commit, every stored object (best effort, logged).
  Template revisions are shared and stay.
- **Concurrency.** Everything that changes a paper's pages, jobs or versions runs
  under a `FOR UPDATE` lock of the paper row. While a job is in flight, page changes
  and deleting the paper are CONFLICT.

## The structured JSON

`packages/question-paper` is the one definition (Zod, `.strict()` everywhere, so a
typo is an error with a path). Schema version 1.

- `meta`: `language`, `script`, `direction` (stated independently), and **hints** read
  from the paper (`timeAllowed`, `maxMarks`, `classLabel`, `subjectLabel`,
  `examLabel`). Hints reach the template (`questionPaper.timeAllowed`) or are compared
  with the computed total; they are never authoritative.
- `generalInstructions`, then `sections[]` (heading, instructions, blocks such as a
  reading passage, `attemptAny`, `questions[]`). A question has `number` (printed
  verbatim), `type` (semantic tag), `text`, `marks` (multiples of 0.25 or null),
  `blocks`, `options` (MCQ), `parts` > `parts` (three levels at most, explicit, never
  recursive: the providers' structured output rejects recursion) and `alternatives`
  ("OR").
- Rich text is a string or an array of runs (`text` with bold, italic, underline,
  sup, sub and per-run language, `math` as LaTeX, `br`). Blocks are `paragraph`,
  `table`, `figure` (`imageId` plus alt text) and `figure_placeholder`.
- **No pages, page breaks, columns or fonts**: layout belongs to the renderer and the
  template. Totals are computed (`marks.ts`), never stored in the document: an OR
  question counts its largest branch, `attemptAny` counts the k largest questions.
- Limits live in one file, `limits.ts` (20 sections, 300 questions, 600 math nodes,
  30 figures, 200,000 JSON characters, ...). They are product limits; the provider
  JSON Schema drops numeric keywords, so the Zod schema re-validates everything.
- `normalize.ts` makes a document canonical (NFC, defaults, key order); the content
  sha256 and the 12-hex **draft id** come from the canonical JSON.
- `provider-schema.ts` derives the JSON Schema offered to providers (local `$defs`,
  about 7 KB, no `$ref` siblings, no cycles). `examples.ts` holds two complete worked
  papers (Hindi mathematics with LaTeX, English science with a placeholder figure, an
  OR choice and a table); they are the guide's examples, the preview body of template
  designs and the demo's version 1, and a test keeps them valid.
- **Warnings** (`marks.ts`) never block a save: the total differs from the mode's
  maximum marks (`total_differs_from_plan`) or from the paper's own header, a question
  has no marks or its parts do not add up, the alternatives of an OR carry unequal
  marks, a question number repeats, an MCQ has no options, or a figure placeholder is
  still unresolved. Errors (schema, cross checks, a formula
  KaTeX rejects, a figure that is not the paper's) do block.

## The renderer contract

The body is built by our code, not by the template and not by the model:

- `question-paper.body.ts` is a pure function from the validated JSON to an HTML
  fragment with a fixed element and class vocabulary; every string is escaped and no
  JSON value is ever markup, a URL, an attribute name, a class or CSS. Math goes
  through KaTeX (`question-paper.math.ts`: HTML output only, `trust: false`, no macros,
  2 s wall budget). The KaTeX stylesheet with fonts inlined as data URIs is built once
  per process and added only to papers that contain math.
- The school's template (`question_paper` document type, full A4 only, no default
  design: generation is blocked until the school selects one) places
  `{{{questionPaper.bodyHtml}}}` **exactly once, in element content**. The template is
  rendered with the constant slot placeholder as that value and sanitised like any other
  document; only then is the placeholder replaced by the body
  (`substituteQuestionPaperBody`, `indexOf` and slicing, never `String.replace`).
  Nothing an author writes can reach, repeat or alter the body.
- **Deliberate security differences (K1, acknowledged by the product owner).** The
  body is *not* sanitised after the template, because the document sanitiser strips the
  inline SVG KaTeX draws roots and arrows with; it is trusted because our renderer
  builds it from validated JSON. The CSP of this type, and only this type, adds
  `font-src data:` so the inlined KaTeX fonts load; still no network, no script, no
  frames, images from data URIs only. Do not extend either difference to another type,
  add a second trusted insertion point, or weaken the policy for a design without
  repeating that review (`question-paper.slot.ts` carries the same warning).
- Budgets: the template alone renders under the notice budget (2,000,000 characters)
  and may show the logo at most 3 times; the whole document stays within 25 MB; figures
  are loaded from storage as data URIs with a total cap.
- A saved version **pins its template revision**: previews and re-downloads use that
  revision, never the school's later choice.
- Heading, footer and the template context (`QuestionPaperContext`: school, session,
  exam, class, subject, mode names, max marks, total, time allowed, version number)
  are in [Document system](document-system.md#question-papers).

## The generation job (manual UI only)

`startQuestionPaperGeneration` checks before any cost that a model is configured in the
process, a template is selected, the paper has pages and the caller saw the current
`page_revision`, the model can read every page, no job is in flight and the school is
under its limit. It inserts the `queued` job (the outbox row) and returns; the signed,
idempotent hand-over to Restate (`QuestionPaperControl.startGeneration`, signed with
`WORKER_CONTROL_SECRET` like every worker control service) happens after the commit and
never blocks the request. The API's 30 s sweep re-sends what Restate did not accept and
fails jobs that cannot progress (`dispatch_failed` after 10 minutes unaccepted,
`not_started` after 5 minutes accepted, `not_finished` after
`QUESTION_PAPER_JOB_TIMEOUT_MINUTES`, default 40, above the worst case of two long
requests). Starting a job is also refused when the school already has
`QUESTION_PAPER_MAX_RUNNING_JOBS_PER_SCHOOL` (default 3) queued or running, because the
monthly-limit check reads a spend sum cached for ten minutes and would otherwise be
passed by every job a user starts at once; the check runs under a per-school advisory
lock. The cap bounds how many jobs run at the same time, not how far the cached limit
can be overshot: jobs started one after another inside the cache window all see the same
cached spend.

The workflow (`workflows/question-paper`, ingress-private, steps shared with the
integration tests in `generation.ts`): begin, re-check access and the paper
(limit, feature, role, exam not ended), gather inputs (every page has a readable
source, at most 16 MiB of images counted as base64, the same budget as the chat), one structured model request (its cost row is saved inside
that same step; a repeated billed call takes the next `:attempt:{k}` key derived from
the saved rows, never dropped), validate,
at most one text-only repair request, save through `saveQuestionPaperVersion` with
source `ai_job`, mark succeeded. Provider failures retry (busy or unknown up to 3
requests); a refusal or a truncated answer fails without repair. Every step checks
the job is still `running` for its attempt, so a swept job spends and saves nothing
more. A failed job has an `error_code` from `QUESTION_PAPER_JOB_FAILURES` and a safe
`error_message` the page shows; the page polls `getQuestionPaperDetail`. A marks
mismatch stays a warning. The job's own system prompt (`prompt.ts`) never enters chat.

Model settings are separate `QUESTION_PAPER_*` env values (`QUESTION_PAPER_PROVIDER` and
`QUESTION_PAPER_MODEL`, four `QUESTION_PAPER_PRICE_*`, `QUESTION_PAPER_MAX_OUTPUT_TOKENS`,
`QUESTION_PAPER_JOB_TIMEOUT_MINUTES`). The provider defaults to `ASSISTANT_PROVIDER` and
the model to that provider's own model; a `QUESTION_PAPER_MODEL` needs all four prices
and prices without a model are refused (`packages/env/src/assistant.ts`). The API server
and the worker both call `configureQuestionPaperModel(createQuestionPaperModel())`; the
worker also needs the provider key, `katex` and `sharp`. Cost rows are written by `recordQuestionPaperRequest`
and count toward AI usage by feature ("By feature" in the usage views); see
[In-app assistant](assistant.md#cost-saved-never-recomputed).

## Chat: attachments, tools, drafts, pruning

**Attachments.** The assistant composer accepts up to 20 images per message (paperclip,
drop or paste; JPEG, PNG, WebP, HEIC family; 15 MB each). Files are uploaded first
(`POST /api/blob/schools/:schoolId/assistant/attachments`, browser session only, origin
checked, 60 per minute per IP) and become `assistant_attachment` rows with the same
derivatives as pages; a message then carries ids, never bytes. At most 40 unsent
attachments per user per school. Taking an image out of the composer deletes it
(`DELETE .../attachments/:attachmentId`, owner and unsent only; an upload that
finishes after its tile was removed is deleted too); an upload that finds the user at the
cap first frees that user's unsent images older than an hour (left by a reload);
unsent ones are deleted after 24 hours, the rest with their conversation and with the
school. Objects are deleted before their row, so a failed storage delete leaves the row
for the sweep to retry (the sweep also collects attachments of deleted conversations). A model that cannot read a file type (HEIC
on Anthropic) makes the send fail with a message asking the user to convert it (D46);
images are never silently dropped.

**Tools** (advanced MCP tools, module `exams`; reachable by external MCP clients through
the advanced-tool meta tools and by the in-app assistant): `listQuestionPapers`,
`getQuestionPaper`, `listQuestionPaperVersions`, `learn_question_paper_generation`,
`validateQuestionPaperDraft` and `saveQuestionPaperVersion` (a write, so the in-app
assistant asks the user to approve). The other eight procedures are *hidden* (human
only): page photos, generation, polling, previews and downloads.

- `learn_question_paper_generation` returns the guide, the provider JSON Schema, the
  limits and both examples on demand, so that no assistant or MCP client carries them
  by default (D36). The assistant's prompt has a single bullet that names it.
- `validateQuestionPaperDraft` checks a document exactly as a save would (and warns on
  marks) and returns a `draftId`. `getQuestionPaper` and the validate tool declare
  `outputChars` 80,000 and the learn tool 40,000, so a paper or the guide is not cut at
  the assistant's default 24,000.
- **Drafts** are not database rows. A draft is the input of a `validateQuestionPaperDraft`
  call in the conversation; the chat shows it as a card (valid or not, Preview, Save as
  new version). Saving by `draftId` is accepted only from the in-app assistant, which
  finds the newest such call of *this conversation, school and user* whose canonical
  content hashes to the id; other clients pass `content`. The agent proposes, the user
  decides: nothing is saved until they ask, and saving creates a new version after the
  usual approval card. Several drafts and older versions can be previewed in chat; the
  `question_paper` view (`show_view`) shows a saved version with Preview and Download.
- A chat attachment can be a **figure**: the agent puts its `asat_` id in a figure block;
  validation and previews accept it only for the in-app assistant's own user, only when
  the attachment was sent, belongs to that user and school and decodes; saving copies
  it once into the paper (`qpf_` ids are what is stored).
- **Continue in chat** (the quiet link under a result) opens
  `/school/:id/assistant?seed=question_paper&sessionId=&examSlug=&classId=&subjectSlug=&modeSlug=`:
  a new conversation seeded with the paper's natural key (no personal data) and a
  prefilled box. Nothing is sent until the user sends. A malformed link (parts are limited
  to Unicode letters, digits, `.`, `~`, `-` and `_`; no spaces, quotes or brackets) silently becomes a plain new conversation; the send
  refuses a seed that does not resolve to a paper of the school
  (`resolvePaperScope`) before it reaches the model, and the chip says so when the
  paper cannot be opened.
- **Context pruning** (`runtime/context.ts`, applied to what the model sees only, never
  to the stored transcript): only the last two human messages are sent in full. In older
  turns a tool result of 8,000 characters or more is replaced by a short stub naming the
  tool and the size, and an older attachment by a note asking the user to attach it
  again; fresh images are sent newest first within a 16 MiB budget counted as base64 (4/3 of the file, under Gemini's 20 MB request limit); an image over the provider's own cap (5 MB on Claude) is reported as unreadable. The learn payload
  counts as a long result, so after two more messages the agent calls the tool again.

## Where the code is

| Area | Where |
| --- | --- |
| JSON schema, limits, marks, guide, examples | `packages/question-paper` |
| Tables, enums, ids | `packages/db/src/schema/exam-question-paper.ts`, `assistant.ts` |
| Router, services, renderer, README | `packages/api/src/routers/school/question-paper` |
| Generation job | `packages/api/src/workflows/question-paper`, served by `apps/worker` |
| HTTP upload and read routes | `apps/server/src/http.ts` (page photos), `packages/assistant/src/attachments.http.ts` (chat images) |
| Template, marketplace designs, slot | `packages/api/src/routers/school/document` (`document.catalog.marketplace.ts`, `question-paper.slot.ts`) |
| Model call (providers) | `packages/assistant/src/question-paper-model.ts`, `providers/*` |
| Chat contract, cards | `packages/assistant-contract`, `packages/components/src/question-paper/chat-cards.tsx` |
| Management UI | `apps/management/components/question-paper`, `packages/components/src/question-paper`, routes under `exam/[examSlug]/question-paper` |
| Demo seed | `packages/api/src/workflows/demo-school` (`seed/question-papers.json`, `seedQuestionPaper`) |

## Demo schools

A demo school gets two papers (see [Demo schools](demo-school.md#question-papers)): an
English science paper and a Hindi mathematics paper, each with two synthetic page
images and version 1 printed with a seeded `question_paper` template. The assistant
stays off in a demo, so the tab is invisible until an admin enables it; the seed
therefore calls the service functions, not the procedures.

## Extending

- **A field in the JSON**: change `schema.ts` and `limits.ts`, bump nothing unless the
  stored shape changes incompatibly (then bump `QUESTION_PAPER_SCHEMA_VERSION` and keep
  reading the old one), update `normalize`, `walk`/`marks`, the provider schema (its
  tests walk the references), the renderer (`question-paper.body.ts` and its tests),
  the guide and both examples. Old versions keep their stored JSON and must keep
  rendering.
- **A block or run type**: also the renderer's fixed vocabulary and CSS. Never let
  a JSON value become markup, a URL, a class or CSS.
- **A marketplace design**: add it to `document.catalog.marketplace.ts` with the slot
  exactly once (the catalog test asserts it) and a footer that follows the layout
  rules in [Document system](document-system.md#question-papers).
- **A job failure**: add its code and safe text to `QUESTION_PAPER_JOB_FAILURES`; the
  UI shows the stored message.
- **A chat tool**: add the procedure with `tool(...)` metadata in the router, keep
  hidden what a human must do, set `outputChars` when its answer can be long, update
  the MCP catalog counts test, and the learn guide if agents need to know about it.
- **A new place that reads or writes papers**: go through the services (they hold the
  lock and the lifecycle rules), check the OPA action and the assistant gate in that
  order, and keep S3 keys under `schools/{schoolId}/`.
- **A new school-owned table or object**: cover it in the demo seed if a school user
  would see it, and in `purge_demo_school`.

## Verification

- `packages/question-paper`: `pnpm --filter @campuspilot/question-paper test` (schema,
  normalisation, marks, provider schema, sha256).
- API (needs the test database, S3 and Gotenberg): `pnpm --filter @campuspilot/api exec
  vitest run --project school-scoped src/routers/school/question-paper
  src/workflows/question-paper src/workflows/demo-school src/files` covers router and
  permissions, pages, the document system, chat attachments, the generation workflow with
  a scripted model, the sweep, the demo seed and the demo purge.
- Providers and chat: `pnpm --filter @campuspilot/assistant exec vitest run --project unit`
  and `--project integration` (structured requests, attachments, context pruning).
- `apps/server`: `src/mcp-catalog.test.ts`, `src/mcp.test.ts` (tool counts, approval,
  hidden procedures, output limits).
- UI: `pnpm --filter @campuspilot/components test`; `apps/management/docs/ui-patterns.md`
  lists the browser checks (mobile 320 and 390 px, uploads, reorder, generation,
  chat cards).
- Not testable without keys: a real provider call. The first one is a smoke test
  with a real key (does Anthropic's tool search find the learn tool from its name; does
  each provider accept the schema; handwriting quality; 20 images within request limits).
