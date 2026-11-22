# Personal space and standalone question papers

A **personal space** is one person's own place for question papers: they
photograph a handwritten paper (or attach a PDF, or describe one) and the AI
writes the whole printed paper, heading included. It is a school of kind
`personal`, so billing, the trial, the AI limit, storage, OPA and the
read-only gate all work exactly as for a school. It holds only **standalone
question papers**: papers with no session, examination, class, subject or
mode, and no school template. Real schools are not changed: they have no
standalone papers.

This guide is the canonical reference. Read it before changing who gets a
personal space, the school kind gate, standalone papers (their procedures,
rendering, details or generation), the personal space screens, or before
letting another procedure serve personal spaces.

## The facts

Each is its own column, read on its own (migrations `0079_personal-space.sql`
and `0080_personal-space-limits.sql`):

| Fact | Where | Meaning |
| --- | --- | --- |
| School kind | `school.kind` (`school` \| `personal`, default `school`) | A real school or a personal space. Set when the row is created and never changed: the trigger `school_kind_immutable` (`school_guard_kind`) refuses any UPDATE that changes it, which is what lets the API cache a school's kind in process. Never inferred from the name, the owner, the tier or the absence of sessions. |
| Had one | `user.personal_space_created_at` (nullable) | When the person's personal space was created; set in the provisioning transaction and never cleared, not even when the space is deleted. `already_has_one` is decided from it. |
| One per person | partial unique index `school_personal_owner_unique` on `owner_user_id` where `kind = 'personal'` | At most one live personal space per owner (a backstop; `personal_space_created_at` is the rule). |
| Not a demo | CHECK `school_personal_not_demo_check` | A demo school is never a personal space. |
| Paper kind | `exam_question_paper.kind` (`exam` \| `standalone`, default `exam`) | An exam paper keyed by its plan, or a standalone paper. Never changed. |
| Exam key | `session_id`, `exam_slug`, `class_id`, `subject_slug`, `mode_slug` (nullable) | All set for an exam paper, all null for a standalone one (CHECK `exam_question_paper_kind_key_check`). The unique key is unchanged: NULLs never collide. Code that reads an exam paper's key from a row uses `examKeyPart` (a null there is a broken row). |
| Paper details | `details_school_name`, `details_class_name`, `details_subject_name`, `details_exam_name` (nullable text, at most 160 characters each) | What a standalone paper prints about its school, class, subject and examination. Always null for an exam paper (same CHECK). **Not revisioned**: every saved version overwrites all four in the save's own transaction with the details that save supplied. |
| Version template | `exam_question_paper_version.template_revision_id` (nullable) and `paper_kind` | Null exactly for a version of a standalone paper (CHECK `exam_question_paper_version_template_check`); `paper_kind` is held equal to the paper's kind by the composite foreign key `(paper_id, paper_kind)` to `exam_question_paper (id, kind)`. |
| Thumbnail size | `exam_question_paper_page.thumb_byte_size` (nullable) | The stored thumbnail's bytes, written with `thumb_s3_key` by the worker and by a page turn, so the storage quota adds stored sizes instead of estimating (CHECK `exam_question_paper_page_thumb_size_check`). Null for thumbnails made before the column (exam papers only). |
| Shared conversation | `assistant_conversation.standalone_paper_id` | The standalone paper a conversation started on its screen is shared with. A plain value without a foreign key (like the exam paper key); never set together with the exam paper key (CHECK). Deleting the paper clears it. |

## Who gets one

`readPersonalSpaceStatus` (`packages/api/src/personal-space/personal-space.service.ts`)
decides from the facts, in this order (`PERSONAL_SPACE_REFUSALS` in
`personal-space.contract.ts`); the first that applies is the refusal:

1. **`demo_account`**: `user.demo_school_id` is set.
2. **`no_google_account`**: no `account` row with `provider_id = 'google'`.
   This is read from the account row, never from `user.email_verified`: a
   school invitation marks the email verified too (Better Auth needs that to
   link Google to an invited account), and an invited person must never get a
   personal space through it.
3. **`already_has_one`**: the person has had their personal space
   (`user.personal_space_created_at` is set): one over the life of the
   account, so deleting the space does not make them eligible again.
4. **`member_of_school`**: the person is a member of any school. Someone with
   a school is never given a personal space.

