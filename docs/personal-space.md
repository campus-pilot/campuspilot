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

Each is its own column, read on its own (migration `0079_personal-space.sql`):

| Fact | Where | Meaning |
| --- | --- | --- |
| School kind | `school.kind` (`school` \| `personal`, default `school`) | A real school or a personal space. Set when the row is created and never changed. Never inferred from the name, the owner, the tier or the absence of sessions. |
| One per person | partial unique index `school_personal_owner_unique` on `owner_user_id` where `kind = 'personal'` | A person owns at most one personal space. |
| Not a demo | CHECK `school_personal_not_demo_check` | A demo school is never a personal space. |
| Paper kind | `exam_question_paper.kind` (`exam` \| `standalone`, default `exam`) | An exam paper keyed by its plan, or a standalone paper. Never changed. |
| Exam key | `session_id`, `exam_slug`, `class_id`, `subject_slug`, `mode_slug` (nullable) | All set for an exam paper, all null for a standalone one (CHECK `exam_question_paper_kind_key_check`). The unique key is unchanged: NULLs never collide. Code that reads an exam paper's key from a row uses `examKeyPart` (a null there is a broken row). |
| Paper details | `details_school_name`, `details_class_name`, `details_subject_name`, `details_exam_name` (nullable text, at most 160 characters each) | What a standalone paper prints about its school, class, subject and examination. Always null for an exam paper (same CHECK). **Not revisioned**: every saved version overwrites all four in the save's own transaction with the details that save supplied. |
| Version template | `exam_question_paper_version.template_revision_id` (nullable) and `paper_kind` | Null exactly for a version of a standalone paper (CHECK `exam_question_paper_version_template_check`); `paper_kind` is held equal to the paper's kind by the composite foreign key `(paper_id, paper_kind)` to `exam_question_paper (id, kind)`. |
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
3. **`already_has_one`**: the person owns a personal space.
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
the status, inserts the school (`kind = personal`, named "{name}'s personal
school" or "My personal school" without a name, empty location, no standing
tier, the person as owner), starts the self-service trial
(`SELF_SERVICE_TRIAL_TIER` for `SELF_SERVICE_TRIAL_PERIODS` billing period),
switches the assistant on with `SELF_SERVICE_ASSISTANT_MONTHLY_LIMIT_USD`, and
makes the person a member with the principal role. It writes **no
`school_creation` row** (the space does not use the school creation allowance:
the person can still create one school) and offers no guided setup.

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
- Platform administration (`systemAdmin.*`) is not held (the admin app renews
  a personal space's trial with the ordinary Billing card).

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
  and take `details`, all four, which replace the paper's).
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
to 160 characters, empty is null). A missing or malformed block saves the
paper without details. A repaired answer that leaves the block out keeps the
first answer's details.

## Assistant and MCP

- Tool metadata carries the kinds (`ASSISTANT_TOOL_META.schoolKinds`), and
  `toolCatalogForSchool` (`packages/assistant/src/runtime/tools.ts`) keeps only
  the tools that serve the conversation's school's kind, read fresh with its
  features (`readSchoolKind`). A personal space's conversation has the
  standalone paper tools and showing a view; its facts block says it is a
  personal space (`PERSONAL_SPACE_FACT`, kept out of the cached instructions).
- External MCP clients: the gate refuses other tools per `schoolId`, and the
  listing leaves out tools that serve none of the kinds of the user's schools
  (`schoolKindsOfUser`), so someone whose only school is a personal space sees
  only its tools.
- The paper's chat is seeded with `{ kind: 'standalone_question_paper', paperId }`
  and shared with the paper by id; reaching it needs the school's standalone
  paper permission (`conversation-access.ts`). Its photographed pages are
  shown to the model as for an exam paper.
- The standalone chat guide (`STANDALONE_QUESTION_PAPER_GUIDE`) tells the
  agent the paper carries its own heading, that every save sends all four
  details, and that when the user changes the school, class, subject or exam
  in the paper it must change the details in the same save.
- There is no general assistant page and no voice mode in a personal space.

## Management

- Routes `/school/[schoolId]/papers` and `/papers/[paperId]` in the `(personal)`
  route group with `PersonalSpaceShell`: no sidebar on any screen size; the top
  bar has a **Personal** label and the school switcher on the left, the trial
  status and the user menu on the right. The shell renders only for a school
  of kind `personal` (any other school there is not found).
- Every workspace, settings and guided setup address of a personal space opens
  its papers (`RealSchoolOnly`, before those pages mount), and the voice
  overlay is not mounted there (`OnlyInRealSchool`).
- The papers page (`StandalonePaperList`): `TableSearchBar` and
  `TableFilterBar` (School, Class, Subject, Exam, from the papers' details)
  over a compact table; **Create question paper** creates a paper and opens it.
- The paper page (`StandalonePaperWorkspace`) is the exam paper studio:
  photos, generate, chat, versions, preview and download, fed by the
  standalone procedures through `components/question-paper/paper-target.ts`,
  the one place that maps a paper of either kind to its procedures, upload
  routes, permission and seed.
- Switcher: a personal space is its own **Personal space** entry; a school
  opens its entry, a personal space its papers. **Create a school** is offered
  as everywhere (`useOffersSchoolCreation`).
- Landing (`/school`, `landingSchoolOf`): a valid stored selection; else the
  first real school; else the personal space; else the "not part of a school"
  page. Landing never creates a personal space.
- Trial end: a personal space becomes read-only like any school. Its notice
  tells the person to contact us, linking `{NEXT_PUBLIC_WEBSITE_URL}/contact`
  in a new tab (`target="_blank" rel="noopener noreferrer"`), never the admin
  Billing card. `NEXT_PUBLIC_WEBSITE_URL` is a build variable of the
  management app (`packages/env/src/management.client.ts`, the Dockerfile, the
  release workflow's build args; https://campuspilot.in in production).

## Admin

A **Personal** badge (`SchoolBadges`) and a **Kind** filter on Organizations
(`systemAdmin.listSchools` `filters.kind`). A personal space's trial is
renewed with the existing Billing card.

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
