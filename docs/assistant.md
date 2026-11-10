# In-app assistant

The assistant lets staff ask for anything they could do in the management app,
in plain language. It is a **separate service** (`apps/assistant`) that knows no
CampusPilot business logic: it reaches school data only through the API's MCP
endpoint, as the signed-in user, with the same permissions.

## Pieces

| Piece | Where | Owns |
| --- | --- | --- |
| Assistant service | `apps/assistant` | Agent loop (Restate), model calls, conversations, approvals, token usage, live stream |
| Contract | `packages/assistant-contract` | DTOs, the service's oRPC contract, shared protocol constants |
| Chat UI pieces | `packages/components/src/assistant` | Presentational timeline, approval card, composer (props and callbacks only) |
| Management surfaces | `apps/management/components/assistant` | Data hooks and the three surfaces (panel, page, palette) |
| API side | `packages/auth/src/assistant-token.ts`, `packages/api/src/routers/auth/assistant-token.router.ts`, `packages/api/src/assistant/tool-policy.ts`, `apps/server/src/mcp*.ts` | Delegated tokens, the `assistant` principal, the policy, the MCP assistant view |

## How a message flows

1. The management app calls the service with the user's CampusPilot session
   cookie. The service checks the session with the API (`/api/auth/get-session`)
   and the `school.assistant.use` permission (`authorization.checkPermissions`).
2. The service asks the API for a **delegated token** (`auth.issueAssistantToken`)
   for that user, school, conversation and run. The API issues one only when the
   request carries **both** the user's live session **and** the service secret.
   Tokens last 30 minutes and are refreshed whenever the user is present again
   (sending, approving).
3. The service saves the message and starts a run on the Restate virtual object
   `assistantConversation` (one per conversation, so messages queue behind an
   active run).
4. Each model step and tool call is a durable Restate step. Tools are the MCP
   tools the API's **assistant view** lists: every procedure the policy allows,
   core and advanced, tagged with exposure and module. Core tools load up front;
   advanced ones are deferred to the provider's tool search where it has one
   (Anthropic); Gemini gets every tool on each request.
5. A write pauses on a Restate awakeable until the user approves or declines it
   in the UI. Stop cancels a pending approval and aborts a streaming step.
   An approved write is handed to the API **at most once**: the intent is saved
   on the item before the call, so a step repeated after a crash never sends it
   again. If the outcome never came back (the connection dropped mid-call), the
   call fails with `OUTCOME_UNKNOWN` and the model is told to check the data
   before trying again. Reads may be repeated.
6. Changes are published over Redis to the conversation's stream: a snapshot,
   then sequenced upserts, plus ephemeral text frames while a reply streams.
   When an assistant write succeeds, the management app refreshes its
   CampusPilot queries so open screens show the change.

## Model providers

The agent loop talks to models only through `ModelProvider`
(`apps/assistant/src/runtime/providers/types.ts`). Each adapter owns its
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

`ASSISTANT_PROVIDER` picks the provider for **new** conversations. A
conversation stays on its **provider**, because transcripts are
provider-specific. It does **not** stay on a model: every run calls the model
that provider is configured with now (`ANTHROPIC_MODEL`, `GEMINI_MODEL`), so
changing that setting moves existing conversations to the new model from their
next message. `assistant_conversation.model` is only the model the conversation
started on. Each run records the provider it called and the model that
**answered**, as the provider reported it (a fallback or a dated release can
differ from the model asked for). Usage is normalised to one shape
(`inputTokens` excludes cache reads), so benchmarks and limits compare like
with like. Add a provider by implementing `ModelProvider` and registering it in
`providers/registry.ts`.

### When a model request fails

Each adapter classifies its provider's errors (`failureKind`), and the user
sees a message that matches:

| Kind | Examples | Retried | Run error code | The user is told |
| --- | --- | --- | --- | --- |
| `rejected` | malformed or too-long request (400) | no | `model_rejected` | to rephrase |
| `unavailable` | wrong key, no permission, unknown model (401, 403, 404) | no | `provider_unavailable` | to try again later |
| `busy` | rate limit, exhausted quota or spending cap, overload (429, 503, 529) | 3 times | `model_busy` | to try again in a few minutes |
| `unknown` | anything else | 3 times | `model_error` | to try again |

The provider's raw error is saved on the run (`assistant_run.error_detail`) and
logged with the run, conversation, school, provider and model.

### Developer diagnostics

`ASSISTANT_DIAGNOSTICS=true` shows each turn's model, token counts, estimated
cost and raw error in the chat, and a conversation total in the composer. It is
for developers: with it on, **every** user of that deployment sees these, so
the service logs a warning when it is on in production. Costs are estimates
from the list prices in `providers/pricing.ts`, at the price in force on the
day the run was made; a model that is not listed gets no estimate.

## Rules and where they live

- **Security policy, enforced by the API** (`packages/api/src/assistant/tool-policy.ts`,
  applied in `requireAuth` for the `assistant` principal): only school modules;
  no billing, dashboard (money totals), platform, account or hidden procedures;
  no bills, receipts or statements through document tools, whether asked for
  by document type or by document domain (only the academic domain passes);
  only the conversation's own school, including the list of the user's
  schools, which holds just that school. The service cannot widen any of this.