A refused creation is FORBIDDEN with `data: { reason: 'PERSONAL_SPACE_REFUSED', refusal }`
(`personalSpaceRefusalOf`).

Two ways create one, through the same `createPersonalSpace`:

- **Automatically after a Google sign-up.** Better Auth's
  `databaseHooks.user.create.after` (`packages/auth/src/server.ts`) calls
  `afterUserCreated` (`packages/auth/src/google-sign-up.ts`), which runs the
  handler only when the endpoint that created the user is a Google sign-in
  (`isGoogleSignUpEndpoint`: `/callback/:id` with `id = google`, or
  `/sign-in/social` with `provider = google`). Better Auth 1.7.16 passes the
  endpoint context (`GenericEndpointContext | null`) and queues `after` hooks
  until the user and its Google account are committed, so the handler reads
  the linked account like the button does. `school.inviteMember` and the demo
  seed create users through the admin plugin (`/admin/create-user`), so an
  invited person and a demo login never get one this way. The handler
  (`createPersonalSpaceAfterGoogleSignUp`) is registered by `apps/server` at
  boot (`registerGoogleSignUpHandler`; `@campuspilot/auth` cannot import the
  API); a refusal creates nothing and any failure is logged, never failing the
  sign-in.
- **On request.** `personalSpace.create`, from the "You are not part of a
  school yet" page (**Create personal space**, shown while
  `personalSpace.getStatus` has no refusal).

`createPersonalSpace`, in the caller's transaction: locks the person, checks
the status, then provisions the school with `provisionSelfServiceSchool`
(`school-creation/school-provisioning.ts`), the one start shared with a
self-created school so the two cannot drift: the school row with the person as
owner and no standing tier, the self-service trial (`SELF_SERVICE_TRIAL_TIER`
for `SELF_SERVICE_TRIAL_PERIODS` billing period), the assistant on with
`SELF_SERVICE_ASSISTANT_MONTHLY_LIMIT_USD`, and the person as a member with the
principal role. What differs is stated by each caller: a personal space is
`kind = personal`, named "{name}'s personal school" ("My personal school"
without a name), with an empty location and the slug `personal-` plus the
random part of a fresh id (`personalSpaceSlug`): the slug never carries the
person's name and is inserted once, with no search for a free one. It writes
**no `school_creation` row** (the space does not use the school creation
allowance: the person can still create one school) and offers no guided setup.

Logging: the two catch-all logs of the automatic path
(`auth.google-sign-up.handler-failed`, `personal-space.create-after-sign-up.failed`)
log only `errorFacts(error)` (`@campuspilot/logger/error-facts`: the error's
class, its first code along the `cause` chain and a constraint name) with the
user id, never `err`: a Drizzle query error's message carries the query's
values, the space's name ("{name}'s personal school") among them, and the log
sanitiser keeps error messages.

When the person's account is deleted: nothing in the apps deletes accounts
today (no procedure or screen does; the demo purge removes only demo logins,
which never have a personal space). Better Auth's admin plugin endpoint
`/admin/remove-user` is enabled and a platform administrator could call it over
HTTP; it would leave the personal space behind with `owner_user_id` null
(`ON DELETE SET NULL`) and still named after the person, with its papers. This
is a known gap: a user deletion path, when one is added, must delete the
person's personal space with everything it holds first. No CHECK forbids an
ownerless personal space, so deleting a user is never blocked by it.

## Limits

A personal space is free and becomes read-only when its trial ends, and
read-only means nothing can be deleted either, so its size and its printing
are bounded by named limits (`packages/api/src/personal-space/personal-space.limits.ts`,
checked by `personal-space.storage.ts`). Each refusal has its own
`data.reason` (`PERSONAL_SPACE_LIMIT_REASONS`, `personalSpaceLimitOf`) and a
message the person reads next to the action (`PERSONAL_SPACE_LIMIT_MESSAGES`).

