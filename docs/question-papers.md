# Question papers

AI-assisted question papers: a teacher photographs a handwritten paper (or
dictates it to the assistant in chat), and CampusPilot turns it into an HTML
fragment that prints on the school's own letterhead. This is the canonical
guide. Template and rendering rules shared with the other document
types are in [Document system](document-system.md#question-papers); the chat
side of the assistant is in [In-app assistant](assistant.md).

Read this before changing the `exam_question_paper_*` tables, the
`question-paper` router or its MCP tools, the fragment vocabulary and limits
(`packages/question-paper`), the `question_paper_body` sanitiser, the renderer, the generation job
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
- A **version** is the HTML fragment (below) plus a stored PDF. It never
  changes. Every change (a regeneration, a chat edit) is a new version; any version
  can be previewed and downloaded. There is no approved or final state, no hand
  editing of a generated paper in the UI and no answer key.
- The **heading and footer come from the school's `question_paper` template**
  (a full document type, see below), never from the AI. The AI only writes the body.
- Two ways in, one set of rules:
  1. **Manual**: the Question paper tab of an examination (upload, reorder,
     *Generate with AI*, preview, download). Generation is a durable worker job.
  2. **Chat**: the in-app assistant or an external MCP client reads attached photos
     or an existing paper, writes the HTML itself, validates it, shows drafts and saves
     a new version only when the user says so. No model call is made by the server
     for this path: the agent is the author, the server validates and stores.
  Both end in the same function, `saveQuestionPaperVersion`, so validation (the
  sanitiser, limits, formulas, figures), rendering and printing are identical.
- **Nothing computes or checks marks.** The paper prints the marks its author wrote;
  there is no total, no comparison with the exam plan and no marks warning. The plan's
  maximum marks reach the printed paper only through the school's template header
  (`questionPaper.maxMarks`), a snapshot kept on the version (`plan_max_marks`).
- Images **inside** a paper come only from uploaded images. Image links are not
  supported. A diagram the AI cannot reproduce becomes a **figure placeholder**
  (`<figure data-placeholder="...">`, a labelled dashed box); the user attaches the real
  image in chat and a new version prints it. A simple geometric diagram may be an inline SVG. The manual screen never embeds images: that is chat's job.
- Languages and scripts: Hindi and other Indian languages, Urdu (right to left)
  and mathematics (LaTeX through KaTeX) are first class. The fragment states its language and
  direction itself, per element (`lang`, `dir`); the server reads neither back out of it.

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
| `exam_question_paper_version` | Immutable: `version_no`, the sanitised fragment `content_html` (text), its sha256, `source` (`agent` or `ai_job`) with the job id, page ids or conversation id, `plan_max_marks` (the header snapshot), `warnings` (sanitiser notices, below), the pinned `template_revision_id` and the `pdf_artifact_id` |
| `exam_question_paper_figure` | An uploaded image a version prints (JPEG, or PNG up to 400 KB when it has transparency), owned by the paper, deduplicated by `source_attachment_id` |
| `assistant_attachment` | A chat image (below) |
| `assistant_model_request` | The job's cost rows: `source = 'question_paper'`, `question_paper_job_id`, no chat run |

**Migration 0064** (`question-paper-html-fragment`) moved versions from the structured JSON to
the fragment: `content jsonb` became `content_html text`, and `schema_version` and `total_marks`
were dropped. `plan_max_marks` stays (it is the plan's maximum at save time, not a computed
total). `warnings` stays but now holds only sanitiser notices `{ code, message }` (code
`sanitised`); the migration resets old entries. The JSON model never shipped, so existing
rows (development data) keep their PDF and get a one-line placeholder fragment; generating
the paper again adds a proper version.

The PDF of a version is an `artifact` row (`kind: pdf`, `document_type:
question_paper`, class, session and exam filled) under
`schools/{schoolId}/documents/`. `pdf_artifact_id` is `ON DELETE SET NULL`: if the
artifact is ever deleted, the next download prints the version again from its stored
fragment and pinned template and stores the new PDF. Every object lives under
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
- **Save.** `saveQuestionPaperVersion` validates the fragment (`checkQuestionPaperDraft`:
  sanitise, caps, non-empty, every formula typeset, every figure id usable and the figures'
  printed size), stores the **sanitised** fragment, copies chat-attachment figures into the paper, picks the school's currently
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
  locked this way is the BAD_REQUEST with `data.reason = 'paper_locked'`; a plan without the paper's mode is `plan_mode_removed`; a paper
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

## The HTML fragment

The model's output, and what a version stores, is an HTML **fragment**: the body of the paper
only (no `<html>`, `<head>`, doctype or code fence; the extractor and the sanitiser tolerate
them). There is no JSON schema, no provider structured-output mode and no model of the paper's
meaning: the server never reads the number of questions, the marks or the language back out of
it. `packages/question-paper` holds what is shared by the API, the worker and the browser:

- `limits.ts`, the one place for every number: 80,000 characters of fragment (a longer answer
  is refused, never cut), 1,000,000 characters parsed at most, 8,000 elements, 40 SVGs and 4,000
  SVG elements, 30,000 characters of `<style>`, 600 formulas of at most 500 characters, 30
  figures plus placeholders, 500 characters per placeholder description.
- `guide.ts`: the rules a model is told (`QUESTION_PAPER_FRAGMENT_RULES`, shared by the chat
  guide and the job's own prompt so the two never disagree) and `buildLearnPayload`. The
  **NO ANIMATION** rule is the first and loudest rule (below).
- `examples.ts`: two complete worked papers (Hindi mathematics with LaTeX and a matrix, English
  science with an inline SVG, a table and a figure placeholder). They are the guide's example,
  the preview body of template designs and the demo's version 1; tests keep them free of any
  sanitiser notice and of motion.
- `fragment.ts` (`extractQuestionPaperFragment`: the longest fenced block, else the text) and
  `hash.ts` (`canonicalQuestionPaperHtml`: NFC, `\n` line ends, trimmed). The stored `content_sha256` is
  that of the sanitised fragment; the 12-hex **draft id** is that of the fragment as the model wrote it
  (*before* sanitising), so the id of a draft is stable whatever the sanitiser does.

**Vocabulary.** Text and layout: `div span p h1-h6 ul ol li table thead tbody tfoot tr th td
caption colgroup col br hr b i u strong em sup sub figure figcaption`, with `class`, `lang`,
`dir`, `style`, `colspan`, `rowspan` and `start`. `<style>` elements and `style=""` with a CSS
allowlist. Inline `<svg>` limited to `svg g path circle ellipse line polyline polygon rect text
tspan` (not `title` or `desc`: the sanitiser drops them).

- **Formulas** are an empty `<span data-math="LATEX">` (`data-display="true"` for a centred
  equation). The model supplies only the LaTeX string; the server typesets it.
- **Figures.** `<figure data-placeholder="description"></figure>` prints a labelled dashed box.
  An uploaded image is `<img data-figure-id="asat_...|qpf_...">` (no `src`, ever) inside a
  `<figure>`; the renderer swaps in the stored image.
- **Marks, numbering and labels** are plain text the author wrote.

## The sanitiser: `question_paper_body`

The fragment is **untrusted**: photographs and prompts can steer a model, so everything it
writes is treated as hostile. `question-paper.sanitize.ts` (with `question-paper.css.ts`) is the
`question_paper_body` profile on the same sanitize-html base as every document
(`document.sanitize.ts`). It runs when a fragment is validated or saved (the stored form is the
sanitised one) and again at every render. Cleaning reaches a **fixed point**: it repeats until its
output stops changing (at most 4 rounds; a fragment that does not settle is refused and nothing is
stored), so the stored value is exactly what the render's second cleaning produces. The result must
then pass the **output grammar** (`question-paper.output.ts`, an exact check that fails closed, run
at save and at every render): lowercase allowlisted tags only, plain double-quoted allowlisted
attributes (no `on*`), no comment/CDATA/doctype, balanced tags, `style=""` attributes and `<style>`
text equal to their cleaned form with no out-of-flow `position`. The one element whose content the
browser does not read as markup is `<style>`, so it is written exactly `<style>`, never inside an
`<svg>` (a `<style>` there is removed with a notice: its text is parsed as markup and entities are
decoded, which is how sanitize-html's own handling was bypassed), and its text may hold no `<`, `&`
or backslash. Each style element is replaced by an unguessable marker before sanitize-html writes any
text, and its escaped text is cleaned as CSS and written back. A parse5 tree-based sanitiser was
considered and not adopted (it needs a new dependency): the grammar check makes the tree the browser
builds irrelevant to safety, because no allowlisted element changes how the tokenizer reads what
follows it except `<style>`. `stats` count the cleaned output only.

- **Forbidden, removed with their content:** `script iframe object embed foreignObject form
  controls link meta base`, SVG `use` and `image`, any event handler attribute, `id`, `xmlns`,
  any `href`/`src`, any URL, `url(...)`, `@import`, `@font-face`, and **all animation and
  motion**.
- **NO ANIMATION.** A paper is printed, nothing moves. SVG `animate`, `animateTransform`,
  `animateMotion`, `set` (and `mpath`, `discard`) are removed with their content and reported in
  their own words; the CSS properties `animation*`, `transition*`, `will-change`, `offset*`,
  `scroll-timeline`, `view-timeline`, `motion*`, `transform` and `filter` and `@keyframes` are
  dropped. A model asked for "an engaging diagram" reaches for SMIL or CSS animation, so the
  guide forbids it first and the sanitiser enforces it. Do not allow any of these to make a design
  look better.
- **CSS.** A property allowlist (layout, spacing, borders, colours, font properties, direction,
  white space); `position` only `static` or `relative`, no `z-index`, no `top/right/bottom/left`, no
  negative margins (a small negative `text-indent` is allowed); fonts only from the installed Noto
  families and the generic ones; values with `url`, `\`, `<`, `>`, braces or `@` are dropped. **Every
  number is checked**, not only lengths: no `calc() min() max() clamp() var() env()`, no exponent
  notation, a cap per unit near an A4 page (`font-size` capped far lower), a cap per property for
  unitless numbers (`line-height` 5, `columns` 6, `flex` 20, grid `repeat()` 12 and at most 40
  tracks, ...); SVG geometry, sizes and `stroke-dasharray` are bounded the same way. The converter's
  page cap is the second line of defence (see Budgets). **Every selector is rebuilt from validated
  parts and prefixed with the body wrapper class and a descendant combinator** (`.qp-body .x`), so a
  rule matches only inside the paper and cannot restyle the school's heading or footer; an authored
  `.qp-body ~ *` or `.qp-body + p` is not a prefix and is dropped. An already prefixed selector has
  that one prefix removed before it is parsed and added again (idempotence). Class names starting
  `qp`, `katex` or `question-paper` are reserved (the built-in designs' `qpc-*`/`qpk-*` classes
  start with `qp`): they are removed from `class` attributes and refused in selectors.
- **Caps** (limits above) are reported as `problems`: they block, and nothing is silently cut.
- **Two kinds of finding.** `stripped` is what was removed or changed ("The event handler
  "onclick" was removed (2 times)"); it never blocks, the paper saves without it. `problems` is
  what makes the paper unusable (a cap, an empty paper, a formula KaTeX rejects, an unusable
  figure id, figures too large to print). The version stores `stripped` as its **notices**
  (`warnings: [{ code: 'sanitised', message }]`); there are no other kinds of notice.

## What the UI shows

Draft and version cards, the version list and the Question paper tab show no marks computed from the paper (the tab heading still names the exam plan's maximum marks, a plan fact). A draft card
says whether the draft is ready or can not be saved yet, lists the problems in plain sentences
(`summarizeProblems` maps the API's model-facing lines, such as a formula's LaTeX and KaTeX message,
to sentences like "Formula 2 could not be typeset"; an unknown line becomes a generic sentence;
the raw lines are behind a collapsed "Details"), keeps the sanitiser's `stripped` list behind a
collapsed "N notices about what was removed" (one notice per kind of change, the same count the
version list and badge use), says how many figures are still placeholders, and offers Preview and Save as new
version. A saved version shows its notice count; its preview lists the notices (collapsed) and
a placeholder note with the Continue in chat link. `previewOutputSchema.placeholderFigures` is
the count (counted from the sanitised fragment; it is not a notice).

## The renderer contract

The body is built by our code from the stored fragment, in this order
(`question-paper.body.ts`, a pure function plus the figure assets the caller loaded):

1. The stored fragment is **sanitised again** with `question_paper_body`. Everything after
   this step works on the sanitiser's output, never on the stored text.
2. `<figure data-placeholder>` becomes the dashed labelled box; `<img data-figure-id>` gets
   the stored image as a data URI (the caller loaded only images this paper owns, or the chat
   user's own attachments; a missing one prints "Figure unavailable" and a warning).
3. `<span data-math>` is typeset by KaTeX (`question-paper.math.ts`: HTML output only,
   `trust: false`, no macros, 2 s wall budget). The model supplies only the LaTeX string. A
   formula KaTeX rejects at print time is printed as raw LaTeX in red and reported.
4. The default stylesheet (constants only: Noto fonts chosen by `lang`, spacing, table borders;
   the KaTeX stylesheet with fonts inlined as data URIs, built once per process and added only to
   papers with maths), then the model's scoped `<style>` rules, then the `qp-body` wrapper.

The school's template (`question_paper` document type, full A4 only, no default design:
generation is blocked until the school selects one) places `{{{questionPaper.bodyHtml}}}`
**exactly once, in element content**. The template is rendered with the constant slot
placeholder as that value and sanitised like any other document; only then is the placeholder
replaced by the body (`substituteQuestionPaperBody`, `indexOf` and slicing, never
`String.replace`). Nothing an author writes can reach, repeat or alter the body.

**Deliberate security differences (K1, acknowledged by the product owner), restated for the HTML
trust boundary.**

- The body is *not* sanitised after the template, because the document sanitiser strips the
  inline SVG KaTeX draws roots and arrows with. What makes that acceptable has changed from the
  JSON design: the body is no longer "built from validated JSON". The fragment is a model's
  output and **is untrusted**; it is sanitised twice with the stricter `question_paper_body`
  profile *before* anything is inserted. Only two things are inserted afterwards, and both come
  from our code: KaTeX output made from the formula's plain LaTeX string, and the data URIs of
  figures loaded from this paper's own stored images. The model can influence neither beyond a
  LaTeX string and a figure id. Inline SVG that the model draws is allowed through the profile
  (a safe element and attribute subset, no animation), so the SVG exception is no longer needed
  to explain the fragment itself.
- The CSP of this type, and only this type, adds `font-src data:` so the inlined KaTeX fonts
  load; still no network, no script, no frames, images from data URIs only.
- Do not extend either difference to another type, add a second trusted insertion point (anything
  inserted after step 1), or weaken the profile or the policy for a design without repeating that
  review (`question-paper.slot.ts` and `question-paper.body.ts` carry the same warning).

Budgets: the template alone renders under the notice budget (2,000,000 characters) and may show
the logo at most 3 times; the whole document stays within 25 MB. The body budget is DERIVED from
that (`question-paper.body.ts`): 25 MB minus the template's worst case (2,000,000 characters at 3
bytes plus 3 logo uses at 1 MB), 16 MB, and the figures (inside the body) are at most 12 MB, so a
body that passes its own cap always fits in the document. The PDF is capped at
`QUESTION_PAPER_LIMITS.pdfPages` (40) pages: Gotenberg is asked for pages `1-41` (so the work is
bounded) and a result with a 41st page is refused with a clear BAD_REQUEST (`paper_unprintable` in
the job), never cut; question paper conversions time out after 60 seconds (other documents 120).

A saved version **pins its template revision**: previews and re-downloads use that revision,
never the school's later choice.

The template context (`QuestionPaperContext`, [Document system](document-system.md#question-papers))
has school, session, exam, class, subject and mode names, the plan's `maxMarks` and the version
number. `totalMarks`, `timeAllowed`, `language` and `script` are **always null** and `direction`
is always `ltr`: the paper is free HTML and nothing reads facts out of it. The keys stay only so
template revisions written against the structured paper keep rendering (their `{{#if}}` blocks
print nothing).

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
source, at most 16 MiB of images counted as base64, the same budget as the chat), **one plain
text model request** (system prompt with the shared fragment rules; the pages in order as
"Page i of n" and the image; its cost row is saved inside that same step; a repeated billed call
takes the next `:attempt:{k}` key derived from the saved rows, never dropped), then check the
answer: extract the fragment (`extractQuestionPaperFragment`: strip code fences and a doctype),
sanitise and validate it (`checkQuestionPaperDraft`: non-empty, within the caps, formulas typeset;
a `data-figure-id` that cannot be resolved becomes a placeholder, because the job can attach no
images), at most one **text-only repair request** (the previous fragment and the problems, no
pages), save through `saveQuestionPaperVersion` with source `ai_job` (the sanitiser's
`stripped` lines become the version's notices), mark succeeded. Provider failures retry (busy or
unknown up to 3 requests); a refusal fails without repair and an answer that stopped on the output
limit fails as `output_too_long`. The provider must give a POSITIVE completion signal (Gemini
`STOP`, Claude `end_turn`/`stop_sequence`): any other or missing finish reason counts as cut off. An answer
with no HTML element in it (an apology) fails as `model_rejected` without repair; text before the first
or after the last element, or an answer that cleans to no block element and readable text, is a repair
problem. Every step checks
the job is still `running` for its attempt, so a swept job spends and saves nothing
more; the save transaction itself reads the job row `FOR SHARE` (after the paper lock) and
refuses with `SourceJobEndedError` unless it is `running`, so a job swept at its deadline
while the version renders cannot commit a version afterwards (the job stops quietly). A
plan that loses the paper's mode meanwhile fails the job as `plan_mode_removed`
(`data.reason`), not `paper_unprintable`. A failed job has an `error_code` from `QUESTION_PAPER_JOB_FAILURES` (for the
model path: `model_busy`, `model_error`, `model_rejected`, `provider_unavailable`, `invalid_output`,
`output_too_long`) and a safe `error_message` the page shows; the page polls `getQuestionPaperDetail`.
The job's own system prompt (`prompt.ts`) never enters chat.

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

- `learn_question_paper_generation` returns the guide (vocabulary, formulas as `data-math`,
  figures, scripts through `lang`, the NO ANIMATION rule), the limits and one worked example
  (an HTML fragment) on demand, so that no assistant or MCP client carries them by default
  (D36). The assistant's prompt has a single bullet that names it.
- `validateQuestionPaperDraft({ html })` checks a fragment exactly as a save would and returns
  `{ valid, problems[], stripped[], draftId, placeholderFigures, characters }`. It **never echoes
  the fragment** (the model has it; `draftId` names it) and lists at most 40 lines of each kind,
  each at most 400 characters, with "and N more" as the last line (`leanLines`).
- **Output caps** (`outputChars`, the tool metadata the assistant honours instead of its default
  24,000): `getQuestionPaper` returns the whole fragment as `html` and declares
  `fragmentChars * 2 + 40,000` (the longest allowed fragment with every quote and line end
  escaped in the JSON text, plus pages and the version list), so a long paper is not cut. If a
  result is nevertheless cut the tool appends its "Result truncated" line and the guide tells the
  agent never to submit a paper edited from a cut one. Validate declares 40,000 (it is lean by
  construction); learn 40,000 (guide, limits and example are about 10 KB). The numbers live in
  `question-paper.dto.ts` and are derived from `QUESTION_PAPER_LIMITS`, so raising the fragment
  limit raises the cap; `question-paper.dto.test.ts` pins the relation. Context pruning later
  replaces a long result, and the long text a model wrote into an older tool call, by a stub
  (see "Context pruning"), so a long paper does not stay in the context once it is two
  human messages old.
- **Drafts** are not database rows. A draft is the input of a `validateQuestionPaperDraft`
  call in the conversation; the chat shows it as a card (ready or not, the problems in plain
  sentences, what the sanitiser removed behind a collapsed list, Preview, Save as new
  version). A draft that a *later ready draft of the same paper* replaced shrinks to a quiet
  collapsed "Replaced by Draft N" line (opening it shows the draft as it was); only drafts whose
  stored check can be read count. "Save as new version" sends "Save draft {id} as a new version
  of {Subject (Mode), Class, Exam}." (a draft id hashes the text alone, so the message names the
  paper, and the button is spent only by a request for its own paper). The approval card for
  `saveQuestionPaperVersion` reads "Save Draft 2 as version 4 of ..." with ids, slugs and the version
  counter behind "Details" and the paper text never shown (`approval-summaries.ts`). Saving by `draftId` is accepted only from the in-app assistant, which
  finds the newest such call of *this conversation, school and user* whose canonical
  html hashes to the id; other clients pass `html`. The agent proposes, the user
  decides: nothing is saved until they ask, and saving creates a new version after the
  usual approval card. Several drafts and older versions can be previewed in chat; the
  `question_paper` view (`show_view`) shows a saved version with Preview and Download.
- A chat attachment can be a **figure**: the agent puts its `asat_` id in `<img data-figure-id>`;
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
  tool and the size, and an older attachment by a note that keeps its `asat_` id and says
  the image is no longer visible (see "Attachment ids" below). The same applies to the
  *inputs* of older tool calls: a top-level text field of 4,000 characters or more (the `html` the model
  wrote into `validateQuestionPaperDraft` or `saveQuestionPaperVersion`) becomes a stub that names
  the field, the tool and the size and points at what still works. The call, its id, its name and
  its short fields are untouched, so every call keeps its result; the stored transcript keeps the
  full text, which is what a `draftId` is resolved from when the user saves, and the stub says
  that the call's result still names the draft id. To revise an old paper the agent calls
  `getQuestionPaper` (saved) or writes the whole paper again; it can re-validate to get a fresh
  draft id (a validate result over 8,000 characters is itself stubbed once old, so then only a
  re-validation gives the id again). Fresh images are sent newest first within a 16 MiB budget counted as base64 (4/3 of the file, under Gemini's 20 MB request limit); an image over the provider's own cap (5 MB on Claude) is reported as unreadable. The learn payload
  counts as a long result, so after two more messages the agent calls the tool again.

- **Attachment ids.** The model must be told each attachment's id or it cannot write a
  `data-figure-id`. Every image part is preceded by a server-built line
  `[Attachment asat_...: <sanitised file name>, image/png (1 of 2). Use this id as data-figure-id on an <img> to put the image in a question paper.]`
  (`attachmentLabel` in `runtime/context.ts`, used by the Anthropic, Gemini and fake
  adapters alike): only the generated id, the sanitised name (brackets and line breaks removed)
  and the content type, never user free text. Notes for attachments that are not shown
  (older than the window, over the image budget, unreadable, missing) keep the id too: an
  `asat_` id stays valid for figures while the attachment exists for the same user, whether or
  not its pixels are still visible. An unusable figure id is a validation problem that names the allowed forms
  (`asat_` from an attachment line, or a `qpf_` already saved in the paper); a chat attachment
  is accepted only inside the in-app assistant, anywhere else the agent writes a placeholder.

## Where the code is

| Area | Where |
| --- | --- |
| Fragment limits, guide, examples, fence extraction, hashing | `packages/question-paper` |
| Tables, enums, ids | `packages/db/src/schema/exam-question-paper.ts`, `assistant.ts` |
| Router, services, sanitiser (`question-paper.sanitize.ts`, `.css.ts`), renderer, README | `packages/api/src/routers/school/question-paper` |
| Generation job | `packages/api/src/workflows/question-paper`, served by `apps/worker` |
| HTTP upload and read routes | `apps/server/src/http.ts` (page photos), `packages/assistant/src/attachments.http.ts` (chat images) |
| Template, marketplace designs, slot | `packages/api/src/routers/school/document` (`document.catalog.marketplace.ts`, `question-paper.slot.ts`) |
| Model call (providers, plain text) | `packages/assistant/src/question-paper-model.ts`, `providers/*` (`generateText`) |
| Chat contract, cards | `packages/assistant-contract`, `packages/components/src/question-paper/chat-cards.tsx` |
| Management UI | `apps/management/components/question-paper`, `packages/components/src/question-paper`, routes under `exam/[examSlug]/question-paper` |
| Demo seed | `packages/api/src/workflows/demo-school` (`seed/question-papers.json`, `seedQuestionPaper`) |

## Demo schools

A demo school gets two papers (see [Demo schools](demo-school.md#question-papers)): an
English science paper and a Hindi mathematics paper, each with two synthetic page
images and version 1 (the two worked examples: Hindi, maths, an inline SVG, a figure placeholder)
printed with a seeded `question_paper` template. The assistant
stays off in a demo, so the tab is invisible until an admin enables it; the seed
therefore calls the service functions, not the procedures.

## Extending

- **An allowed element, attribute or CSS property**: change the allowlist in
  `question-paper.sanitize.ts` / `question-paper.css.ts`, with a test that a hostile variant of it
  is still stripped; update `QUESTION_PAPER_FRAGMENT_RULES` (the guide and the job prompt share
  it) and the vocabulary above. Never allow a URL, a reference to another element, an event
  handler or anything that moves; the NO ANIMATION rule is not negotiable. A new kind of thing the
  renderer inserts after the sanitising step (like KaTeX output or a figure) needs the trust review
  in "The renderer contract".
- **A limit**: change `packages/question-paper/src/limits.ts` only. The sanitiser, the guide, the
  learn payload and the assistant output caps read it (`QUESTION_PAPER_PAPER_OUTPUT_CHARS` follows
  `fragmentChars`).
- **A new attribute that carries data for the renderer** (like `data-math`): the model supplies
  plain data, the renderer builds the markup; the sanitiser keeps only validated values.
- **A marketplace design**: add it to `document.catalog.marketplace.ts` with the slot
  exactly once (the catalog test asserts it) and a footer that follows the layout
  rules in [Document system](document-system.md#question-papers).
- **A job failure**: add its code and safe text to `QUESTION_PAPER_JOB_FAILURES`; the
  UI shows the stored message.
- **A chat tool**: add the procedure with `tool(...)` metadata in the router, keep
  hidden what a human must do, set `outputChars` when its answer can be long (derive it from the
  limits, keep results lean), update the MCP catalog counts test, and the learn guide if agents
  need to know about it.
- **A new place that reads or writes papers**: go through the services (they hold the
  lock and the lifecycle rules), check the OPA action and the assistant gate in that
  order, and keep S3 keys under `schools/{schoolId}/`.
- **A stored-format change** (the fragment's meaning, not just a rule): there is no schema
  version. Old versions keep their stored fragment and are sanitised again at every render, so a
  stricter profile also tightens old versions; a looser one must still be safe for them. Plan the
  migration.
- **A new school-owned table or object**: cover it in the demo seed if a school user
  would see it, and in `purge_demo_school`.

## Verification

- `packages/question-paper`: `pnpm --filter @campuspilot/question-paper test` (limits, guide,
  fragment extraction, hashing, sha256).
- API (needs the test database, S3 and Gotenberg): `pnpm --filter @campuspilot/api exec
  vitest run --project school-scoped src/routers/school/question-paper
  src/workflows/question-paper src/workflows/demo-school src/files` covers the sanitiser
  (including a hostile fragment with script, `onerror`, `animate`, `@keyframes`, `url()` and
  `foreignObject`), the renderer, router and permissions, pages, the document system, chat
  attachments, the generation workflow with a scripted model, the sweep, the demo seed and the
  demo purge. The pages integration test replaces the workflow engine's sender with a failing
  fake, so it passes with or without a Restate running next to the database.
- Providers and chat: `pnpm --filter @campuspilot/assistant exec vitest run --project unit`
  and `--project integration` (text requests, attachments, context pruning).
- `apps/server`: `src/mcp-catalog.test.ts`, `src/mcp.test.ts` (tool counts, approval,
  hidden procedures, output limits).
- UI: `pnpm --filter @campuspilot/components test`; `apps/management` runs its tests with
  `pnpm test` (node:test through tsx); `apps/management/docs/ui-patterns.md` lists the browser
  checks (mobile 320 and 390 px, uploads, reorder, generation, chat cards).
- Not testable without keys: a real provider call. Check each provider once with a real key:
  handwriting quality, Hindi, that an answer comes back as plain HTML rather than prose, 20
  images within request limits, and that Anthropic's tool search finds the learn tool from its name.
