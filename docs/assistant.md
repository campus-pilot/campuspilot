# In-app assistant

The assistant lets staff ask for anything they could do in the management app,
in plain language. It is a **separate service** (`apps/assistant`) that knows no
CampusPilot business logic: it reaches school data only through the API's MCP
endpoint, as the signed-in user, with the same permissions.

## Pieces

| Piece | Where | Owns |
| --- | --- | --- |
| Assistant service | `apps/assistant` | Agent loop (Restate), Claude calls, conversations, approvals, token usage, live stream |
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
   advanced ones are deferred to Claude's tool search.
5. A write pauses on a Restate awakeable until the user approves or declines it
   in the UI. Stop cancels a pending approval and aborts a streaming step.
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

`ASSISTANT_PROVIDER` picks the provider for **new** conversations; each
conversation records its `provider` and `model` and stays on them, because
transcripts are provider-specific. Runs record the provider and model they used,
and usage is normalised to one shape (`inputTokens` excludes cache reads), so
benchmarks and limits compare like with like. Add a provider by implementing
`ModelProvider` and registering it in `providers/registry.ts`.

## Rules and where they live

- **Security policy, enforced by the API** (`packages/api/src/assistant/tool-policy.ts`,
  applied in `requireAuth` for the `assistant` principal): only school modules;
  no billing, dashboard (money totals), platform, account or hidden procedures;
  no bills, receipts or statements through document tools; only the
  conversation's own school. The service cannot widen any of this.
- **Approval policy, owned by the service** (`apps/assistant/src/runtime/tools.ts`,
  `requiresApproval`): every write waits for the user. Reads run immediately.
- **Permissions**: OPA decides every tool call as the user. `school.assistant.use`
  (all school roles) decides who may use the assistant at all.

## Limits and feature flags (integration point)

Nothing is limited yet. When platform feature flags and school-level limits
arrive, plug them in at **one place**: `apps/assistant/src/entitlements.ts`
(`configureEntitlements`). It is asked `checkRunAllowed({ schoolId, userId })`
before every run, and its reason is shown to the user. Usage is already
recorded per run in `assistant.assistant_run` with `school_id`, `user_id`,
`model`, `surface`, `model_request_count` and input, output, cache-read and
cache-write token counts, so limits can count real usage, and the admin app's
*AI Usage* page can read it from the service.

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
   service registers itself with Restate at boot.
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
- `table`, `stats`, `details`, `bars`, `notice`: composed from design-system
  pieces in `packages/components/src/assistant/views` (dashboard tiles and bar
  lists, row-hairline tables, the app's badge tones).

To add a view, extend the contract's union, render it in `assistant-view.tsx`,
and describe it in `SHOW_VIEW_TOOL_DESCRIPTION`.

## Streaming and weak networks

Adapted from T3 Code's data layer:

- **Text** streams as ordered `{offset, delta}` frames, released a line at a time
  (whole words after a short hold; whole lines inside code fences). New blocks
  fade in. The text so far is kept in Redis for viewers who reconnect.
- **Resume**: the client tracks the highest sequence it holds and reconnects
  with `afterSequence`; the service sends only what changed (a `resume`), or a
  snapshot when that is over 200 changes. Data stays on screen meanwhile.
- **Liveness**: a heartbeat every 15s when idle; the client treats 40s of
  silence as a dead connection, reconnects with equal-jitter backoff, and
  catches up at once when the tab becomes visible or the network returns. A
  "Reconnecting…" notice appears only after a 2s grace.
- **Sending**: messages appear at once (read from the mutation cache), retry
  automatically with the same request id on network or server errors, and show
  "Not sent · Retry" if they still fail; the draft is restored.

## Look and feel

The chat's structure follows T3 Code's redesign (maria-rcks,
pingdotgg/t3code #28839 to #28845, plus #26155, #26255, #27305, #27978 and
#25299); its paint is the app's own flat shadcn language (solid `card` and
`muted` fills, 1px `border`, the app's radius scale, no gradients). Surface
recipes live in `packages/ui/src/styles/assistant.css`; components pick one
(`assistant-well`, `assistant-raised`, `assistant-bubble`) rather than
painting their own.

- **Composer**: one bordered surface, painted and focused like the app's
  inputs, never a box inside a box. The send control is muted until there is
  something to send, then takes the primary colour; Queue and Stop share its
  place. The trust cue is a caption under the box.
- **Requests in the composer**: a change waiting for approval is decided in
  a section above the message field (Enter approves and Escape declines when no field has focus);
  its timeline row only names it, in amber. Messages sent while a run works
  wait there as queued rows, not in the timeline.
- **Turns**: each run has a 32px work bar over a hairline ("Working for 12s",
  "Paused at 8s", "Worked for 18s"). A finished turn folds its tool calls,
  decisions and interim replies into the bar; views and the final answer stay
  visible, and only that answer shows time and copy on hover.
- **Content**: tables, record lists, stats, details, bars and code sit in an
  inset well with hairline separators; no middle-dot joined metadata and no
  spaced capitals.