- **Approval policy, owned by the service** (`apps/assistant/src/runtime/tools.ts`,
  `requiresApproval`): every write waits for the user. Reads run immediately.
- **Permissions**: OPA decides every tool call as the user. `school.assistant.use`
  (all school roles) decides who may use the assistant at all. An admin
  impersonating a user cannot use the assistant: its calls would be recorded as
  the user's own.

## Security boundaries

- **Replies never load images.** A browser fetches an image as soon as it
  renders, so an image address is a way to send data out without a click.
  Text in school records is written by other people and reaches the model
  through tool results; the prompt tells the model not to follow it, and the
  renderer (`assistant-markdown.tsx`) makes the leak impossible by showing an
  image as its description only. Links still open, on a click.
- **Cross-site requests are refused.** The service's `/rpc` routes reject a
  request whose `Origin` is not in `CORS_ORIGIN`. CORS alone only hides the
  response; the request would still run with the user's cookie.
- **The Restate endpoint trusts its caller** unless `RESTATE_IDENTITY_KEYS` is
  set. Whoever can reach `RESTATE_SERVICE_PORT` can drive a turn, and whoever
  can reach the Restate ingress can resolve an approval. In production set the
  identity keys and keep both ports private.
- **Open streams are rechecked** every two minutes: a user who signed out or
  lost `school.assistant.use` stops receiving events.
- **The delegated token** is bound to a user and a school and lasts 30
  minutes. The conversation and run in it are labels for the audit trail: the
  API does not check that the run is still active, and the token outlives a
  sign-out until it expires. The API enforces the tool policy for it; approval
  is enforced by the service only.

## Limits and feature flags (integration point)

Nothing is limited yet. When platform feature flags and school-level limits
arrive, plug them in at **one place**: `apps/assistant/src/entitlements.ts`
(`configureEntitlements`). It is asked `checkRunAllowed({ schoolId, userId })`
before every run, and its reason is shown to the user. Usage is already
recorded per run in `assistant.assistant_run` with `school_id`, `user_id`,
`model`, `surface`, `model_request_count` and input, output, cache-read and
cache-write token counts, so limits can count real usage. The admin app's
*AI Usage* page is still a placeholder: the service has no usage procedure for
it yet.

## Comparing the three surfaces

All three share one chat component and the same conversations:

- **Panel**: the sparkle button in the navbar opens a right-hand sheet on any page.
- **Page**: *Assistant* in the sidebar (`/school/<id>/assistant`) with history.
- **Palette**: type a question in ⌘K and choose *Ask the assistant*.

Each run records the surface it started from (`assistant_run.surface`).

## Running locally

1. In `apps/server/.env`, set `ASSISTANT_SERVICE_SECRET` and
   `ASSISTANT_TOKEN_SIGNING_SECRET` (32+ characters each, different values).
2. Copy `apps/assistant/.env.example` to `.env`. Use the same
   `ASSISTANT_SERVICE_SECRET`, point it at the API, Postgres, Redis and Restate,
   and set `ASSISTANT_PROVIDER` with that provider's key (and `GEMINI_MODEL`
   for Gemini). `RESTATE_SERVICE_URL` must be reachable from the
   Restate container (locally `http://host.docker.internal:9081`); when set, the
   service registers itself with Restate at boot. `RESTATE_IDENTITY_KEYS` is
   not needed locally.
3. In `apps/management/.env`, set `NEXT_PUBLIC_ASSISTANT_URL`. Without it the
   assistant UI is hidden.
4. Start the service (`pnpm --filter assistant dev`, or
   `node scripts/local-demo-apps.mjs start assistant` for the local demo). It
   applies its own migrations to the `assistant` Postgres schema at boot.

The browser sends the CampusPilot session cookie to the service, so in
production the service must be on a host covered by `COOKIE_DOMAIN` (for
example `assistant.campuspilot.in` with `COOKIE_DOMAIN=.campuspilot.in`).

## Views: platform UI in the conversation

The model never writes markup. It calls one tool, `show_view`, with a structured
view from `packages/assistant-contract/src/views.ts`; the service validates it
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

- **`attention`** on a conversation (`approval`, `working`, `failed` or null)
  is the state of its latest run: the one asked most recently. It is not
  stored. The service derives it wherever it returns a conversation: the
  list reads each conversation's latest run in the same statement (a lateral
  join, one index lookup per row, never a query per conversation), and a
  snapshot works it out from the runs it already loaded.
  `assistantConversationAttention` in the contract is the one rule, shared
  with the app, which applies it to the open conversation's live runs.
- **`deleteConversation`** deletes one of the user's conversations for good,
  with the same checks as reading it (may use the assistant in the school;
  owns the conversation). The schema cascades its runs, items, approvals and
  transcript. It is refused with "Stop the assistant before deleting this
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
  with `afterSequence`; the service sends only what changed (a `resume`), or a
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
  lists, nested records as nested rows, lists of records as a count.
- **Queued messages**: messages sent while a run works wait in the composer
  as queued rows, not in the timeline. Each can be removed before it starts:
  the row's button asks the service to stop that queued run, and
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
