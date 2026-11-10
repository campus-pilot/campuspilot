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
| Tables | `packages/db/src/schema/assistant.ts` (main migrations, `assistant_` prefix) | Conversations, runs, items, approvals, transcript, `assistant_model_request` (saved costs), `school_assistant_access_role` |
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
   (`handed_over_at`). A run Restate never accepts within 10 minutes is failed
   visibly (`dispatch_failed`) so the user can send again.
4. The worker runs the turn on the conversation's object (messages queue
   behind an active run). Each model step and tool call is a durable Restate
   step. **Before every model request** it asks the same access decision
   again, so a long tool loop stops at the school's limit (`limit_reached`)
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
   repeatable, and once a stop is asked the change can no longer be approved.
   The run checks for a stop while holding its row lock before it creates an
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

### Cost: saved, never recomputed

After each answered model request, one transaction (the step's own) inserts an
`assistant_model_request` row (provider, requested and answered model, the four
token counts, the four prices used, `cost_usd = Σ tokens × price / 10⁶` computed
in Postgres `numeric(14,8)`) and adds the tokens and exactly that cost to
`assistant_run` (`cost_usd`). The insert is idempotent per step
(`request_key`). One row per request, not per run, because a release with new
prices can land mid-run. A provider without prices is never called.

A request **stopped** mid-stream is saved too, with `usage_complete = false`
and the usage the provider had reported before the abort (Gemini's
`usageMetadata`; Claude's `message_start` and `message_delta`), or zeros when
nothing arrived. Its cost is therefore a lower bound; the admin pages count
such rows ("incomplete usage") so the gap is visible next to the provider's
bill.

Saved costs outlive conversations: deleting a conversation clears the
`run_id` of its model requests (`ON DELETE SET NULL`) and keeps every row, so
spend, limits and bills never drop. Limits, the usage tab and the admin pages
read only `assistant_model_request`, never runs. Amounts travel as decimal
text and are added exactly (`sumUsd`), never as floats; token sums are
`bigint` and reach clients as a number while it is a safe integer and as
decimal text beyond (`TokenCount`).

Days and months are **IST** (Asia/Kolkata, fixed UTC+05:30): a month is the
1st to the last day. The prompt's "today" is the IST date too. The AI billing
page opens on the current IST month; the other usage views on the last 7
days. Usage reads (`packages/api/src/assistant/usage.ts`) are
cached in Redis for an hour, so these pages can be one to two hours behind.
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
  applied in `requireAuth` for the `assistant` principal): only school modules;
  no billing, dashboard (money totals), platform, account or hidden procedures;
  no bills, receipts or statements through document tools, whether asked for
  by document type or by document domain (only the academic domain passes);
  only the conversation's own school, including the list of the user's
  schools, which holds just that school. The assistant cannot widen any of this.
- **Approval policy, owned by the assistant** (`packages/assistant/src/runtime/tools.ts`,
  `requiresApproval`): every write waits for the user. Reads run immediately.
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

## Security boundaries

- **Replies never load images.** A browser fetches an image as soon as it
  renders, so an image address is a way to send data out without a click.
  Text in school records is written by other people and reaches the model
  through tool results; the prompt tells the model not to follow it, and the
  renderer (`assistant-markdown.tsx`) makes the leak impossible by showing an
  image as its description only. Links still open, on a click.
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

## Comparing the three surfaces

All three share one chat component and the same conversations:

- **Panel**: the sparkle button in the navbar opens a right-hand sheet on any page.
- **Page**: *Assistant* in the sidebar (`/school/<id>/assistant`) with history.
- **Palette**: type a question in ⌘K and choose *Ask the assistant*.

Each run records the surface it started from (`assistant_run.surface`).

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
- `documents`: generated documents (report cards and other academic types),
  each a row with a **Download** button. The app asks the API for a fresh
  download link on click, with the user's session; the model never writes a
  link (they are long and short-lived, and models copy them unreliably). Bills,
  receipts and statements are shown as unavailable.
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
- **`deleteConversation`** deletes one of the user's conversations for good,
  with the same checks as reading it (may see the assistant in the school;
  owns the conversation). The schema cascades its runs, items, approvals and
  transcript. Its saved model-request costs are kept, with their run
  reference cleared, so the school's spend and limit do not change. It is refused with "Stop the assistant before deleting this
  conversation." while a run is queued, running or waiting for approval: the
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
