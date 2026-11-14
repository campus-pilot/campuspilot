# In-app assistant

The assistant lets staff ask for anything they could do in the management app,
in plain language. Its code is `packages/assistant`, served by the API server
(the browser procedures at `/model/*`) and by `apps/worker` (the durable turn
loop). It knows no CampusPilot business logic: the model reaches school data
only through the API's MCP endpoint, as the signed-in user, with the same
permissions.

## Pieces

| Piece | Where | Owns |
| --- | --- | --- |
| Assistant package | `packages/assistant` | Agent loop and model providers (`src/runtime`), store, live events, the `/model/*` router (`router.ts`, `http.ts`), the outbox (`dispatch.ts`), the signed worker service (`control.ts`, `worker.ts`) |
| Tables | `packages/db/src/schema/assistant.ts` (main migrations, `assistant_` prefix) | Conversations, runs, items, approvals, transcript, `assistant_model_request` (saved costs, also the question paper job's), `assistant_attachment` (chat images and PDFs), `school_assistant_access_role` |
| Contract | `packages/assistant-contract` | DTOs, the oRPC contract of `/model/*`, shared protocol constants, exact USD sums (`money.ts`) |
| Chat UI pieces | `packages/components/src/assistant` | Presentational timeline, approval card, composer (props and callbacks only) |
| Usage UI pieces | `packages/components/src/assistant-usage` | Date range form, spend chart and table (props only) |
| Management surfaces | `apps/management/components/assistant`, `components/assistant-settings` | Data hooks, the three surfaces (panel, page, palette), Settings › AI assistant and Settings › Usage |
| Admin pages | `apps/admin/components/assistant` | School › AI (feature flag, limit, eligible roles, spend), AI billing (platform) |
| API side | `packages/api/src/assistant/*` (`access.ts`, `token.ts`, `spend.ts`, `usage.ts`, `tool-policy.ts`), `packages/auth/src/assistant-token.ts`, `routers/school/assistant-access`, `routers/system-admin/assistant-usage`, `apps/server/src/mcp*.ts` | The access decision, delegated tokens, spend and usage reads, the `assistant` principal, the tool policy, the MCP assistant view |

### Where it runs

- **API server** (`apps/server`): mounts the assistant router at
  `/model/rpc/*` (`createAssistantRequestHandler`). The session, the access
  decision and the delegated token are the API's own, in-process. No request
  waits for the worker: a saved run is handed to Restate after commit, and the
  outbox sweep (on the API's 30 s loop) re-sends what Restate did not accept.
- **Worker** (`apps/worker`): serves the `assistantConversation` virtual
  object (one per conversation, `ingressPrivate`) and `AssistantControl`, the
  only assistant service on Restate ingress. Every call to it is signed with
  `WORKER_CONTROL_SECRET` (`packages/api/src/workflows/control-auth.ts`), like
  every worker control service.
- **The model's reach**: the worker holds database credentials, but only our
  code uses them, for the assistant's own rows. The model is offered exactly
  the tools the API's MCP assistant view lists, plus `show_view`, and calls
  them over HTTP at `CAMPUSPILOT_MCP_URL` with the run's delegated token, so
  the API's policy and OPA decide every call. A guard test checks this
  (`src/runtime/boundary.test.ts`): every offered tool is an MCP tool or
  `show_view`, and the turn loop imports no API code and no school table.

## How a message flows

1. The management app calls `API /model/rpc/sendMessage` with the user's
   session cookie (`assistantClient`, on the API origin). A request with an
   API key is not a user at the app and is refused.
2. The API checks access (`resolveAssistantAccess`, below) and issues a
   **delegated token** in-process (`issueAssistantRunToken`) for that user,
   school, conversation and run, kept in Redis for the worker. Tokens last 30
   minutes and are issued again whenever the user is present (sending,
   approving). An impersonating admin gets none.
3. One transaction saves the conversation, the run and the user's message.
   After commit the run is handed to Restate (`AssistantControl.startRun`,
   signed, idempotent per run); the run row is the outbox entry
   (`handed_over_at`). A run Restate never accepts within 5 minutes is failed
   visibly (`dispatch_failed`) so the user can send again; so is a run
   Restate accepted that never started within 5 minutes (`not_started`),
   unless an earlier run of the conversation is still unfinished (runs of a
   conversation queue behind each other). A late start of such a run does
   nothing.
4. The worker runs the turn on the conversation's object (messages queue
   behind an active run). Each model step and tool call is a durable Restate
   step. **Before every model request and every tool call** it asks the same
   access decision again, so a long tool loop stops at the school's limit (`limit_reached`)
   or when the feature or the user's role is switched off; changes already
   approved and made stay made. Tools are the MCP tools the API's **assistant
   view** lists: every procedure the policy allows, core and advanced, tagged
   with exposure and module. Core tools load up front; advanced ones are
   deferred to the provider's tool search where it has one (Anthropic);
   Gemini gets every tool on each request.
5. A write pauses on a Restate awakeable until the user approves or declines
   it in the UI. The decision is saved on the approval row and handed to the
   worker (`AssistantControl.resolveApproval`, which wakes the run with the
   decision on the row); a hand-over that fails is re-sent by the sweep, so a
   decision is never lost and the request never fails because Restate is
   briefly away. Stop records the stop, signals a streaming step, and cancels
   a pending approval the same way (`run-stop.ts`); every step of it is
   repeatable, and once a stop is asked the change can no longer be approved:
   an approve takes the run's row lock and is refused once
   `stop_requested_at` is set, and the turn checks the stop again, under the
   same lock, before it hands an approved write to the API. The run checks for a stop while holding its row lock before it creates an
   approval, so a Stop never lands between the check and the approval.
   An approved write is handed to the API **at most once**: the intent is saved
   on the item before the call, so a step repeated after a crash never sends it
   again. If the outcome never came back (the connection dropped mid-call), the
   call fails with `OUTCOME_UNKNOWN` and the model is told to check the data
   before trying again. Reads may be repeated.
6. Each answered model request is saved as an `assistant_model_request` row
   (tokens, the prices used, `cost_usd`) and added to the run's totals in the
   same transaction (below).
7. Changes are published over Redis to the conversation's stream
   (`/model/rpc/subscribeConversation`): a snapshot, then sequenced upserts,
   plus ephemeral text frames while a reply streams. When an assistant write
   succeeds, the management app refreshes its CampusPilot queries so open
   screens show the change. The stream is an SSE event iterator: nothing in
   front of `/model/*` may buffer responses.

## Access

The school feature flag `assistant` (see [School feature flags](feature-flags.md))
carries `{ monthlyLimitUsd: number | null, eligibleRoles: role[] }`. It is off
for every school by default, demo schools included, and is edited only on the
admin app's School › AI page.

**Use** (start or continue a turn) is decided by one API function,
`resolveAssistantAccess` (`packages/api/src/assistant/access.ts`). Each fact is
its own check, and the first that fails is returned with a message for the user:

1. the school's `assistant` flag is enabled (`feature_disabled`);
2. the user is a member of the school (`not_member`);
3. the flag's settings are valid (`config_invalid`);
4. the user holds a role that is in `eligibleRoles` **and** that the school
   switched on in `school_assistant_access_role` (`role_not_enabled`). A role
   the school switched on that is no longer eligible grants nothing and is
   shown as "not available on your plan";
5. the school's saved spend in the current IST month is below
   `monthlyLimitUsd` (`limit_reached`). The month spend is cached in Redis for
   10 minutes, so a limit can be overshot by what is spent in that window.

There is no OPA grant to use the assistant: the school's role list is the only
source of who may. It is used by `/model/*` (sending, approving), the token
issue, the worker before every model request, and the open stream recheck.

The assistant **disappears for anyone who may not use it**. Seeing it at all
(the pages, the history list, a conversation and its stream, delete, stop,
decline) needs facts 1 to 4: the feature, membership, and an eligible role the
school switched on. Only the monthly limit is left out: at the limit the
history stays visible and the composer says why it cannot send. With the
feature off every `/model/*` procedure answers the disabled-feature error; for
a role that is not switched on they answer FORBIDDEN (`role_not_enabled`).
Only `getStatus` answers every member (`allowed: false`), so the app can tell
"not for you" from an error. Conversations and costs are kept and come back
when access returns. A turn that is waiting for approval when the feature is
switched off stays paused until it is switched on again; a turn that is
working is refused at its next model request.

| Who | Action | Granted to |
| --- | --- | --- |
| Settings › AI assistant | `school.assistant.access.read`, `school.assistant.access.manage` | principal, manager |
| Settings › Usage › AI usage | `school.assistant.usage.read` | principal, manager |
| Admin School › AI, AI billing | `system.assistant.usage.read` (+ `system.school.feature_flags.*` for the settings) | platform admin |

Procedures: `school.getAssistantAccess`, `school.updateAssistantRoles`,
`school.getAssistantUsage`, `systemAdmin.getSchoolAssistantUsage`,
`systemAdmin.getPlatformAssistantUsage` (all hidden from MCP, so never offered
to the assistant itself).

UI: every management entry point (navbar panel button, sidebar link, ⌘K
entry) is wrapped in `AssistantAccess`: `RequireFeature('assistant')` and the
user's `getStatus().allowed` (their role may use it, whatever the limit). The
assistant pages use `FeaturePage` and the same `AssistantAccess` role gate.

Enabling the feature requires its settings: `setSchoolFeature` refuses to
switch on any feature whose catalogue config is not `z.null()` without a
config (BAD_REQUEST); switching it off never needs one.

## Model providers

The agent loop talks to models only through `ModelProvider`
(`packages/assistant/src/runtime/providers/types.ts`). Each adapter owns its
provider's request shape, native features and transcript format, so nothing is
reduced to a common subset:

- **Anthropic** (`providers/anthropic.ts`): exactly the Claude-only build's
  requests: core tools up front, advanced tools deferred behind BM25 tool search,
  automatic prompt caching, explicit effort, server-side refusal fallback. A test
  pins the request parameters and the prompt hash against that build.
- **Gemini** (`providers/gemini.ts`): Gemini `Part` transcripts kept exactly as
  returned (thought signatures included), every tool declared on each request
  (Gemini has no server-side tool search), model-default thinking and implicit
  caching.

`ASSISTANT_PROVIDER` (`gemini` by default) picks the provider for **new**
conversations. A conversation stays on its **provider**, because transcripts
are provider-specific, so every provider that still has conversations needs
its settings. It does **not** stay on a model: every run calls the model that
provider is configured with now, so changing it moves existing conversations
to the new model from their next message. `assistant_conversation.model` is
only the model the conversation started on. Each run records the provider it
called and the model that **answered**, as the provider reported it. Usage is
normalised to one shape (`inputTokens` excludes cache reads). Add a provider
by implementing `ModelProvider`, registering it in `providers/registry.ts`,
and giving it the same six settings.

Every provider has the same six settings (`@campuspilot/env/assistant`, read by
the API and the worker): `<P>_API_KEY`, `<P>_MODEL` and four prices in USD per
million tokens, `<P>_PRICE_INPUT_USD_PER_MTOK`, `_OUTPUT_`, `_CACHE_READ_`,
`_CACHE_WRITE_`. A provider is configured only when all six are set; setting
some of them refuses to start. There is no price list in code.

### One-shot text requests (question papers)

Besides the agent loop, a provider can make one **plain text request**
(`ModelProvider.generateText`): one user turn of text and image parts, a system
prompt, no tools, no transcript and no structured-output mode, answered with the
text, the answering model, normalised usage and two flags, `refusal` and
`unfinished` (the provider did not report a normal finish: the output limit or any other finish reason, or none). Question paper generation (the
"Generate with AI" job, `docs/question-papers.md`) is its only caller; the answer
is an HTML fragment, which the caller finds in the text (it strips a Markdown
code fence), sanitises and validates. It reaches the provider through
`createQuestionPaperModel()` (`packages/assistant/src/question-paper-model.ts`,
outside `src/runtime`), which the API process and the worker call at boot and
pass to `configureQuestionPaperModel`; the API package cannot import this one,
so the job sees only the structural `QuestionPaperModel`
(`packages/api/src/workflows/question-paper/model.ts`). The turn loop is
untouched, so `boundary.test.ts` still holds.

| | Anthropic | Gemini |
| --- | --- | --- |
| Images read | JPEG, PNG, WebP, GIF (**not HEIC**) | JPEG, PNG, WebP, HEIC, HEIF |
| Request | `beta.messages.stream`, effort `medium`, no caching (pages differ per job) | `models.generateContentStream`, `mediaResolution: HIGH` (streamed so a long answer survives idle limits and a broken stream still reports usage) |
| Truncated | `stop_reason = max_tokens` | `finishReason = MAX_TOKENS` |
| Refused | `stop_reason = refusal` | prompt block, or a safety/image-safety finish reason |

There is no response schema, so no provider-specific schema fitting: an earlier
design asked the providers for a JSON document and had to fit its schema to
Gemini's undocumented complexity limits; that is gone. What the model may write
is governed by the prompt (the shared fragment rules) and enforced by the
`question_paper_body` sanitiser and the validator after the answer. A page the
active provider cannot read (HEIC on Anthropic) fails the job before any request,
naming the page (decision D46); pages are never dropped silently. The job
records the provider's real error message in `error_detail` (`error-detail.ts`)
so a refused request is diagnosable.

**Settings.** Question paper generation uses `QUESTION_PAPER_PROVIDER`
(default `ASSISTANT_PROVIDER`) and `QUESTION_PAPER_MODEL` (default the
provider's `<P>_MODEL`). The provider's API key is always its own. When
`QUESTION_PAPER_MODEL` is set, all four `QUESTION_PAPER_PRICE_*_USD_PER_MTOK`
are required and are the prices saved with its requests; when it is not set
they must be unset and the provider's own prices apply, so a model never
inherits another model's prices. An explicit `QUESTION_PAPER_PROVIDER` needs
that provider's key and a model (its own or `QUESTION_PAPER_MODEL`), or
startup is refused. `QUESTION_PAPER_MAX_OUTPUT_TOKENS` (default 32000) bounds
one request; `QUESTION_PAPER_JOB_TIMEOUT_MINUTES` (default 40) is how long a
running job may take before the API's sweep fails it (read by the API server);
`QUESTION_PAPER_MAX_RUNNING_JOBS_PER_SCHOOL` (default 3) caps the jobs (queued plus
running) one school may have at once, which bounds how many run at the same time (not how far
the cached spend check can be overshot by jobs started one after another).
The worker needs the same `QUESTION_PAPER_*` values as the API server.

### Attachments, question paper tools and context pruning

Chat can carry images and PDFs: photographs of a handwritten question paper, an
existing paper, a syllabus or notes as a PDF
(feature guide: [Question papers](question-papers.md#chat-attachments-tools-drafts-pruning)).

- **Kinds.** An attachment is an `image` (JPEG, PNG, WebP or the HEIC family) or a
  `document` (a PDF). The kind is its own fact (`assistant_attachment.kind`, migration
  0066; `AssistantAttachmentRef.kind`; the transcript marker's `kind`), decided once from
  the uploaded **bytes** (`sniffAttachmentKind` in `packages/api/src/files/attachment-upload.ts`:
  an image signature at offset 0 first, then `%PDF-` at offset 0 or within the first 1,024
  bytes, as PDF readers accept) and never from the file name or the declared type. A
  JPEG named `.pdf` is an image; HTML or a Word file named `.pdf` is refused. Database
  checks hold one shape per kind: a document has no derivative status, thumbnail or model
  copy and its type is `application/pdf`. Word and other files are refused with
  `ASSISTANT_ATTACHMENT_REFUSED_TYPE_MESSAGE` ("... Save Word and other documents as PDF
  and attach the PDF."), by the composer before uploading and by the server (415).
- **Limits** (all in `packages/assistant-contract/src/attachments.ts`, read by the server,
  the composer and the model context): 20 attachments per message, of either kind
  together; an image at most 15 MiB, a PDF at most 10 MiB (13.3 MiB as base64, so one PDF
  always fits the request budget with room for images); 40 unsent attachments per user
  and school; unsent ones kept 24 hours; one request carries at most 16 MiB of attachment
  bytes counted as base64, images and PDFs together. Pages of a PDF are not counted: the
  server never parses one. The providers' own limits are far above ours (Gemini: 50 MB
  per inline PDF, 100 MB of inline data per request, 1,000 pages,
  <https://ai.google.dev/gemini-api/docs/file-input-methods>; Claude: 128 MB per request,
  600 pages, 100 when the model's context window is under 1M tokens,
  <https://platform.claude.com/docs/en/build-with-claude/pdf-support>; both read
  2026-11-14). A PDF a provider refuses (too many pages, a password, damaged) fails the
  turn with `ASSISTANT_DOCUMENT_REJECTED_MESSAGE` (run failure `document_rejected`),
  which tells the user to start a new conversation with a shorter PDF or photos.
- **Upload.** Each file is uploaded first, alone, to
  `POST /api/blob/schools/:schoolId/assistant/attachments`
  (`packages/assistant/src/attachments.http.ts`, mounted in `apps/server`): browser
  session only, origin checked, `assertCanUse`, 60 per minute per IP; the body is read
  bounded to the larger cap, then the kind's own cap applies. An image becomes three
  objects (the original, a 1800 px model copy and a thumbnail; `unsupported` when the
  server cannot decode it, as for HEIC); a PDF is one object, stored exactly as uploaded
  (`original.pdf`), never parsed, rendered or rewritten. All live under
  `schools/{schoolId}/assistant/attachments/{id}/`. The objects are written first and a
  short transaction (per user and school advisory lock) then counts the cap, frees stale
  or surplus rows (their objects are deleted after the commit, best effort, logged by key)
  and inserts the row; no connection or lock is held across storage calls.
- **Browser.** The management app decides the kind from the file's first bytes too
  (`assistantAttachmentKindOf` in `apps/management/lib/assistant-attachments.ts`, same
  order as the server, reusing `hasPdfSignature` and `@campuspilot/s3/image`): only an
  image goes through the HEIC to JPEG conversion (`prepareUploadFile`), a PDF goes up as
  picked, anything else is refused before it uploads. The server's `ref.kind` is the
  fact the composer then uses. A document is drawn as a tile with a file icon, its name
  and its size, in the composer, on a sent message and on a message that is still on its
  way or queued (those carry the references, `useSendAssistantMessage().send(text, id,
  { attachments })`, so their kind is known before the server echoes the message).
- **Sending.** `sendMessage` takes `attachmentIds` (text may then be empty) and binds
  them in the same transaction as the message; a message that names a file that is
  foreign, already sent or missing is refused whole; for missing ones the BAD_REQUEST carries
  `data = { reason: 'attachments_missing', attachmentIds }` and the composer marks exactly
  those tiles as failed (the failed copy of the message is dropped, so Retry cannot loop).
  A file the conversation's provider cannot read refuses the send before any cost (D46):
  HEIC on Anthropic asks for a JPEG; a PDF on a provider that declares no document types
  (`documentMimeTypes`, explicit per provider in `runtime/providers/image-types.ts`) asks
  for photos of its pages. A file is never dropped silently. A conversation started by
  files alone is titled "Attached image(s)", "Attached PDF(s)" or "Attached files".
- **Reading back.** Only an image is ever served back: `thumb` and `original` redirect
  the owner to a 5 minute presigned URL. A document answers 404 on both, so a PDF's bytes
  go to the model and nowhere else (a PDF can carry script and a browser renders it
  inline); there is no PDF preview or thumbnail.
- **Removal.** Removing a file from the composer deletes it (`DELETE` on the attachment,
  owner and unsent only); an upload at the cap frees that user's unsent files older than
  an hour and then, if still at the cap, the oldest beyond the newest 20 (a composer holds
  at most 20; the rest were left by a composer that unmounted); an unsent one is deleted
  after 24 hours (the outbox sweep, which also retries attachments of deleted conversations
  whose objects could not be deleted; objects go before rows); the others go with their
  conversation (`deleteConversation`, a soft delete, deletes them explicitly) and with the
  school (demo purge). Both kinds follow the same rules.
- **Transcript.** A stored user turn holds provider-neutral markers (id, kind, name,
  type), never bytes; the provider adapters turn a marker into the provider's part when
  they build a request, always preceded by a line carrying the attachment's `asat_` id,
  sanitised file name and type (`attachmentLabel`). For an image the line says the id can
  be a `data-figure-id`; for a PDF it says the file is source material to read and can
  never be a figure. An image goes to Gemini as `inlineData` and to Claude as an `image`
  block. A PDF goes as the PDF itself, never rasterised or text-extracted by us: Gemini
  `inlineData` with `mimeType: 'application/pdf'` (`geminiDocumentPart`), Claude a
  `document` block with a base64 `application/pdf` source (`anthropicDocumentBlock`).
  Old or unshown attachments keep the id in their note; see
  [Question papers](question-papers.md#chat-attachments-tools-drafts-pruning).
  `AssistantUserMessageBody` carries `attachments` and an optional `seed` (the
  question paper context, accepted only on a new conversation).
- **Never a figure.** A PDF's `asat_` id as a `data-figure-id` is a validation problem
  that tells the model to read the PDF and write a placeholder (or ask for the picture as
  an image); a save refuses it and never copies a PDF into a paper's figures
  (`question-paper.attachments.ts`).
- **Tools.** The question paper tools are ordinary advanced MCP tools of module
  `exams` (`listQuestionPapers`, `getQuestionPaper`, `listQuestionPaperVersions`,
  `getQuestionPaperDraft` (reads an unsaved draft back by `draftId`; in-app only),
  `learn_question_paper_generation`, `validateQuestionPaperDraft` and
  `saveQuestionPaperVersion`, the only write and so the usual approval card). The prompt
  has one bullet that sends the model to the learn tool first (Anthropic reaches it
  through tool search, Gemini has every tool declared). `ASSISTANT_TOOL_META.outputChars`
  lets a tool raise the 24,000 character cap on its result, carried end to end
  (`_meta['campuspilot/output-chars']`).
- **Cards and views.** A successful `validateQuestionPaperDraft` call becomes a
  `card` timeline row (`ASSISTANT_CARD_TOOLS`, keyed by the stored MCP name
  `school.validateQuestionPaperDraft`) that the app renders as a draft card (the problems
  in plain sentences, or: a collapsed "what was removed" list, a placeholder-figure note,
  Preview and *Save as new version*, which sends the plain message "Save draft {id} as
  a new version of {paper}."; a draft replaced by a later ready draft of the same paper shrinks to a
  collapsed "Replaced by Draft N" line). No marks are shown anywhere. The `question_paper` view shows a saved version with Preview and
  Download (see Views below). Drafts exist only in the conversation.
- **Context pruning** (`runtime/context.ts`, `buildModelContext`, applied after the
  transcript is read and before the provider adapter; the stored transcript and the UI
  are never changed). The window is the last two human messages. Outside it a tool
  result of 8,000 characters or more is replaced by a stub naming the tool and its size
  ("Call the tool again if you need it"), a top-level text field of 4,000 characters or more in
  the input of an older tool call (the paper `html` of a draft or save call) by a stub naming
  the field, the tool and the size (`stubToolInputs` of the adapter). The stub (`toolInputStub`)
  names the way back per tool: `getQuestionPaperDraft` with the result's draft id (unsaved draft)
  or `getQuestionPaper` (saved) for a validate input, `getQuestionPaper` for a save input, and no
  draft id for any other tool; it says it is not the content, so copying it into `html` is
  refused as an empty paper, and an attachment by a note
  that keeps its id and says the image or document is no longer visible (a document's note
  also says it is not a figure). The stored transcript keeps the
  full text: a draft id is resolved from it when the user saves. Inside it, images and PDFs are materialised newest first within one 16 MiB
  budget counted as base64, with a note for any that are missing, unreadable or omitted. Entry count,
  order, tool call ids and thought signatures are never touched, and the function is
  pure and idempotent. Each provider supplies a `ContextAdapter` (`anthropicContext`,
  `geminiContext`, `fakeContext`) for its own message format. One threshold per kind (results,
  inputs) applies to every tool, so the learn payload (about 10 KB) is pruned too and the agent calls it
  again when it needs it.

### Cost: saved, never recomputed

After each answered model request, one transaction (the step's own) inserts an
`assistant_model_request` row (provider, requested and answered model, the four
token counts, the four prices used, `cost_usd = Σ tokens × price / 10⁶` computed
in Postgres `numeric(14,8)`) and adds the tokens and exactly that cost to
`assistant_run` (`cost_usd`). The insert is idempotent per step
(`request_key`). One row per request, not per run, because a release with new
prices can land mid-run. A provider without prices is never called.

A request that **failed** after the provider reported usage (a Gemini
response ending in a malformed function call, a stream that broke midway) is
billed, so it is saved before the step is retried, one row per attempt
(`<runId>:model:<step>:attempt:<n>`), with `usage_complete` saying whether
that was the provider's final usage. A failure with no usage reported (a 429
refusal) saves nothing.

A request **stopped** mid-stream is saved too, with `usage_complete = false`
and the usage the provider had reported before the abort (Gemini's
`usageMetadata`; Claude's `message_start` and `message_delta`), or zeros when
nothing arrived. Its cost is therefore a lower bound; the admin pages count
such rows ("incomplete usage") so the gap is visible next to the provider's
bill.

Saved costs stay linked to their run and conversation for good: users delete
conversations softly (below), and `assistant_model_request.run_id` is
`ON DELETE NO ACTION`, so no run or conversation delete can drop or unlink a
cost.

**Source.** `assistant_model_request.source` (`chat` | `question_paper`, no
default: every writer states it) says what a request was for. A `chat` row
has a `run_id` and no job; a `question_paper` row has no run and carries the
generation job's id in `question_paper_job_id` (a plain value, deliberately no
foreign key, so deleting a paper never drops or unlinks what it cost). A CHECK
ties the three columns together. Question paper rows are written by
`recordQuestionPaperRequest` (`packages/api/src/workflows/question-paper/cost.ts`)
with the same cost expression, one row per model request (the transcription,
the optional repair, and every failed attempt the provider billed), keyed
`qp:<jobId>.<attempt>:model:<n>[:attempt:<k>]`. Because spend, the monthly
limit and every usage read use this table only, question paper cost counts
toward the school's AI limit and usage with no other change. The usage
answers carry `sources` (every source listed, a quiet one with zeros); the
usage tab and the admin AI pages show it as "By feature" (Assistant chat,
Question paper). Cost rows are removed only with their school
(`school_id` cascades on every assistant table; Postgres checks `NO ACTION` at
the end of that one statement, when the cost rows are gone too) and by
`purge_demo_school`, which deletes them first. Spend, limits and bills never
drop when a conversation is deleted. Limits, the usage tab and the admin pages
read only `assistant_model_request`, never runs. Amounts travel as decimal
text and are added exactly (`sumUsd`), never as floats; token sums are
`bigint` and reach clients as a number while it is a safe integer and as
decimal text beyond (`TokenCount`).

Days and months are **IST** (Asia/Kolkata, fixed UTC+05:30): a month is the
1st to the last day. The prompt's "today" is the IST date too, and its
"current time" is the run's start as an IST instant with its offset
(`2026-11-12T04:55:12+05:30`), read in the run's first durable step so a
replay keeps it; the model uses it for "received today" payment times. The AI billing
page opens on the current IST month; the other usage views on the last 7
days. Usage reads (`packages/api/src/assistant/usage.ts`) are
cached in Redis for an hour. Every answer carries `computedAt`, which each
usage page shows ("Updated 11 Nov, 7:12 pm IST") next to a Refresh button;
Refresh sends `refresh: true`, which computes the figures again from the saved
rows and replaces the cached answer for everyone reading that range. Refresh
does not touch the 10-minute spend cache the monthly limit uses.
Provider consoles group days in their own time zone: compare months, not days.
INR is shown only in the admin app, at a rate the viewer types, kept in the
browser's localStorage and never sent to the API.

### When a model request fails

Each adapter classifies its provider's errors (`failureKind`), and the user
sees a message that matches:

| Kind | Examples | Attempts | Run error code | The user is told |
| --- | --- | --- | --- | --- |
| `rejected` | malformed or too-long request (400) | 1 | `model_rejected` | to rephrase |
| `unavailable` | wrong key, no permission, unknown model (401, 403, 404) | 1 | `provider_unavailable` | to try again later |
| `busy` | rate limit, exhausted quota or spending cap, overload (429, 503, 529) | 3 (the first and 2 retries) | `model_busy` | to try again in a few minutes |
| `unknown` | anything else | 3 (the first and 2 retries) | `model_error` | to try again |

The access check before a request ends a run with its own code
(`limit_reached`, `role_not_enabled`, `feature_disabled`, …) and message.
The provider's raw error is saved on the run (`assistant_run.error_detail`) and
logged with the run, conversation, school, provider and model.

### Developer diagnostics

`ASSISTANT_DIAGNOSTICS=true` shows each turn's model, token counts, saved cost
and raw error in the chat, and a conversation total in the composer. It is
for developers: with it on, **every** user of that deployment sees these, so
the worker logs a warning when it is on in production.

## Rules and where they live

- **Security policy, enforced by the API** (`packages/api/src/assistant/tool-policy.ts`,
  applied in `requireAuth` for the `assistant` principal): only allowlisted
  school modules (`ASSISTANT_TOOL_MODULES`), which include billing and the
  dashboard's money totals; no platform, system, account, assistant or hidden
  procedures; notices and notifications are not yet reviewed for the
  assistant, so they stay off; only the conversation's own school, including
  the list of the user's schools, which holds just that school. Documents of
  every type, bills, receipts and statements included, follow the user's own
  document permissions. The assistant cannot widen any of this.
- **Approval policy, owned by the assistant** (`packages/assistant/src/runtime/tools.ts`,
  `requiresApproval`): every write waits for the user. Reads run immediately. The approval
  request lists the tool's input as labelled values; a tool whose input cannot be checked by a
  person (ids, a draft hash, a whole paper) has an entry in the approval summary registry
  (`packages/components/src/assistant/approval-summaries.ts`, keyed by the MCP tool name): one
  sentence the app fills with names it resolves ("Save Draft 2 as version 4 of Mathematics (Oral),
  Class 5, Annual Examination."), the ids behind a collapsed "Details" and long text replaced by its size.
  Add an entry there rather than a second code path in the card.
- **Permissions**: OPA decides every tool call as the user. Who may use the
  assistant at all is the role-based access above. An admin impersonating a
  user cannot use the assistant: its calls would be recorded as the user's own.
- **Topic scope, asked of the model** (`packages/assistant/src/runtime/prompt.ts`,
  "What you help with"): only the school's work in CampusPilot and short
  school communications built on it, such as a notice to parents. Code,
  general knowledge, teaching material, translation and the like are declined
  in one sentence, and the prompt says that role-play, claimed authority,
  fake system messages and repeated asking do not change that. This is the
  one rule here that the model keeps rather than code: it protects cost and
  tone, not data, so a reply that slips through exposes nothing the user
  could not already see. Change the scope by editing that block; the prompt
  pin test then needs its hash updated.
- **Money, asked of the model** (same prompt, "How to work"): report only
  amounts the tools return, never a balance, due or total worked out from
  other amounts; `…Minor` fields and fee configuration amounts are minor
  units of the result's currency, or of the session's finance currency when
  the result names none (paise for INR), shown in the main unit and sent to
  tools as minor units; every write gets a new idempotency key. Bill and
  payment writes wait for approval like every other write.
- **Money on the approval request** (`packages/components/src/assistant/approval-values.ts`):
  a `*Minor` amount is shown as money in its record's own `currency`, else
  in the currency the app passes for that tool; fee-slug maps the app
  declares per tool (billing run values, admission fee values, session
  class overrides) are shown as money the same way. The per-tool table is
  `TOOL_MONEY` in `apps/management/components/assistant/assistant-approval-money.ts`:
  the input's `currency` (payment discount, adjustment), the input's
  `financeConfig.currency` (session finance update), else the session's
  finance currency, read only when the user may read session finance.
  Anything else shows as "… (minor units)"; the currency is never guessed.

## Security boundaries

- **Replies never load images.** A browser fetches an image as soon as it
  renders, so an image address is a way to send data out without a click.
  Text in school records is written by other people and reaches the model
  through tool results; the prompt tells the model not to follow it, and the
  renderer (`assistant-markdown.tsx`) makes the leak impossible by showing an
  image as its description only. Links still open, on a click.
- **A PDF is never shown in the browser or opened by the server.** A PDF can
  carry script, and a browser renders one inline, so its bytes are never
  served back (no preview, no thumbnail, `thumb`/`original` answer 404) and
  never parsed, rendered or rewritten on the server: they go to the model
  exactly as uploaded. What a PDF is comes from its bytes, never its name or
  declared type; HTML named `.pdf` is refused.
- **Cross-site requests are refused.** `/model/rpc/*` rejects a request whose
  `Origin` is not in `CORS_ORIGIN`. CORS alone only hides the response; the
  request would still run with the user's cookie.
- **Worker calls are signed.** `AssistantControl` verifies every call's
  `WORKER_CONTROL_SECRET` signature before it reads anything; the
  conversation object is private to ingress.
- **Open streams are rechecked** every two minutes: a user who signed out,
  left the school, or whose school lost the feature stops receiving events.
- **The delegated token** is bound to a user and a school and lasts 30
  minutes. The conversation and run in it are labels for the audit trail: the
  API does not check that the run is still active, and the token outlives a
  sign-out until it expires (the worker's access check before each model
  request still applies). The API enforces the tool policy for it; approval
  is enforced by the assistant's loop only.

## Conversations shared with a question paper

A conversation is private to the user who started it, with one exception: a
conversation started on a question paper's screen is **shared with that paper**,
so a colleague who takes the paper over reads how it came to be and carries on.

- **What makes it shared.** `sendMessage` with `shareWithPaper: true` on a new
  conversation, which needs a question paper `seed` (contract) and the right to
  manage that paper's class (FORBIDDEN otherwise). It is its own fact, stored as
  the paper's natural key on `assistant_conversation` (`paper_session_id`,
  `paper_exam_slug`, `paper_class_id`, `paper_subject_slug`, `paper_mode_slug`;
  all or none, checked; migration 0068). A seed alone never shares anything:
  the assistant's page can start a private conversation about a paper.
- **Who reaches it** (`mayReachConversation`, `conversation-access.ts`), always
  after seeing the assistant in the school (`assertCanSee`). The paper's class
  permission decides for everyone, **its starter included**: a teacher moved off
  the class no longer reads what colleagues write in it.
  - anyone who may **read** the class's question papers (the same OPA action as
    the paper's procedures): get, subscribe, see its images, approve or decline
    their own turn's changes;
  - anyone who may **manage** them: also send into it, and stop someone else's
    turn (or remove their queued message);
  - nobody else: NOT_FOUND, as for an id that does not exist. A starter who lost
    the class still has the row in their own history; opening it says it is not
    available.
  Anyone may always stop their own turn. Open streams recheck this every two
  minutes with the rest of the access.
- **What stays personal.** Only the starter deletes it, and only while they may
  still continue it (it then disappears for everyone). Only the person whose turn asked for a change may approve it: each
  run is its sender's, with their delegated token (`assistant_run.user_id`,
  now on the run DTO), and the others see "Waiting for … to approve a change".
  Each user message records its sender (`body.author`, named as at sending),
  and the chat shows the name over messages that are not the user's own. It
  stays in its starter's own history; it is not added to anyone else's.
- **When the paper is deleted** (its own delete, or its exam plan's), its
  conversations stop being shared (`unsharePaperConversations`, matched by key,
  also for a paper that never had a row): each stays a private conversation in
  its starter's history, and the paper starts again from its first screen. A
  paper is not deleted while one of its conversations has a turn that has not
  finished (CONFLICT), so no colleague's approval is stranded.
- **Its history.** `listPaperConversations` lists one paper's live shared
  conversations, newest first, with who started each (`startedByName`) and
  their attention; for people who may manage the paper. The paper's detail
  (`getQuestionPaperDetail`) carries `latestConversationId`, which the paper's
  screen opens unless its URL names another (`?chat=<id>`, or `?chat=new`).
- **The paper's tools in it.** A draft id is read from the user's own chat or a
  chat shared with that exact paper (`isPaperChat`). Chat images may be figures
  when the user sent them, or when they were sent in a conversation shared with
  that exact paper (`chatFiguresOf`); the draft card passes its conversation
  (`conversationId`) to `previewQuestionPaperDraft` and
  `validateQuestionPaperDraft` for this, and the server checks it.
- **Mind what is in it.** Everything said and read in a shared conversation is
  visible to the paper's readers, including tool results that came from the
  sender's own permissions. The welcome says so ("Everyone who can open this
  paper sees this chat").

## Comparing the three surfaces

All three share one chat component and the same conversations:

- **Panel**: the sparkle button in the navbar opens a right-hand sheet on any page.
- **Page**: *Assistant* in the sidebar (`/school/<id>/assistant`) with history.
- **Palette**: type a question in ⌘K and choose *Ask the assistant*.

Each run records the surface it started from (`assistant_run.surface`).

The same chat component is also embedded where a screen is about one thing. A question
paper's screen holds its own conversation beside the paper
([Question papers](question-papers.md#the-papers-screen)): it passes the paper as the
`seed` with an empty `seedText` (no prefilled sentence), its own `welcome` words,
`placeholder` and `suggestions`, and records the `panel` surface. An embedding surface
keys the chat so that the one that starts a conversation stays mounted as it moves into
it, and any other change of conversation remounts it.

## Running locally

1. In `apps/server/.env`, set `ASSISTANT_TOKEN_SIGNING_SECRET` (generate your
   own: `openssl rand -hex 32`), `WORKER_CONTROL_SECRET`, `ASSISTANT_PROVIDER`
   and that provider's six settings (`GEMINI_API_KEY`, `GEMINI_MODEL`, the
   four `GEMINI_PRICE_*_USD_PER_MTOK`; see `.env.example`), and
   `CAMPUSPILOT_MCP_URL` (the API's `/mcp` as the worker reaches it).
2. Copy the same values into `apps/worker/.env` (it is a copy of the server's
   file plus the worker's own settings) and start the worker
   (`pnpm --filter worker dev`, or `node scripts/local-demo-apps.mjs start
   worker`). It registers with Restate on every start.
3. In the admin app, open the school's **AI** page, enable the assistant and
   choose its eligible roles and limit; then, as the school's principal or
   manager, switch roles on in **Settings › AI assistant**.
4. The management app needs nothing extra: the assistant is served by the API
   at `NEXT_PUBLIC_SERVER_URL` + `/model/rpc`.

The tables are part of the main migrations, applied by the API at boot.

## Views: platform UI in the conversation

The model never writes markup. It calls one tool, `show_view`, with a structured
view from `packages/assistant-contract/src/views.ts`; the turn loop validates it
and stores it as a `view` item, and the app renders it with its own components:

- `records`: admissions, students, classes, exams or staff by id. The app fetches
  each record itself with the user's session, behind the same permission the API
  checks (`apps/management/components/assistant/assistant-view.tsx`), so the
  assistant can name records but never decides what a user sees.
- `exam_result`: the platform's student result preview.
- `documents`: generated documents (report cards, bills, receipts and the
  other types),
  each a row with a **Download** button. The app asks the API for a fresh
  download link on click, with the user's session; the model never writes a
  link (they are long and short-lived, and models copy them unreliably). Bills,
  receipts and statements are offered like any other type; the download asks
  for the user's own finance document permission. Only a type the API does
  not know is shown as unavailable.
- `question_paper`: a saved version of a question paper by its natural key and
  `versionNo`, with Preview and Download. The app reads the paper with the user's
  session behind the class read permission (`assistant-question-paper.tsx`).
- `table`, `stats`, `details`, `bars`, `notice`: composed from design-system
  pieces in `packages/components/src/assistant/views` (dashboard tiles and bar
  lists, row-hairline tables, the app's badge tones).

To add a view, extend the contract's union, render it in `assistant-view.tsx`,
and describe it in `SHOW_VIEW_TOOL_DESCRIPTION`.

## Conversation status and deleting

- **`attention`** on a history row (`approval`, `working` or null) comes
  from the conversation's runs that have not finished: `approval` when one
  waits for the user, otherwise `working` when one is queued or running.
  These are exactly the runs that make the API refuse a delete, so the
  list never offers what would be refused. It is not stored, and only list
  rows carry it: the list query checks it in the same statement (two
  `exists` lookups per row, never a query per conversation).
  `assistantConversationAttention` in the contract is the same rule; the app
  applies it to the open conversation's live runs, which it shows as a row
  when that conversation is older than the loaded pages.
- **`deleteConversation`** deletes one of the user's conversations,
  **softly**, with the same checks as reading it (may see the assistant in
  the school; owns the conversation). It sets `deleted_at` and `deleted_by`
  and keeps every row (runs, items, approvals, transcript), so its saved
  model-request costs stay linked to their run and conversation for future
  tracking, and the school's spend and limit do not change. For the user it
  is gone everywhere: the list (served by a partial index on live rows), get,
  subscribe, sending into it, the replay of a message sent to it, approve,
  decline and stop all answer NOT_FOUND, and so does a second delete. The
  worker never starts a run of a deleted conversation (`begin` ends it
  `cancelled` with `conversation_deleted` before any model request) and
  checks again before every model request. It is refused with "Stop the
  assistant before deleting this conversation." while a run is queued, running or waiting for approval: the
  conversation row is locked for the check and the delete, and saving a
  message or a run's progress updates that row, so no run can start in
  between. Changes the assistant already made to school data are not
  touched.

## Streaming and weak networks

Adapted from T3 Code's data layer:

- **Text** streams as ordered `{offset, delta}` frames, released a line at a time
  (whole words after a short hold; whole lines inside code fences). New blocks
  fade in. The text so far is kept in Redis for viewers who reconnect.
- **Resume**: the client tracks the highest sequence it holds and reconnects
  with `afterSequence`; the API sends only what changed (a `resume`), or a
  snapshot when that is over 200 changes. Data stays on screen meanwhile.
- **Liveness**: a heartbeat every 15s when idle; the client treats 40s of
  silence as a dead connection and reconnects inside the stream itself
  (`assistant-stream.ts`) with equal-jitter backoff, which resets once a
  connection has caught up. It catches up at once when the tab becomes visible
  or the network returns; while the browser is offline nothing is retried and
  the notice reads "You're offline. Reconnecting when you're back." A
  "Reconnecting…" notice appears only after a 2s grace. A conversation that
  is missing, not the user's, or behind an expired sign-in is final: the chat
  shows that it is not available instead of retrying. Changes the assistant
  made while the tab was disconnected refresh open screens after the reconnect.
- **Sending**: messages appear at once (read from the mutation cache), retry
  automatically with the same request id on network or server errors, and show
  "Not sent · Retry" if they still fail. One message is sent at a time; the
  draft is restored only if the field is still empty, so text typed meanwhile
  is never overwritten.
- **Drafts**: the unsent text of each conversation is kept in the browser's
  `sessionStorage` (`assistant-draft.ts`), so switching conversation or
  reloading does not lose it. It is kept per school and conversation (new
  conversations share one draft), lasts for the tab's session only (office
  computers are shared), and is removed once the message was sent
  successfully or the box was emptied. A failed send keeps it.
- **History** loads 20 conversations at a time ("Show older") and reports a
  failed load inline with "Try again". While any loaded conversation is
  working or waiting for approval the list is asked again every 4 seconds
  (and not at all otherwise); the open conversation's stream also refreshes
  it when a run is queued, pauses for approval or ends.
- **Screen readers**: one polite live region per chat reads a finished answer
  once and names a change that needs approval.

## Look and feel

The chat's structure follows T3 Code's redesign (maria-rcks,
pingdotgg/t3code #28839 to #28845, plus #26155, #26255, #27305, #27978 and
#25299); its paint is the app's own flat shadcn language (solid `card` and
`muted` fills, 1px `border`, the app's radius scale, no gradients). Surface
recipes live in `packages/ui/src/styles/assistant.css`; components pick one
(`assistant-well`, `assistant-raised`, `assistant-bubble`) rather than
painting their own.

- **Composer**: one rounded surface with a hairline outline and a toolbar row
  holding the trust cue and a round send button (Queue and Stop share its
  place).
- **Requests in the composer**: a change waiting for approval is decided in
  a section above the message field. Enter approves only while focus is inside
  that chat and not on a field, button, link or menu; Escape declines only
  while focus is inside the request itself. The Enter hint on Approve is
  shown only while Enter would approve: with focus in the message box (where
  it is when a request arrives; an arriving request never moves focus) Enter
  sends the message, so the hint is hidden. In the side panel and the palette
  Escape closes the surface and never declines, and keys pressed on the page
  behind the panel do nothing (`approval-keys.ts`). A decided request stays
  disabled until the stream removes it, so it cannot be sent twice;
  its timeline row only names it, in amber. The values of a change are shown
  in plain words, never as JSON (`approval-values.ts`): yes/no, dates, comma
  lists, records as nested rows and lists of records as numbered rows, at
  any depth. Every value that will be written is shown, never a count, so
  the person approving can check each one; the section scrolls.
- **Queued messages**: messages sent while a run works wait in the composer
  as queued rows, not in the timeline. Each can be removed before it starts:
  the row's button asks the API to stop that queued run, and
  `beginRun` ends a run with a stop request as stopped before anything is
  sent to the model. The row leaves the queue at once; when its turn comes,
  the message appears in the conversation with "Removed before the assistant
  started on it."
- **Turns**: each run has a 32px work bar over a hairline ("Working for 12s",
  "Paused at 8s", "Worked for 18s"). After Stop is pressed the bar reads
  "Stopping…" and its clock stops until the run has ended. A finished turn
  folds its tool calls, decisions and interim replies into the bar; views and
  the final answer stay visible, and only that answer shows time and copy on
  hover. Folds open and close over 200ms (not under reduced motion). An
  expanded step shows how long it took when it succeeded and took at least a
  tenth of a second.
- **A turn that failed or was stopped**: only the bar is red. The reason is a
  quiet row under it, and on the conversation's latest turn, while nothing is
  working, waiting or queued, it offers **Try again**, which sends that
  turn's question again as a new message. It is a button only (no shortcut),
  because it starts a new paid run.
- **Times** are day-aware: the time for today, "Yesterday at 2:29 PM", then
  the date with the time; the full date is in a tooltip. Tooltips in the chat
  wait 400ms. A Send that cannot be pressed says why in its tooltip.
- **History rows** show a 6px dot before the title when the conversation
  is still open: amber while it waits for approval, a shimmer while the
  assistant works. A failed latest request is not marked in the list (nothing
  records whether the user has seen it, so old failures would stay red for
  good); the conversation itself shows it with "Try again". Each row has a "…"
  menu (on hover or focus; always on touch screens; on phones on the open
  conversation's chip) with **Delete**, confirmed in the app's dialog. Delete
  is unavailable, with the reason, while the assistant is working in that
  conversation. Deleting the open conversation shows a new one. The open
  conversation is always listed, as the first row when it is older than the
  loaded pages.
- **Content**: tables, record lists, stats, details, bars and code sit in an
  inset well with hairline separators; no middle-dot joined metadata and no
  spaced capitals.
