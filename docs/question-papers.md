# Question papers

AI-assisted question papers: a teacher photographs a handwritten paper (or
describes it to the assistant in chat, which writes the questions itself), and CampusPilot turns it into an HTML
fragment that prints on the school's own letterhead. This is the canonical
guide. Template and rendering rules shared with the other document
types are in [Document system](document-system.md#question-papers); the chat
side of the assistant is in [In-app assistant](assistant.md).

Read this before changing the `exam_question_paper_*` tables, the
`question-paper` router or its MCP tools, the fragment vocabulary and limits
(`packages/question-paper`), the `question_paper_body` sanitiser, the renderer, the generation job
(`packages/api/src/workflows/question-paper`), chat attachments (images and PDFs), the
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
  changes. Every change (a regeneration, a chat edit, a copy of an earlier paper) is a new version; any version
  can be previewed and downloaded. There is no approved or final state, no hand
  editing of a generated paper in the UI and no answer key.
- The **heading and footer come from the school's `question_paper` template**
  (a full document type, see below), never from the AI. The AI only writes the body.
- Three ways in, one set of rules:
  1. **Manual**: the Question paper tab of an examination (photos of the pages, an
     optional note on what to change, *Create paper*, preview, download). Generation is a
     durable worker job. A PDF or a description does not take this path: it starts the
     paper's conversation (see "The paper's screen").
  2. **Chat**: the in-app assistant or an external MCP client reads attached photos
     or an existing paper, writes the HTML itself, validates it, shows drafts and saves
     a new version only when the user says so. No model call is made by the server
     for this path: the agent is the author, the server validates and stores.
  3. **Start from an earlier paper**: a person copies a saved version of another
     paper of the same class and subject (last term's, last session's, another
     mode's) into this paper as a new version, then edits it in chat or generates
     again (`copyQuestionPaperVersion`, see "Starting from an earlier paper").
  All of them end in the same function, `saveQuestionPaperVersion`, so validation (the
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
   download, versions) or `.manage` (upload, reorder, delete, generate, save, copy).
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
   A copy (`listQuestionPaperCopySources`, `copyQuestionPaperVersion`) checks two
   class permissions before the gate: `.manage` on the target paper's class (the
   list too, since it only serves a copy) and `.read` on the source paper's class
   (`readSourceClass`, from `input.source`), so a caller learns nothing about the
   papers of a class they may not read.
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
| `exam_question_paper_job` | One generation: `queued`, `running`, `succeeded`, `failed`; ordered `page_ids` and the `page_revision` it ran on; the teacher's `instructions` (nullable text, migration 0067: null means none, written at creation and never changed); provider, model, request count; `error_code` and the safe `error_message` (and developer-only `error_detail`); hand-over facts (`handed_over_at`, attempts, last error). A partial unique index allows one queued or running job per paper |
| `exam_question_paper_version` | Immutable: `version_no`, the sanitised fragment `content_html` (text), its sha256, `source` (`agent`, `ai_job` or `copy`) with the job id, page ids, conversation id or `source_version_id` (the copied version), `plan_max_marks` (the header snapshot), `warnings` (sanitiser notices, below), the pinned `template_revision_id` and the `pdf_artifact_id` |
| `exam_question_paper_figure` | An uploaded image a version prints (JPEG, or PNG up to 400 KB when it has transparency), owned by the paper, deduplicated by `source_attachment_id` (a chat image) or `source_figure_id` (a figure of a copied version); at most one of the two is set |
| `assistant_attachment` | A chat attachment, an image or a PDF by its `kind` (below) |
| `assistant_model_request` | The job's cost rows: `source = 'question_paper'`, `question_paper_job_id`, no chat run |

**Migration 0064** (`question-paper-html-fragment`) moved versions from the structured JSON to
the fragment: `content jsonb` became `content_html text`, and `schema_version` and `total_marks`
were dropped. `plan_max_marks` stays (it is the plan's maximum at save time, not a computed
total). `warnings` stays but now holds notices `{ code, message }` (code `sanitised`; the
migration resets old entries). The JSON model never shipped, so existing rows (development
data) keep their PDF and get a one-line placeholder fragment and one `legacy` notice ("Saved
in an earlier format. The preview is not available; the PDF is the original."), which the
version list, card and preview show like any notice; generating the paper again adds a proper
version.

**Migration 0065** (`question-paper-copy`) added the `copy` source, `source_version_id` on versions
and `source_figure_id` on figures. `source_version_id` is a foreign key to the copied version
`ON DELETE SET NULL`: the source paper can be deleted later (by `deleteQuestionPaper`,
`deleteExamPlan` or the demo purge) and the copy must survive, so the reference may neither cascade
nor block that delete; the copy never needs the source again (its fragment is stored and its figures
were copied). After such a delete the version is still `source = 'copy'` with a null
`source_version_id`; a check allows `source_version_id` only on a copy. `source_figure_id` is a plain
value (no foreign key), like `source_attachment_id`.

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
- **Generation** (manual only, optionally with the teacher's instructions on what to change). See "The generation job".
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
- **Copy.** See "Starting from an earlier paper".
- **Delete.** `deleteQuestionPaper` (refused while a job is in flight) and
  `deleteExamPlan` delete the rows (pages, jobs, versions, figures cascade), the
  PDF artifacts and, after the commit, every stored object (best effort, logged).
  Template revisions are shared and stay.
- **Concurrency.** Everything that changes a paper's pages, jobs or versions runs
  under a `FOR UPDATE` lock of the paper row. While a job is in flight, page changes
  and deleting the paper are CONFLICT.

## Starting from an earlier paper

A teacher starting the paper of (session, exam, class, subject, mode) can begin from a paper the
school already saved, for example last term's or last session's paper of the same class and subject.
The earlier paper never changes. Code: `question-paper.copy.ts` (listing, key rules, figure copying)
and `copyQuestionPaperVersion` in `question-paper.version.service.ts`.

- **What may be copied.** A saved version of another paper of the **same school, class and
  subject**, from any session, exam and mode. A class is a school-level row (`class` has no session
  column; plans and papers name it by `class_id` in every session), so the same class in an earlier
  session is the same `class_id`: an exact match, never a guess by name. The subject is the same
  `subject_slug`. A class that was replaced by a new row (a different `class_id`) is not matched.
- **`listQuestionPaperCopySources(paperKey)`** (read) lists those papers that have at least one
  saved version, never the target itself, newest saved first (at most 100). Each entry: `key` (the
  source's natural key), `sessionLabel` ("2025–26"), `sessionActive`, `examName` and `modeName` (as
  configured today, the slug when no longer configured), `latestVersionNo`, `savedAt` and
  `planMaxMarks` of that latest version (its snapshot).
- **`copyQuestionPaperVersion({ ...targetKey, source: { ...sourceKey, versionNo }, expectedVersionNo })`**
  (write) saves a NEW version of the target through `saveQuestionPaperVersion` with source `copy`:
  the target must be writable (active session, exam not completed, `paper_locked` otherwise),
  `expectedVersionNo` is the target's token (CONFLICT exactly as for an agent save), the stored
  fragment is cleaned and checked again (a stricter profile applies to it; what it removes becomes
  the new version's notices), the school's **currently selected** template prints it and
  `plan_max_marks` is the **target** plan's maximum (a header snapshot of the paper being saved). No
  model is called, so a school at its monthly AI limit can copy.
- **Refusals** (`data.reason`): `copy_source_mismatch` (BAD_REQUEST: another school, class or
  subject), `copy_source_is_target` (BAD_REQUEST), `copy_source_not_found` (NOT_FOUND: no such
  source paper or version, or it was deleted before the copy committed), `copy_figure_unavailable`
  (BAD_REQUEST, below), plus every refusal of a save (`paper_locked`, `plan_mode_removed`,
  `QUESTION_PAPER_TEMPLATE_MISSING`, CONFLICT, an invalid fragment).
- **Figures.** A source fragment prints figures owned by the source paper (`qpf_` ids), and the
  renderer only loads figures the paper being printed owns. The copy therefore copies each one into
  the target first (`copySourceFigures`): every id must be a figure row of the source paper; each
  object is read and checked against the row's size and sha256, and the target's 30 figure cap is
  checked for the whole set, **before anything is written**. The bytes are stored unchanged (they were
  normalised when the source figure was made) as new target figures under
  `schools/{schoolId}/exam-question-papers/figures/{figureId}`, with `source_figure_id`, and the ids in
  the fragment are rewritten; a figure the target already copied from the same source figure is
  reused. Any figure that cannot be copied refuses the copy with `copy_figure_unavailable` and no
  version: a copy never prints "Figure unavailable". Placeholders stay placeholders. As with chat
  attachments, figures copied for a version that is then refused (the target changed or locked in
  between) stay on the target unused and go with it.
- **Locks.** The save transaction is the usual one (session `FOR SHARE`, the target plan `FOR SHARE`,
  the target paper `FOR UPDATE`); it then reads the source version `FOR KEY SHARE`, so a source
  deleted while the copy rendered is refused (`copy_source_not_found`) rather than violating the
  foreign key. Nothing locks the source paper.

## The HTML fragment

The model's output, and what a version stores, is an HTML **fragment**: the body of the paper
only (no `<html>`, `<head>`, doctype or code fence; the extractor and the sanitiser tolerate
them). There is no JSON schema, no provider structured-output mode and no model of the paper's
meaning: the server never reads the number of questions, the marks or the language back out of
it. `packages/question-paper` holds what is shared by the API, the worker and the browser:

- `limits.ts`, the one place for every number: 80,000 characters of fragment (a longer answer
  is refused, never cut), 120,000 characters parsed at most (unclosed nesting costs the parser more than its length, so the cap is what keeps one call under about 150 ms), 8,000 elements, 40 SVGs and 4,000
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
text equal to their cleaned form with no out-of-flow `position`; its tag separators are the five ASCII
whitespace characters of the HTML tokenizer only (never JS `\s`, which also matches U+00A0, U+3000 and
others the tokenizer reads as part of a name). The one element whose content the
browser does not read as markup is `<style>`, so it is written exactly `<style>`, never inside an
`<svg>` (a `<style>` there is removed with a notice: its text is parsed as markup and entities are
decoded, which is how sanitize-html's own handling was bypassed), and its text may hold no `<`, `&`
or backslash. Each style element is replaced by an unguessable marker before sanitize-html writes any
text, and its escaped text is cleaned as CSS and written back.

The grammar proves tokens and tag balance, not the tree a browser builds. A browser closes elements
implicitly (a `<li>` start closes the open `<li>` and everything above it, including a `<div>`; a block
start tag closes a `<p>`; a stray `<td>` is dropped; a table gets a `<tbody>`; `<svg><p>` breaks out of
the drawing), so a later `</div>` could pop a different div than the grammar believed and end the
`.qp-body` wrapper, or the template's container, early (review-html-2 M1: the rest of the paper and the
footer then lose their styles). So, once the text is stable and accepted by the grammar,
`question-paper.tree.ts` (`parse5`, pinned to 7.3.0 in `packages/api`) parses it as the browser would,
INSIDE `<div class="qp-body">` followed by a sentinel element, and compares the tree it builds with the
grammar's element list (names and nesting depth, nothing between the wrapper and the sentinel). When they
differ the sanitiser takes the browser's serialisation as the new text and cleans it again, until the
stored text is a fixed point of the real tree builder as well (the same 4-round cap applies; a fragment
that does not settle is refused). The comparison is by structure, not by string, because parse5 writes
`<br>` where the sanitiser writes `<br />`. Moving or adding elements loses nothing and is not reported
(an implied `<tbody>`, the options of a sloppy `<li><div><li>` pulled out as sibling items); an element
the browser would not keep where it was written (a stray `<td>`, a `<col>` outside a table) is removed
with a notice, its text kept. The render runs the same function, so it cannot print a different tree than
was stored. `stats` count the cleaned output only.

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
  (`warnings: [{ code: 'sanitised', message }]`); the only other kind is the `legacy` notice of rows migrated by 0064.

## The paper's screen

One paper's screen in the management app (`components/question-paper`) is one of two views,
decided by `resolveView` from facts that are each their own input (never inferred from one
another): the first screen asked for in the URL, whether a version exists, whether a
generation is in flight, and whether the URL names a conversation.

- **Start** (`QuestionPaperStart`): one card in a centred column, in the shape of the
  assistant's message box beside which the paper is later changed. It holds what the paper
  is made from, an optional note, and one button, *Create paper*. Nothing has to be typed
  and nothing has to be chosen first: the card never opens on a list of options. The rules
  are pure functions in `question-paper-start-model.ts` (`sortSourcePicks`, `createPlanOf`).
  A paper is made from **one source**:
  1. **Photos** (the default). The paper's stored pages are a row of page-shaped, numbered
     tiles (`PaperSourceTray`), so what was added sits where it was added. Every way to add
     stays with them: from `sm` up the row ends in two dashed tiles of the same shape, *Add
     pages* and *Take a photo*; on a phone those are two buttons under the tiles. With no
     photo yet, a dashed *Choose files* tile stands beside "Add the paper" and the buttons
     *Take a photo* and *Copy an earlier paper*. A phone takes the photo with its own camera
     (a capture input), a computer in a webcam dialog; which one shows is the way's
     `pointer`, a fact kept apart from where the tray draws it, so the two never override
     each other (a test guards it). Photos on their way appear in the row at once and a
     failed one stays marked until dismissed. Pressing a tile opens the page large enough
     to read (`PagePreviewDialog`, the uploaded photo itself, Previous / Next / Remove
     page); a tile is dragged to reorder; removing asks first. On a phone the tiles carry
     no remove mark (removing is in the page viewer) and one caption line says what a tap
     and a hold do. Photos also arrive by drop on the card or paste into the note.
     *Create paper* starts the durable job, with the note as its `instructions`, and opens
     the studio, where the job is followed and the instructions are shown.
  2. **One PDF**, picked or dropped like a photo. It is uploaded as a chat attachment
     (`uploadAssistantAttachment`; the server decides from the bytes that it is a PDF, never
     parses it and never serves it back) and shown as one row with its name and size; it
     has no preview, by that rule. *Create paper* sends it as the first message of the
     paper's conversation (`pdfPaperMessage`, with the note as the user's instructions):
     the model reads the PDF itself. Photos and a PDF never mix, and only one PDF is taken;
     the refusal says what to remove. A Word file is refused with "Save it as a PDF, then
     add the PDF"; refusals show as one alert row that clears when something is added.
  3. **An earlier paper**, chosen in a dialog (`EarlierPaperDialog`,
     `listQuestionPaperCopySources`) and shown as one row named "exam · mode" with its
     session, version, marks and date, and a *Preview* of it as it prints
     (`EarlierPaperPreviewDialog`; on a phone the page can be switched from *Whole page* to
     *Larger text*). It is offered only while the card holds no photo. A copy is the old
     paper as it is, so when it was written for other marks than this paper the card says
     so before the copy is made (`marksMismatchOf`). *Create paper* copies it
     (`copyQuestionPaperVersion`); a note is then sent as the first message of the paper's
     conversation, so the assistant drafts the change on the copy. Without a note the
     studio opens on the new version.
  4. **Only the note**: with nothing else in the card the note is a description, the first
     message of the paper's conversation (`describedPaperMessage`).
  Choosing a PDF or an earlier paper does not delete photos already on the paper; the card
  says they are kept and not used. While one of them is chosen no other way in is shown:
  the card shows the path taken, not the others. The note has a label that stays while the
  user types ("Or describe the paper" on an empty card, "Instructions (optional)" with a
  source) and is one line tall until it is used. *Create paper* is grey while it cannot
  create and the brand colour only when a press will; why it is closed (photos still
  uploading, no template, a completed exam) is written beside it, a failed creation stays
  beside it too and nothing in the card is lost, and once there is something to create the
  line says the result can be changed afterwards. A paper that already has versions
  reaches the same card from its menu (a new version is added; the others are kept).
- **Studio** (`QuestionPaperStudio`): the paper as it prints beside the assistant that
  changes it. Shown once there is a version, a generation at work or a conversation.
  - **Layout.** One paper's screen is a workspace of its own: the exam's heading and tabs
    are not drawn above it (`isQuestionPaperWorkspacePath`; breadcrumbs lead back). From md
    up the studio fills the window under the app's header (`APP_SHELL_FILL_HEIGHT_MD_CLASS`,
    which leaves room for the shell's alert rows): one header row (name, version, PDF,
    menu), then the assistant on the left and the paper on the right, each scrolling inside
    its pane, so nothing is cut off on arrival and the page never scrolls. The paper is the
    sandboxed preview in its `fill` form (`DocumentPreview`), scaled to the pane.
  - The **paper's side** shows the version the URL names; else the assistant's **unsaved
    draft** when the conversation holds one (`unsavedDraftOf`: the newest ready draft of
    this paper with no successful save after it); else the latest version. An unsaved
    draft has one action, *Save as version n*, which sends the same sentence as the draft
    card's Save in the chat (`saveDraftMessage`); the approval that follows is given in the
    assistant like every other change. Nothing on this side is editable: versions are
    immutable and the preview frame stays sandboxed.
  - The **assistant's side** is the paper's own conversation: the ordinary assistant
    (`AssistantChat`) with the paper as its seed from the first message, its own welcome
    words, placeholder and suggestions, and no prefilled sentence. It is recorded as the
    `panel` surface. The conversation's id lives in the URL (`?chat=`), so a reload returns
    to it; without one the next message starts a new conversation. On a phone the paper is
    the screen and the assistant is a full-screen sheet opened from a bar at the bottom.
  - A viewer, a paper whose exam has ended, and a first paper still being generated get the
    paper alone.
- The URL is `?start=sources|earlier` (the first screen for a paper that already has
  versions, and the same with the earlier-paper dialog open, so Back closes the dialog),
  `?version=n` and `?chat=<conversation id>` (`questionPaperWorkspaceHref`). Only the assistant's own ids are read from `chat`
  (`chatIdOf`).
- The paper's menu holds what is not the main task: All versions (a dialog with who saved
  each, when and how, and its PDF), Download latest PDF, Add photos or a file, Copy an
  earlier paper, Delete paper.

## What the UI shows

Draft and version cards, the version list and the Question paper tab show no marks computed from the paper (the tab heading still names the exam plan's maximum marks, a plan fact). A draft card
says whether the draft is ready or can not be saved yet, lists the problems in plain sentences
(`summarizeProblems` maps the API's model-facing lines, such as a formula's LaTeX and KaTeX message,
to sentences like "Formula 2 could not be typeset"; an unknown line becomes a generic sentence;
the raw lines are behind a collapsed "Details"), keeps the sanitiser's `stripped` list behind a
collapsed "N notices" list (one notice per kind of change, the same count the
version list and badge use; the label is generic because a notice can also be the `legacy` one), says how many figures are still placeholders, and offers Preview and Save as new
version. A saved version shows its notice count; its preview lists the notices (collapsed) and
a placeholder note. `previewOutputSchema.placeholderFigures` is
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
body that passes its own cap always fits in the document. The draft check and the print share ONE
budget: `checkQuestionPaperDraft` compares `estimatedBodyBytes` (the very assembly and unit the render
measures, plus the base64 bytes of every placed figure, a figure used twice counted twice) with the
body cap, so formulas and figures that each fit but not together are refused at validate time, not
at print time (the figures keep their own 12 MB cap on top). Work is bounded before it is done: a
declaration list over 4,000 characters, a value over 300 and any attribute over 25,000 are refused
before a pattern runs over them, and no pattern in these files backtracks over a long run (probed
with 160,000 character runs of whitespace, `;`, `@a;`, `}` and digits; tests keep this). The PDF is capped at
`QUESTION_PAPER_LIMITS.pdfPages` (40) pages: Gotenberg is asked for pages `1-41` (so the work is
bounded) and a result with a 41st page is refused with a clear BAD_REQUEST (`paper_unprintable` in
the job), never cut. The page count is known only after Gotenberg lays the paper out, so validate and
preview do not show it (they must not depend on the converter or wait on it) and the job does not
repair it; the refusal at save is the check; question paper conversions time out after 60 seconds (other documents 120).

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

**The teacher's instructions.** `startQuestionPaperGeneration` takes an optional
`instructions` string, a short note on what to change ("Keep the questions but change the
numbers", "Make section B easier", "Type it in Hindi", "Leave out question 7"). The input
schema (`generationInstructionsSchema`) turns CR and CRLF into `\n` and trims; an empty or
whitespace-only value is none; the rest may be at most
`QUESTION_PAPER_GENERATION_INSTRUCTIONS_MAX_CHARS` (2,000, UTF-16 code units, exported from
`question-paper.dto.ts` for the UI); any other control character (C0 except tab and line
feed, DEL, C1) is **refused, never stripped**, so what is stored and sent is exactly what the
teacher wrote. Format characters such as the zero-width joiners Indian scripts need pass. The
text is its own fact on the job row (`instructions`, null for none), written when the job is
created and never changed; it changes no check, permission, limit or cost.
`getQuestionPaperDetail` returns it on `activeJob` and `lastFinishedJob` (`instructions:
string | null`) so the screen can show what was asked; `getQuestionPaper`, which agents read,
keeps its job shape. A version a job saved keeps `source = 'ai_job'` and `source_job_id`; the
instructions are read through that job (no copy on the version, which would be a second
record of the same fact). They are the words of an authorised staff member but untrusted
text for the model:

- Without instructions the job sends exactly the transcription prompt and user turn
  (`QUESTION_PAPER_JOB_SYSTEM_PROMPT`, `buildGenerationParts`).
- With them the system prompt is `QUESTION_PAPER_JOB_INSTRUCTED_SYSTEM_PROMPT`: the
  photographed pages are the source, the instructions say what to change, and the Fidelity
  rules (order, numbering, language, marks, "[illegible]", nothing invented) hold for
  everything they do not ask to change. Its output, figure, template and vocabulary sections
  (animation rule first) are the same text as the transcription prompt's, and it says the
  instructions change the paper's content only and never these rules; a part that asks for
  something else (Markdown, a script, an animation, the school's heading) is ignored. Text in
  the photographs stays data.
- The instructions travel only in the user turn, after the pages, as their own text part:
  a labelled line, the instructions as **one JSON string** (a delimiter that cannot be closed
  from inside: quotes and line breaks are escaped) and a closing line.
- The repair request does not send them again: the previous fragment already carries them
  out and the repair changes only the listed problems, so sending them again would invite
  applying them twice ("change the numbers" twice). It adds one sentence to keep the changes
  they made, and uses the instructed system prompt.
- The worker reads the instructions from the job row in the begin step (journaled with the
  job's other facts), so every request, retry and attempt of the job sends the same text.
  Deploy the worker with or before the API: an older worker ignores the column.

The workflow (`workflows/question-paper`, ingress-private, steps shared with the
integration tests in `generation.ts`): begin, re-check access and the paper
(limit, feature, role, exam not ended), gather inputs (every page has a readable
source, at most 16 MiB of images counted as base64, the same budget as the chat), **one plain
text model request** (system prompt with the shared fragment rules; the pages in order as
"Page i of n" and the image, then the teacher's instructions when there are any; its cost row is saved inside that same step; a repeated billed call
takes the next `:attempt:{k}` key derived from the saved rows, never dropped), then check the
answer: extract the fragment (`extractQuestionPaperFragment`: strip code fences and a doctype),
sanitise and validate it (`checkQuestionPaperDraft`: non-empty, within the caps, formulas typeset;
a `data-figure-id` that cannot be resolved becomes a placeholder, because the job can attach no
images), at most one **text-only repair request** (the previous fragment and the problems, no
pages), save through `saveQuestionPaperVersion` with source `ai_job` (the sanitiser's
`stripped` lines become the version's notices), mark succeeded. Provider failures retry (busy or
unknown up to 3 requests); a refusal fails without repair and an answer that stopped on the output
limit fails as `output_too_long`. The provider must give a POSITIVE completion signal (Gemini
`STOP`, Claude `end_turn`/`stop_sequence`): any other or missing finish reason sets `TextResult.unfinished` (named for what is known: the answer did not positively finish), which the job treats as cut off. An answer
with no HTML element in it (an apology) fails as `model_rejected` without repair; text before the first
or after the last element, or an answer that cleans to no block element and readable text, is a repair
problem. A tag that is not an HTML or SVG element at all (`<thinking>`, `<analysis>`: the tag would be
dropped and its text printed as part of the paper) and text between top-level elements are repair
problems in the job too (`strictStructure` of `checkQuestionPaperDraft`; a person's draft only gets
a notice), while a real HTML element the profile does not allow (`<section>`) is unwrapped as before.
A refusal or a remark written INSIDE an allowed element (`<p>I cannot help with that.</p>`) cannot be
told from a paper by code without a list of phrases, so it is not detected; the reviewing person is
the check. Every step checks
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

**Attachments.** The assistant composer accepts up to 20 files per message, images and
PDFs together (paperclip, drop or paste; JPEG, PNG, WebP, HEIC family up to 15 MB, PDF up
to 10 MB; Word and other files are refused with a sentence that says to save them as PDF).
What a file is comes from its bytes, never its name (`kind`: `image` or `document`; the
canonical rules, limits and provider docs are in [In-app assistant](assistant.md#attachments-question-paper-tools-and-context-pruning)).
Files are uploaded first (`POST /api/blob/schools/:schoolId/assistant/attachments`,
browser session only, origin checked, 60 per minute per IP) and become
`assistant_attachment` rows: an image with the same derivatives as pages, a PDF as one
object stored exactly as uploaded (never parsed, rendered or served back to a browser;
it shows as a tile with its name and size). A message then carries ids, never bytes. At
most 40 unsent attachments per user per school. Taking a file out of the composer deletes
it (`DELETE .../attachments/:attachmentId`, owner and unsent only; an upload that
finishes after its tile was removed is deleted too); an upload that finds the user at the
cap first frees that user's unsent files older than an hour (left by a reload);
unsent ones are deleted after 24 hours, the rest with their conversation and with the
school. Objects are deleted before their row, so a failed storage delete leaves the row
for the sweep to retry (the sweep also collects attachments of deleted conversations). A
model that cannot read a file type (HEIC on Anthropic, a PDF on a provider without
document support) makes the send fail with a message that says what to attach instead
(D46); files are never silently dropped. A PDF reaches the model as the PDF itself (Gemini
inline `application/pdf`, Claude a `document` block); a PDF the provider refuses (too
many pages, a password) fails the turn with a sentence about the PDF.

**Tools** (advanced MCP tools, module `exams`; reachable by external MCP clients through
the advanced-tool meta tools and by the in-app assistant): `listQuestionPapers`,
`getQuestionPaper`, `listQuestionPaperVersions`, `getQuestionPaperDraft`,
`learn_question_paper_generation`, `validateQuestionPaperDraft` and `saveQuestionPaperVersion` (a write, so the in-app
assistant asks the user to approve). The other ten procedures are *hidden* (human
only): page photos, generation, polling, previews, downloads and starting from an earlier paper
(`listQuestionPaperCopySources`, `copyQuestionPaperVersion`: a button of the paper screen; an agent
already reads any paper it may read with `getQuestionPaper` and saves its own edit, and could not
use the source's `qpf_` figure ids, which a save refuses).

- `learn_question_paper_generation` returns the guide (vocabulary, formulas as `data-math`,
  figures, scripts through `lang`, the NO ANIMATION rule), the limits and one worked example
  (an HTML fragment) on demand, so that no assistant or MCP client carries them by default
  (D36). The assistant's prompt has a single bullet that names it.
- `validateQuestionPaperDraft({ html })` checks a fragment exactly as a save would and returns
  `{ valid, problems[], stripped[], draftId, placeholderFigures, characters }`. It **never echoes
  the fragment** (the model has it; `draftId` names it) and lists at most 40 lines of each kind,
  each at most 400 characters, with "and N more" as the last line (`leanLines`).
- `getQuestionPaperDraft({ ...paper key, draftId })` is the way back to an **unsaved** draft
  (read-only, in-app assistant only: a client without a chat is refused like a `draftId` on save).
  It finds the draft exactly as save-by-`draftId` does (the newest `validateQuestionPaperDraft`
  call of this conversation, school and user whose canonical html hashes to the id) and returns
  `{ paper, draftId, html, characters }`: the paper's facts (including `latestVersionNo`, the
  `expectedVersionNo` of a save) and the draft *cleaned*, so it is at most the fragment limit and
  is what a save would store. A saved paper is read with `getQuestionPaper`. It declares the same
  `outputChars` as `getQuestionPaper`.
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
  collapsed "Replaced by Draft N" line (opening it shows the draft as it was; a Save requested for it stays
  visible next to the line); a later draft counts when it is ready by its stored check or, when that
  was cut at 4,000 characters, by the re-check the chat makes for it. "Save as new version" sends "Save draft {id} as a new version
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
  the attachment was sent, belongs to that user and school, is an image and decodes; saving copies
  it once into the paper (`qpf_` ids are what is stored). A **PDF is never a figure**: its id
  as a `data-figure-id` is a problem line ("<name> is a PDF the user attached, not an image ...
  Read it as source material; for a picture inside it write `<figure data-placeholder="...">`,
  or ask the user to attach that picture as an image", `documentFigureProblem` in
  `question-paper.attachments.ts`), a preview prints nothing, and a save refuses it.
- **A seeded conversation.** The paper's own screen starts its conversation with the
  paper as the seed (see "The paper's screen"). The assistant page also still accepts a
  seed in its address, although nothing in the app links to it any more:
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
  the image or PDF is no longer visible (see "Attachment ids" below). The same applies to the
  *inputs* of older tool calls: a top-level text field of 4,000 characters or more (the `html` the model
  wrote into `validateQuestionPaperDraft` or `saveQuestionPaperVersion`) becomes a stub that names
  the field, the tool and the size and points at what still works. The call, its id, its name and
  its short fields are untouched, so every call keeps its result; the stored transcript keeps the
  full text, which is what a `draftId` is resolved from when the user saves, and the stub names the way back
  for the tool that wrote it: for a `validateQuestionPaperDraft` input, `getQuestionPaperDraft`
  with the draft id in that call's result (an unsaved draft) or `getQuestionPaper` (saved since);
  for a `saveQuestionPaperVersion` input, `getQuestionPaper`; for any other tool it only says to
  write the text again and mentions no draft id. The stub also says it is not the content and
  must never be sent as `html` (a model that copies it sends text without markup, which the draft
  check refuses as an empty paper). A validate result over 8,000 characters is itself stubbed
  once old, so the draft id is then found by calling the tool again or re-validating. Fresh images and PDFs are sent newest first within one 16 MiB budget counted as base64 (4/3 of the file; `MODEL_REQUEST_ATTACHMENT_BUDGET_BYTES`, well under both providers' request limits); an image over the provider's own cap (5 MB on Claude) is reported as unreadable. The learn payload
  counts as a long result, so after two more messages the agent calls the tool again.

- **Attachment ids.** The model must be told each attachment's id or it cannot write a
  `data-figure-id`. Every image part is preceded by a server-built line
  `[Attachment asat_...: <sanitised file name>, image/png (1 of 2). Use this id as data-figure-id on an <img> to put the image in a question paper.]`
  (`attachmentLabel` in `runtime/context.ts`, used by the Anthropic, Gemini and fake
  adapters alike): only the generated id, the sanitised name (brackets and line breaks removed)
  and the content type, never user free text. A PDF's line ends instead with "It is a PDF
  document: read it as source material. It is not an image and cannot be used as
  data-figure-id.", and the guide (`learn_question_paper_generation`) says the same. Notes for attachments that are not shown
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
| Starting from an earlier paper (listing, key rules, figure copying) | `question-paper.copy.ts`; `copyQuestionPaperVersion` in `question-paper.version.service.ts` |
| Generation job | `packages/api/src/workflows/question-paper`, served by `apps/worker` |
| HTTP upload and read routes | `apps/server/src/http.ts` (page photos), `packages/assistant/src/attachments.http.ts` (chat images and PDFs; kind from bytes in `packages/api/src/files/attachment-upload.ts`) |
| Template, marketplace designs, slot | `packages/api/src/routers/school/document` (`document.catalog.marketplace.ts`, `question-paper.slot.ts`) |
| Model call (providers, plain text) | `packages/assistant/src/question-paper-model.ts`, `providers/*` (`generateText`) |
| Chat contract, cards | `packages/assistant-contract`, `packages/components/src/question-paper/chat-cards.tsx` |
| Management UI | `apps/management/components/question-paper` (`question-paper-workspace.tsx` decides the view, `question-paper-start.tsx` the first screen with its rules in `question-paper-start-model.ts`, `earlier-paper-dialog.tsx` the earlier-paper picker, `source-preview-dialogs.tsx` the page viewer and the earlier paper's preview, `question-paper-studio.tsx` the paper beside its assistant, `use-paper-assistant.ts` the paper's conversation), `packages/components/src/question-paper`, routes under `exam/[examSlug]/question-paper` |
| Demo seed | `packages/api/src/workflows/demo-school` (`seed/question-papers.json`, `seedQuestionPaper`) |

## Demo schools

A demo school gets two papers (see [Demo schools](demo-school.md#question-papers)): an
English science paper and a Hindi mathematics paper, each with two synthetic page
images and version 1 (the two worked examples: Hindi, maths, an inline SVG, a figure placeholder)
printed with a seeded `question_paper` template. The assistant
stays off in a demo, so the tab is invisible until an admin enables it; the seed
therefore calls the service functions, not the procedures. The seed has no copied version: each
seeded paper is a copy source for the same class and subject in any other exam (the list shows it
once the tab is visible).

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
  attachments, starting from an earlier paper (`question-paper.copy.integration.test.ts`: listing,
  copied and re-owned figures, permission order, locks, conflicts, another school, the AI limit,
  deletes), the generation workflow with a scripted model, the sweep, the demo seed and the
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