| Constant | Value | What it bounds | Refusal |
| --- | --- | --- | --- |
| `PERSONAL_SPACE_STORAGE_QUOTA_BYTES` | 2 GiB (2,147,483,648 bytes) | Every byte the space stores for its papers (`personalSpaceStoredBytes`): page photos with their thumbnail (`thumb_byte_size`) and model copy (`model_byte_size`), figure images, and every version's PDF and Word file (once downloaded; `artifact.byte_size`). | BAD_REQUEST `PERSONAL_SPACE_STORAGE_FULL` |
| `STANDALONE_PAPERS_PER_SPACE_LIMIT` | 100 | Papers per space, used or not (`createStandalonePaper`). | BAD_REQUEST `PERSONAL_SPACE_PAPER_LIMIT` |
| `STANDALONE_PAPER_MAX_VERSIONS` | 50 | Versions per standalone paper (versions are never deleted one by one). | BAD_REQUEST `STANDALONE_PAPER_VERSION_LIMIT` |
| `STANDALONE_SAVES_PER_WINDOW` per `STANDALONE_SAVE_WINDOW_MS` | 30 per minute | Version saves (each one a printed PDF) of the space's standalone papers, every way in: the app, the assistant and MCP. The AI job's saves are not counted or refused (they are bounded by the job cap and the AI limit, and refusing one would waste a paid generation). | TOO_MANY_REQUESTS `STANDALONE_PAPER_SAVE_RATE` |
| `PERSONAL_SPACE_MAX_RUNNING_JOBS` | 1 | Queued or running AI generations of the space, so concurrent jobs cannot overshoot the AI limit's cached spend sum. Real schools keep `QUESTION_PAPER_MAX_RUNNING_JOBS_PER_SCHOOL`. Chosen by the school's kind in `assertSchoolJobCapacity`. | CONFLICT |

How they are checked:

- **Where.** Storage: reserving pages (refused once the space is full), storing
  a photo (with its bytes), storing a figure (with its bytes), saving a
  version (with its PDF's bytes), and the first Word download of a version (with
  the file's bytes; a full space cannot make one, see docs/question-papers.md "Word download"). Versions and save rate: every standalone
  version save. Starting a generation refuses up front when the paper already
  has its versions or the space is full, before any model cost; the job's save
  checks again and fails as `storage_full` or `version_limit`
  (`QUESTION_PAPER_JOB_FAILURES`) when the space filled up meanwhile.
- **When.** Twice: an unlocked early look before anything is written, copied or
  printed (a refused save copies no chat image and renders no PDF), and the
  authoritative check inside the transaction that records the write, under a
  transaction-scoped advisory lock per school (`personal-space-limits:{id}`,
  taken after the paper's row lock), so concurrent requests of one space are
  counted one after the other. Saves that pass the early look at the same
  moment may each render before one of them is refused in its transaction.
- **What is counted.** Only facts the rows store; nothing is estimated. A page
  still awaiting its photo has no size yet; its photo is counted when it
  arrives. Its thumbnail and model copy are made by the worker from an
  accepted photo and counted once they exist (they are never refused, so the
  space can pass the quota by the copies of the photos being processed; a page
  turn replaces them). The quota is decided from the school's kind
  (`readSchoolKind`), not the paper's: a real school has none.
- **The save rate** is counted from the stored versions themselves (their
  `created_at` within the window, `clock_timestamp()`), not from request
  counters, so it holds for the API, MCP and the assistant alike. The per-IP
  rate limiter of the HTTP routes (`apps/server/src/rate-limit.ts`) is not used
  for it: saves are oRPC procedures and tool calls, not one HTTP route, and
  the limit is per space, not per client IP.
- **Not covered.** The assistant's chat attachments are stored per
  conversation with their own size limits (docs/assistant.md) and are not part
  of the quota; a chat image becomes part of it when a save copies it into the
  paper as a figure.

In the app: page uploads show the refusal on the photo's row, starting a
generation and a failed job show it under the start button, creating a paper
shows it beside **Create question paper**, and the assistant tells the person
what a refused save said.

## What is public

A personal space is named after a real person, so none of the anonymous
surfaces that name or resolve schools shows it:

| Surface | For a personal space |
| --- | --- |
| Cadet Portal school search (`cadet.searchSchools`) | never returned, not even for its exact code |
| Cadet sign-in school (`cadet.getSignInSchool`) and the admission sign-in (`cadet-sign-in.ts`) | not found; a personal space has no students and no Cadet Portal |
| `/blob/school/{id}/manifest.webmanifest`, `/logo`, `/cadet.webmanifest` | 404 like an unknown school; the management app links CampusPilot's own manifest instead, so installing from a personal space installs CampusPilot |

The web app lists no schools. Add any new public surface that names or
resolves a school to this table with an explicit decision.

Both procedures are mounted as `personalSpace` (no `schoolId`) and hidden from
MCP and the assistant.

## The school kind gate

Every procedure says which kinds of school it serves: `schoolKinds` in its
metadata (`ProcedureMeta`, `packages/api/src/mcp-metadata.ts`). Without it a
procedure serves **real schools only** (`DEFAULT_SCHOOL_KINDS`), so a new
procedure fails closed for personal spaces.

`requireAuth` (`packages/api/src/index.ts`, next to the read-only gate) reads
the input's `schoolId` as the read-only gate does and calls
`assertSchoolKindServedByCaller` (`school-access/school-kind.service.ts`): a
school of a kind the procedure does not serve is refused, **reads included**.

- A member is told why: FORBIDDEN with
  `data: { reason: 'SCHOOL_KIND_UNSUPPORTED', schoolKind }`
  (`schoolKindRefusalOf`, `school-access.contract.ts`).
- Anyone else gets the plain FORBIDDEN of a permission denial, so an outsider
  learns nothing. Unlike the read-only gate, non-members are held too: a
  platform administrator's grants must not write real-school data into a
  personal space.
- Standalone paper permissions exist only in a personal space. OPA grants
  `school.standalone_paper.read` and `.manage` (to the principal) only for an
  assignment whose school is of kind `personal`
  (`personal_space_actions` in `packages/opa/src/policies/school/permissions.rego`):
  `checkPermissions` reads each role row's school kind in the same query and
  passes it as `scope.schoolKind`; an assignment without it is not granted
  them. The assistant's conversation access (`mayReachConversation`,
  `assertMayManageStandalonePaper` in `packages/assistant/src/conversation-access.ts`)
  also checks the school's kind itself before the permission.
- Platform administration is not held (the admin app renews a personal
  space's trial with the ordinary Billing card). It is an explicit fact of the
  procedure, `meta.platformAdministration` (`platformAdminProcedure` in
  `packages/api/src/index.ts`), never read from the procedure's path or input:
  every `systemAdmin.*` procedure is built on it and no other procedure is
  (`school-kind.integration.test.ts` checks both), so an MCP call, which
  passes the catalogue path but needs none, is decided the same way.

`requireAuth` decides both of its school gates in order
(`assertSchoolGatesByCaller`): the kind, then for a write the read-only gate
(`assertSchoolWritableByCaller`, unchanged: members only, suspension and plan).
The kind comes from a bounded process cache (`readSchoolKind`, at most
`SCHOOL_KIND_CACHE_SIZE` schools, least recently used dropped first). It needs
no expiry because a school's kind never changes; a missing school is not
remembered. So a read of a school of a kind the procedure serves runs no gate
query after the first; membership is read only to word a kind refusal, and the
read-only facts only for a write.

Upload routes outside oRPC hold the same rule with the kinds they serve:
admissions, the school logo and exam question paper pages are
`REAL_SCHOOLS_ONLY`; the standalone paper routes are `PERSONAL_SPACES_ONLY`;
assistant attachments serve both (the assistant service is not kind-gated; its
tools are).

What serves personal spaces today (`school-kind.integration.test.ts` lists it
and fails on any other declaration): `school.getFeatureFlags` (both kinds) and
every standalone paper procedure (`personal` only). `school.listMySchools`,
`authorization.checkPermissions`, `personalSpace.*` and `schoolCreation.*`
take no `schoolId`, so the gate does not apply to them.

## Standalone papers

A standalone paper is an `exam_question_paper` of kind `standalone`. Pages,
jobs, versions, figures and chat attachments are reused by paper id. The
shared services (`routers/school/question-paper`) work on a **resolved paper**
(`ResolvedPaper` in `question-paper.scope.ts`): an exam paper's `PaperScope`
(`kind: 'exam'`) or a `StandalonePaperScope` (`kind: 'standalone'`,
`resolveStandalonePaper`). Each kind is told apart by `isStandalonePaper`
(`kind === 'standalone'`; a scope journaled by a job before `kind` existed is
an exam paper). The kind-specific parts are each in one place:

| | Exam paper | Standalone paper |
| --- | --- | --- |
| Row | `findPaper` by key, created by the first upload or save | `findPaperOf` by id, created by `createStandalonePaper` |
| Writable | active session, exam not completed, plan exists (`assertPaperWritableLocked`) | nothing beyond the school's read-only gate |
| Template | the school's selected `question_paper` template, pinned on the version | the built-in plain A4 shell, no revision |
| `templatePrints` | read from the template (`null` = not known) | always `{ above: [], below: [] }` (known to print nothing) |
| `plan_max_marks` | the plan's maximum | null |
| PDF artifact | session, exam and class set | none set; named from the details |
| Conversations | shared by key | shared by `standalone_paper_id` |

### Procedures

In the `school` router, every input flat (`{ schoolId, paperId, ... }`) so MCP
clients and the assistant call them directly
(`routers/school/standalone-paper`):

- Tools (advanced, module `exams`): `listStandalonePapers` (search over the
  four details, filters matching one detail exactly), `listStandalonePaperFilterOptions`
  (the distinct details of the school's own papers), `createStandalonePaper`,
  `getStandalonePaper`, `getStandalonePaperDraft`, `listStandalonePaperVersions`,
  `learn_standalone_question_paper`, `validateStandalonePaperDraft`,
  `saveStandalonePaperVersion` and `editStandalonePaper` (both skip approval
  and take `details`, all four, which replace the paper's). In the in-app
  chat a save (and `getStandalonePaperDraft`) may name a `draftId`: it is
  found among the conversation's `validateStandalonePaperDraft` calls
  (`findChatDraftContent` picks the validate tool by the paper's kind,
  `DRAFT_TOOL_NAME`), never an exam paper's drafts.
- Human only (hidden): `getStandalonePaperDetail`, `reserve/release/delete/rotate/reorderStandalonePaperPage(s)`,
  `startStandalonePaperGeneration`, `deleteStandalonePaper`,
  `getStandalonePaperPreview`, `previewStandalonePaperDraft`, `getStandalonePaperDownload`.
- HTTP: `POST/GET /api/blob/schools/:schoolId/standalone-papers/:paperId/pages/:pageId[/:variant]`
  and `GET .../versions/:versionNo/pdf` (`standalone-paper.http.ts`).

Permission order: the school kind (`requireAuth`), the school permission
`school.standalone_paper.read` or `.manage` (granted to the principal, the
role a personal space's owner holds; `packages/opa`), then the assistant gate
(`requireQuestionPaperAssistantAccess`; starting a generation also needs the
school under its AI limit). There is no session, lifecycle or template
requirement. There is no copy from an earlier paper (that is a feature of a
class and subject).

### Rendering

`STANDALONE_QUESTION_PAPER_SHELL` (`question-paper.standalone-shell.ts`) is a
constant: one element holding `{{{questionPaper.bodyHtml}}}` exactly once,
no logo and no school facts. `renderStandaloneQuestionPaperDocument`
(`question-paper.render.ts`) puts it through the same pipeline as a school's
template: rendered with the constant slot, sanitised as a `question_paper`
document under the same CSP, laid out on A4 by `combineDocuments`, and only
then is the slot replaced by the body (sanitised twice, then KaTeX and figure
data URIs, as for any paper). The sanitiser, the CSP and the security notes of
"The renderer contract" in [Question papers](question-papers.md) are
unchanged; the shell adds no insertion point.

### The generation job

The job branches on the begun job's `paperKind` (absent in an older journal:
an exam paper). For a standalone paper it resolves the paper by id, needs no
template, journals the empty `templatePrints`, sends no plan facts, and uses
the standalone prompts (`STANDALONE_PAPER_JOB_*` in `prompt.ts`: the same text
with their own output and heading sections). The model writes the whole
heading and returns the details after the fragment as one fenced block
labelled `paper-details` holding a JSON object. `splitQuestionPaperDetails`
(`packages/question-paper/src/details.ts`) takes the block out before the
fragment is read (so it is never mistaken for the paper), parses it and
normalises every value (whitespace collapsed, control characters removed, cut
to 160 characters, empty is null). A missing or malformed block is never on
its own a reason for a second request or for failing the job: a first answer
that is otherwise valid is saved at once. Only when the first answer needs a
repair anyway is the missing block added to its problems
(`DETAILS_MISSING_PROBLEM`), so the repair returns it too. A repaired answer
that leaves it out takes the first answer's details when that one had a block.
When no answer has a readable block, the version **states no details and does
not change the paper's** (`details: 'keep'` in `saveQuestionPaperVersion`):
the stored details stay as the last version that stated them left them. Chat
saves always state all four.

## Assistant and MCP

- Tool metadata carries the kinds (`ASSISTANT_TOOL_META.schoolKinds`), and
  `toolCatalogForSchool` (`packages/assistant/src/runtime/tools.ts`) keeps only
  the tools that serve the conversation's school's kind, read fresh with its
  features (`readSchoolKind`). A personal space's conversation has the
  standalone paper tools and showing a view; its facts block says it is a
  personal space (`PERSONAL_SPACE_FACT`, kept out of the cached instructions).
- External MCP clients: the gate refuses other tools per `schoolId`. The
  listing may hide a tool only when the user's memberships prove it unusable
  (`listingSchoolKindsOf`): a member's listing leaves out tools that serve none
  of the kinds of their schools, so someone whose only school is a personal
  space sees only its tools. A platform administrator (who acts on any school
  through platform grants) and a user with no membership (nothing proves a
  tool unusable) are never narrowed by kind. A tool whose input has no
  `schoolId` (account-level, such as `school.listMySchools`) or that is
  platform administration is not held by the kind gate and is listed for every
  kind (`toolSchoolKindsOf`), so such a person can still find their schoolId.
  A tool call passes the tool's catalogue path to the procedure.
- A saved version shows in the chat with the `standalone_question_paper` view
  (`paperId`, `versionNo`), like an exam paper's `question_paper` view.
- The paper's chat is seeded with `{ kind: 'standalone_question_paper', paperId }`
  and shared with the paper by id; reaching it needs the school's standalone
  paper permission (`conversation-access.ts`). Its photographed pages are
  shown to the model as for an exam paper.
- The standalone chat guide (`STANDALONE_QUESTION_PAPER_GUIDE`) tells the
  agent the paper carries its own heading, that every save sends all four
  details, and that when the user changes the school, class, subject or exam
  in the paper it must change the details in the same save.
- There is no general assistant page and no voice mode in a personal space.
  The server refuses voice there too (`voiceRefusal` in
  `packages/assistant/src/voice/access.ts`, for the status read and for
  admission), not only the screens.

## Management

- Routes `/school/[schoolId]/papers` and `/papers/[paperId]` in the `(personal)`
  route group with `PersonalSpaceShell`: no sidebar on any screen size; the top
  bar has a **Personal** label (a link to the papers) and the school switcher
  on the left, then the breadcrumbs (Papers › the paper, the way back; on a
  phone only "Papers"), the trial status and the user menu on the right. The shell renders only for a school
  of kind `personal` (any other school there is not found).
- Every workspace, settings and guided setup address of a personal space opens
  its papers (`RealSchoolOnly`, before those pages mount), and the voice
  overlay is not mounted there (`OnlyInRealSchool`).
- The papers page (`StandalonePaperList`): `TableSearchBar` and
  `TableFilterBar` (School, Class, Subject, Exam, from the papers' details)
  over a compact table; **Create question paper** opens a paper to write. The
  shared studio (its upload queue, detail polling, chat and page URLs) is built
  around an existing paper id, so the paper exists before its first photo,
  message or save. `createStandalonePaper` therefore returns an **unused**
  paper the space already has (no page, no version, no conversation; the
  oldest, `reused: true`) instead of creating another, under the school's row
  lock so creations sent at once get the same paper; only without one does it
  create a paper. A space holds at most `STANDALONE_PAPERS_PER_SPACE_LIMIT`
  (100) papers, counting every paper; beyond that it refuses with
  BAD_REQUEST and asks to delete some. An unused paper is deleted from its
  menu; nothing hides or prunes papers. The filter values are read behind the same gates as the list and
  read again after every change to a paper and every delete.
- The paper page (`StandalonePaperWorkspace`) is the exam paper studio:
  photos, generate, chat, versions, preview and download, fed by the
  standalone procedures through `components/question-paper/paper-target.ts`,
  the one place that maps a paper of either kind to its procedures, upload
  routes, permission and seed.
- Switcher: a personal space is its own **Personal space** entry in a
  **Personal** group; a school opens its entry, a personal space its papers.
  The **Your schools** group is left out when the person has no school (never
  shown empty). **Create a school** is offered as everywhere
  (`useOffersSchoolCreation`); creating one opens the new school's guided
  setup: the form reads the school list again even where no screen shows it
  (`refetchType: 'all'`), so the new school's access check finds it instead of
  the cached list, which would fall back to the personal space.
- Landing (`/school`, `landingSchoolOf`): a valid stored selection; else the
  first real school; else the personal space; else the "not part of a school"
  page. Landing never creates a personal space.
- Trial end: a personal space becomes read-only like any school. Its notice
  tells the person to contact us, linking `{NEXT_PUBLIC_WEBSITE_URL}/contact`
  in a new tab (`target="_blank" rel="noopener noreferrer"`), never the admin
  Billing card. `NEXT_PUBLIC_WEBSITE_URL` is a build variable of the
  management app (`packages/env/src/management.client.ts`, the Dockerfile, the
  release workflow's build args; https://campuspilot.in in production).
  A refused change says the same: the API words the read-only refusals for a
  personal space in its own terms (`PERSONAL_SPACE_WRITE_REFUSAL_MESSAGES`,
  `schoolWriteRefusalMessageOf`: the trial ended or the space is suspended,
  the papers can still be viewed and downloaded, contact us), for procedures,
  uploads, the assistant and a generation that stops; never about a school or
  billing. The reason (`data.reason`) is unchanged. Beside **Create question
  paper** the app adds the contact link (`PersonalSpaceErrorText`,
  `personalWriteRefusalOf`); in the studio the notice under the bar carries it.
- Phones: the papers table keeps only Subject (with the class, exam and school
  under it) and Status below `sm`; the other columns are left out with CSS
  (`meta.className` on a `DataTable` column, `hidden sm:table-cell`), so the
  list reads without sideways scrolling.

## Admin

A **Personal** badge (`SchoolBadges`) and a **Kind** filter on Organizations
(`systemAdmin.listSchools` `filters.kind`); a personal space shows no setup
status there (it has no guided setup) and a dash for its empty location. A
personal space's trial is renewed with the existing Billing card.

Its dashboard shows what matters for one person's papers
(`systemAdmin.getPersonalSpaceStats`, refused for a real school): papers,
versions, stored bytes against `PERSONAL_SPACE_STORAGE_QUOTA_BYTES`, AI spend
in the current spend window against the assistant's limit, and its plan (the
trial and when it ends). Never the school counts (staff, classes, sessions,
students), and no onboarding badge or location separator in its header.

A personal space's admin pages are its dashboard, AI and storage usage, plan
and features, and settings, all `systemAdmin.*`. Its sessions, staff,
students and document settings (real-school `school.*` procedures) are not in
its navigation, and their addresses say "Not available for a personal space"
instead of calling procedures the kind gate refuses; the Owner card is not
shown (the owner is the person the space belongs to), and
`systemAdmin.updateSchoolOwner` refuses a personal space (BAD_REQUEST). A
personal space has no location: its profile form has no location field and
sends none, and `systemAdmin.updateSchool` refuses a `location` for one. The
school pages wait for the school's kind before showing anything (a loading
line), so a personal space never mounts a real-school page.

## Demo schools

Demo logins never get a personal space (`demo_account`, and the seed creates
users through the admin plugin). Demo schools are never personal (CHECK). The
demo purge needs nothing new: the new facts are columns of tables it already
clears.

## Extending

- A procedure that should also serve personal spaces: add `schoolKinds` to its
  metadata, add it to `PERSONAL_SPACE_PROCEDURES` in
  `school-kind.integration.test.ts`, and say why here. Never widen the
  default.
- A new upload route that takes a school calls `assertSchoolKindServedByCaller`
  with the kinds it serves, before its permission check.
- A new fact about a standalone paper is its own column. Details stay not
  revisioned; if a fact must be kept per version, it belongs on the version.
- A new standalone paper procedure keeps the order: kind, school permission,
  assistant gate, then the paper (`resolveStandalonePaper`).
- Anything kind-specific in the shared question paper services goes through
  `isStandalonePaper` in one helper (see the table above), never a second
  inference.
- Tests: `personal-space.integration.test.ts`, `school-kind.integration.test.ts`,
  `standalone-paper.integration.test.ts`, `details.test.ts`,
  `google-sign-up.test.ts`, `personal-space-model.test.ts`.
