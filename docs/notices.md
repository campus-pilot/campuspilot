# School notices

A notice is a dated announcement a school writes once and addresses to its
staff, to its students (through the Cadet Portal), or to both. This guide is the
canonical cross-layer reference. Read it before changing the `notice` tables,
the staff or Cadet notice procedures, notice rendering, the `notice.*`
notification types, the notice screens in `apps/management` or `apps/cadet`, or
the demo seed's notices.

Related guides, each canonical for its own area:
[Document system](document-system.md) (templates, the restricted renderer, the
sanitizer and PDF conversion that notices reuse),
[School feature flags](feature-flags.md) (the `notices` and `cadet` features),
[Cadet Portal](cadet-portal.md) and [Demo schools](demo-school.md).

Where this guide and the code disagree, the code wins; each rule names the file
that enforces it.

## Data model

`packages/db/src/schema/notice.ts` (migrations `0050_notices.sql`,
`0051_demo-purge-notices.sql`; ID prefix `ntc`).

| Column | Meaning |
| --- | --- |
| `school_id`, `session_id` | A notice belongs to one session: class targeting needs that session's roster. |
| `title` | 1 to 200 characters. |
| `body_mode` | `plain` or `template` (see "Rendering"). |
| `body` | Plain text, or the author's Handlebars/HTML source; at most 200,000 characters. |
| `status` | `draft` or `published`. One way. |
| `to_staff` | Addressed to the school's staff (every member). |
| `cadet_scope` | Students addressed: `none`, `all_classes`, `selected_classes`. |
| `created_by`, `created_at`, `updated_at` | The author (null after the account is deleted). |
| `published_by`, `published_at` | Set together when published. |
| `template_revision_id` | The school's Notice template revision pinned at publication (plain notices only). |
| `published_staff_count`, `published_cadet_count` | Who was notified at publication; null for a draft. |

`notice_class (notice_id, class_id, school_id)` holds the classes of a
`selected_classes` notice. Both foreign keys cascade.

### The two audience facts

The audience is **two independent facts**, never one enum and never derived from
each other:

- `to_staff` says whether staff are addressed;
- `cadet_scope` says which students are addressed.

A CHECK requires at least one (`to_staff OR cadet_scope <> 'none'`). `classIds`
is meaningful only for `selected_classes` and must be empty otherwise
(`validateNoticeAudience` in `notice.dto.ts`), so a stale selection can never
look saved. There is no class "level" in the schema: targeting a level means
choosing its classes.

Other CHECKs: the published facts are all set or all null; a revision can be
pinned only on a published plain notice; the title length.

## Lifecycle and who can do what

`draft → published`, one way. A published notice is immutable: it cannot be
edited, withdrawn or deleted.

| Action (OPA, `packages/opa/src/policies/school`) | Roles | Allows |
| --- | --- | --- |
| `school.notice.read` (`READ_NOTICE`) | all five | List and open published notices and one's own drafts; preview; download a published notice's PDF. |
| `school.notice.draft` (`DRAFT_NOTICE`) | all five | Create a draft; edit and delete **one's own** drafts; preview unsaved content. |
| `school.notice.publish` (`PUBLISH_NOTICE`) | principal, manager | Publish; see, edit and delete **any** draft; preview a publication. |
| `school.notification.failure.notices.receive` | principal, manager | Receive the grouped alert when a notice's WhatsApp copies fail. |

"Own draft" is a data check in the service (`visibleTo`, `viewer.canEdit` in
`notice.service.ts`), not a role check: a draft is visible to its author and to
holders of publish, and reads as NOT_FOUND to everybody else. Every staff member
with `read` sees every published notice of the school, whatever its audience.
The DTO carries `viewer: { canEdit, canPublish }`, so the UI never re-derives
these rules.

No school action is reachable by a platform admin who is not a member of the
school; notices are no exception.

## Feature gating

Two per-school platform features (see [School feature flags](feature-flags.md)):

- **`notices`** gates the whole area. Every staff notice procedure, the Notice
  document template procedures, the notice scope of the delivery log and the
  three Cadet procedures answer the disabled-feature error (`FORBIDDEN` with
  `data: { reason: 'SCHOOL_FEATURE_DISABLED', feature: 'notices' }`) after the
  permission check. `getDashboard.actions.createNotice` is false.
- **`cadet`** gates addressing students. A notice whose `cadetScope` is not
  `none` is refused with the disabled-feature error for `cadet` when it is
  created or updated, and again when its publication is previewed or performed.

Clients tell the error apart with `readSchoolFeatureDisabled(error)`, never by
its message. Management wraps navigation and pages in `RequireFeature` /
`FeaturePage`; the Cadet Portal has no separate features read and treats the
notice procedures' own answer as the signal (see "Cadet Portal").

Nothing is deleted when a feature is switched off: notices, cached PDFs and
already emitted notifications are kept and work again when it is switched on.

## Rendering

All rendering is in `packages/api/src/routers/school/notice/notice.render.ts`
and goes through the document system unchanged: the restricted Handlebars
instance, the sanitizer, the CSP wrapper and Gotenberg.

### Context

`buildNoticeContext` exposes **only**

- `school.{name,location,registrationNo,logoUrl}` (the shared
  `buildSchoolDocumentContext`),
- `session.{startYear,endYear}`,
- `generatedAt`,
- `notice.{title,issuedOn,issuedOnDisplay,paragraphs[]}`.

Nothing about students, staff, results or money is reachable from a notice,
whoever wrote it. `issuedOn` is the publication date (today for a draft) in the
session's finance time zone when one is configured, else UTC.

The context has three descriptions that must stay in step, and the build and
tests keep them so:

| Description | Kept in step by |
| --- | --- |
| `SAMPLE_NOTICE_CONTEXT` (`document.catalog.ts`): what templates are previewed and validated against | `buildNoticeContext` must `satisfies SameFields<typeof SAMPLE_NOTICE_CONTEXT>`; `notice-template.integration.test.ts` compares a real context's field paths with the sample's. |
| `NOTICE_CONTEXT_FIELDS`, `NOTICE_TEMPLATE_VARIABLES`, `NOTICE_TEMPLATE_STARTER` (`notice-template-guide.ts`): what the management editor tells authors | `NOTICE_CONTEXT_FIELDS` is an exhaustive record over the sample's field paths (a new field fails the build until described); `notice.render.test.ts` checks the starter is valid and reads offered variables only. |
| The "Notices:" line of `DOCUMENT_CONTEXT_HELP`: what the school Notice template editor and its AI prompt say | Prose; update it by hand. |

The management editor imports the guide from the API package
(`@campuspilot/api/routers/school/notice/notice-template-guide`, a file with no
runtime imports). Do not copy the variable list or the starter into an app.

### Plain and custom template

| | `plain` | `template` |
| --- | --- | --- |
| What `body` is | Text. Never compiled. | The author's Handlebars/HTML source: the whole document. |
| How it prints | Split into `notice.paragraphs[]` at blank lines (`noticeParagraphs`) and printed escaped by a Notice template. | Compiled by the restricted renderer with `paragraphs` empty. |
| Which template | The school's selected Notice revision, or the built-in `notice-default` design when none is selected. | None. |
| Pinned at publication | The revision used (`template_revision_id`; null for the built-in design). | Nothing to pin. |

A draft or unsaved preview uses the school's current selection; a published
notice always renders from its stored publication time and pinned revision
(`renderPublishedNoticeHtml`), so a later template edit never changes it. The
built-in design is not pinned: a plain notice published without a selected
template renders with whatever `notice-default` the running release ships (its
cached PDF does not change).

Notices use the flowing layout (`combineDocuments(..., 'notice')`): as many
portrait A4 pages as the text needs, each with a 16 mm margin. A notice template
must not set a fixed height, `overflow: hidden` or outer page padding.

### Security contract

- Plain text is data. Markup or `{{…}}` typed by an author is shown, never run.
- A custom template is written by **any** staff role, so it gets the school
  template safeguards (restricted helpers, no scripts, forms, links, external
  URLs or network assets; sanitized output) **plus** structural limits
  (`assertBoundedNoticeTemplate`): no partials or inline partials, block helpers
  nested at most four deep. Both are checked on save
  (`assertValidNoticeTemplate`, which also renders against the sample) and again
  on every render.
- Browsers show notice HTML only in an **empty-sandbox** iframe
  (`DocumentPreview` in `@campuspilot/components/documents`). Never add sandbox
  capabilities and never inject notice HTML into a page.
- The context is school-only (above). Do not add a field that identifies a
  person: the same rendered notice is shown to every recipient.

## Publishing

`publishNotice` (`notice.service.ts`) is one transaction:

1. lock the notice row; refuse NOT_FOUND (not visible) or CONFLICT (already
   published);
2. re-check the `cadet` feature when students are addressed, and that a
   `selected_classes` notice still has a class;
3. render it once with the current time, which validates it and decides the
   revision to pin;
4. resolve the recipients (`resolveNoticeRecipients`);
5. flip `draft → published` conditionally, storing `published_at`,
   `published_by`, the pinned revision and both recipient counts;
6. emit the notification events (`notifyNoticePublished`).

The events are handed to the worker only after the commit. The conditional
update and the event keys both make a replayed publication harmless.

`previewNoticePublish` returns the same recipient resolution without writing
(staff count and the students' per-channel forecast); the management confirmation
dialog shows it. The server decides again inside the publication.

## Notifications

Catalogue: `packages/db/src/notifications/catalogue.ts`; emitter:
`packages/api/src/notifications/emitters/notices.ts`.

| Type | Audience | Channels | Events |
| --- | --- | --- | --- |
| `notice.published` | students | inbox, web push, WhatsApp | One per registered student the notice addresses in its session, key `notice:{noticeId}:{admissionId}`, `sendPriority: 'bulk'`, batch `{ kind: 'notice', id: noticeId }`. |
| `notice.published_staff` | staff | inbox only | Every member of the school, in events of at most 10,000 recipients, key `notice-staff:{noticeId}[:n]`. |

Staff types are in-app only by platform rule; push and WhatsApp exist only for
students. The publisher is notified like every other member.

- **Roster** (`noticeCadetRoster`): registered admissions enrolled in the
  notice's session; for `selected_classes`, those whose class is one of the
  notice's. `all_classes` includes enrolled students without a class.
- **Recipients are fixed at publication.** A student enrolled or a member added
  later is not notified (they still see the notice).
- **Routes.** Staff: the notice page. Students: `/notices/{noticeId}`, from an
  inbox row and from a push click through `/notifications/open`.
- **WhatsApp** uses the `school_document` template with the notice PDF (below),
  or the `school_update` text template when a document cannot be attached.
- **Failures.** WhatsApp failures of one notice are reported as one grouped
  alert (`notification.whatsapp_batch_failed`, batch kind `notice`) to holders of
  `school.notification.failure.notices.receive`.
- **Demo schools** never send outside the inbox (`skipped: demo_school`).

### The delivery log fills in after publication

Publication writes one outbox event per student; the worker turns each into its
inbox and delivery rows afterwards, one event at a time. A notification is not
in the delivery log until then, so a log read right after publishing is shorter
than the audience. `listNotificationDeliveries` therefore returns
`preparation: { pendingCount, failedCount }` for its scope (events not fanned out
yet; events the worker gave up on), and the management log polls every two
seconds while `pendingCount > 0`, saying "N more notifications are being
prepared" (`notification-delivery-log.tsx`, `DeliveryLogPreparation`). The same
applies to billing runs and results releases. Do not treat a short log as final,
and do not compare it with `published_cadet_count` to guess progress: use
`preparation`.

## The notice PDF and its cache

A published notice is immutable and identical for every reader, so its PDF is
rendered once and cached at

```
schools/{schoolId}/notices/{noticeId}.pdf
```

(`noticePdfKey`, `ensureNoticePdfStored`). The same object backs the staff
download, the Cadet download and every WhatsApp attachment
(`notifications/documents/notice.ts`). This is a deliberate exception to
"notification attachments are never stored". Consequences:

- there is no `artifact` row and the PDF never appears in Document history;
- the key is deterministic: two processes may both write an equivalent object on
  a simultaneous first request;
- a draft has no PDF (`getNoticeDownload` answers CONFLICT);
- downloads are five-minute presigned URLs issued per request; never put the
  object on `/blob/*`;
- the demo purge records the key of every published notice in its manifest and
  also sweeps the school's prefix.

## Cadet Portal

Procedures (`routers/cadet/cadet-notices.{router,service}.ts`, on
`cadetProcedure`, no identity inputs): `listNotices`, `getNotice`,
`getNoticeDownload`.

**Visibility rule** (`addressedTo`, evaluated in the query on every request): a
student sees a notice when it belongs to their school, is **published**,
addresses students (`cadet_scope <> 'none'`), and they are enrolled in the
notice's session; for `selected_classes` that enrollment's class must be one of
the notice's classes. Anything else, including another class's notice, a
staff-only notice and a draft, is NOT_FOUND. Visibility is live, not frozen at
publication: a student moved to another class sees that class's notices.
Registration is not part of visibility (portal access survives unregistering);
it only decides who is notified.

`getNotice` returns `{ noticeId, title, publishedAt, text, html }`: `text` is the
plain body for a plain notice and null for a custom-template one; `html` is the
sanitized document.

Screens (`apps/cadet/components/notices`, shared API-free pieces in
`packages/components/src/cadet-portal/cadet-notice.tsx`):

| Route | Screen |
| --- | --- |
| `/notices` | `NoticesScreen`: infinite list, newest first. |
| `/notices/{noticeId}` | `NoticeScreen`: heading, Download PDF, then the notice. |

- **Reading on a phone.** A plain notice is shown as text (`CadetNoticeText`,
  the same paragraph rule as the printed notice), not as an A4 sheet scaled to a
  few millimetres of type. A custom-template notice has no text form, so it is
  shown as its printed page in the shared empty-sandbox `DocumentPreview` with
  `fitPageWidth`. Both offer the PDF.
- **Entry points.** A notices block on Home (`HomeNotices`, the newest three,
  rendered only when there are notices) and a row on More (`MoreNoticesRow`).
  The tab bar keeps its five tabs.
- **Feature off.** There is no features read for students; the notice
  procedures' disabled-feature error is the signal (`noticesSwitchedOff`). The
  Home block and the More row do not appear, and both routes show the calm
  "Notices are not available" state instead of an error. The rest of the portal
  is unaffected.

## Management

Routes under `/school/:schoolId/sessions/:sessionId/notices`
(`apps/management/app/(protected)/school/[schoolId]/(workspace)/sessions/[sessionId]/notices/`,
components in `apps/management/components/notices`):

| Route | Screen |
| --- | --- |
| `/notices` | List (search, status and audience filters), "New notice" in the navbar. |
| `/notices/new`, `/notices/:noticeId/edit` | Editor: title, plain text or custom template (Monaco, variable list, starter), audience, debounced live preview, unsaved-changes dialog. |
| `/notices/:noticeId` | The notice page: facts, rendered notice, Edit / Publish (with forecast) / Download PDF / Delete, and the delivery log once published. Staff notification deep link. |
| `/school/:schoolId/settings/templates/notice` | The school's Notice template (document system). |

The sidebar item, the pages, the dashboard "Recent notices" card and the "Create
notice" job need the `notices` feature and their permission. Student audience
options appear only when the school has `cadet`.

## Demo schools

A demo school has `notices` and `cadet` on. The `notices` step of
`DemoSchoolWorkflow` (after `templates`, so a plain notice pins the seeded
design) writes the notices of `seed/notices.json` through the real
`createNotice` / `publishNotice` procedures as the demo's principal
(`seedNotice` in `steps.ts`): a published staff-only notice, one for all
classes, one for staff and the two seniormost of the demo's classes, a
custom-template invitation, and two drafts.

- **Dates** come from the journaled `asOf`: `createdDaysAgo`,
  `publishedDaysAgo` and `{date:±N}` tokens in the text (`buildNotices`,
  `fillDemoNoticeDates` in `plan.ts`). The procedures stamp "now";
  `backdateDemoNotice` then sets the planned times, for `is_demo` schools only.
  Back-dating is not part of the API or MCP.
- **Idempotent** on the notice title within the session: a replay finds the
  notice and only finishes what is missing, so it never notifies twice.
- **Content is invented.** Never copy a real school's notice into the seed.
- Inbox items carry the time the seed ran, like the demo's other notifications.
- Purge: `purge_demo_school` deletes `notice_class` and `notice`; the purge
  manifest lists the cached PDFs and the file stage removes them.

## Known gaps

- No unpublish, edit or delete of a published notice; no scheduling; no
  attachments; no read receipts.
- No "publication finished" message or settle sweep for notices (results have
  one). The delivery log's `preparation` is the only progress signal.
- `updateNotice` has no optimistic concurrency: the last write to a draft wins.
- The built-in default design is not pinned (see "Rendering").
- Resending a notice delivery, and delivering already emitted notice events, are
  not gated by the features.
- `notice_class.class_id` cascades: deleting a class can leave a
  `selected_classes` draft with none, which is refused at publication.
- A platform admin who is not a school member cannot use notices.
- The Cadet Portal highlights no tab on the notice screens, and shows no
  "unread notice" state beyond the notification inbox.
- The "Notices:" line of `DOCUMENT_CONTEXT_HELP` is prose and not checked
  against the context.

## Checklist for extending notices

**A new field on the notice context**

1. Add it to `buildNoticeContext` and `SAMPLE_NOTICE_CONTEXT` together (the
   build fails otherwise). It must not identify a person.
2. Describe it in `NOTICE_CONTEXT_FIELDS` and decide `offeredToAuthors` (the
   build fails until you do).
3. Update the "Notices:" line of `DOCUMENT_CONTEXT_HELP` and the built-in
   `notice-default` design if it should print.
4. Run `notice.render.test.ts` and `notice-template.integration.test.ts`.

**A new audience or lifecycle rule**

1. Model each fact as its own column with a CHECK; do not overload
   `cadet_scope` or infer one audience fact from the other.
2. Apply it in **all** of: `validateNoticeAudience`, `noticeCadetRoster` (who is
   notified), `addressedTo` (who can see it), `previewNoticeDelivery`, the
   management audience components (`@campuspilot/components/notices`) and the
   demo seed schema.
3. Add router, emitter and Cadet integration tests for visibility and
   notification separately: they are different facts.

**A new notice procedure**

1. Staff: `.route()`, `.meta({ mcp })` (notice tools are `advanced`),
   `requireSchoolPermission(...)` **then** `requireSchoolFeature('notices')`;
   call `assertSchoolFeatureEnabled(..., 'cadet')` wherever students are
   addressed. Cadet: `cadetProcedure`, no identity inputs,
   `assertNoticesEnabled`, look the notice up through `addressedTo`.
2. Integration tests: anonymous, wrong school, each role, feature off, another
   author's draft, published immutability.
3. Update the pinned MCP tool lists (`apps/server/src/mcp-catalog.test.ts`,
   `apps/server/src/cadet-http.integration.test.ts`).

**A new notification channel or type for notices**

1. Catalogue entry (one audience per type) and every exhaustive consumer:
   renderers, web-push renderer, WhatsApp templates, delivery-log labels and
   reference, failure-alert topic, management and Cadet route maps.
2. Keep one event per student with the `notice` batch; keys derive from the
   notice.

**A new screen**

1. Management: follow `apps/management/docs/ui-patterns.md`; wrap in
   `RequireFeature` and `RequirePermissions`; render notice HTML only through
   `DocumentPreview`.
2. Cadet: follow the "Adding a screen" checklist in
   [Cadet Portal](cadet-portal.md); handle `noticesSwitchedOff` and NOT_FOUND as
   states, not errors; check it at phone width.

**A new table or stored object**

1. Extend `purge_demo_school` in a new migration and the purge tests.
2. Keep objects under `schools/{schoolId}/` and record their keys in the purge
   manifest (`deleteDemoSchoolData`).
3. Decide whether a fresh demo should show the feature and extend
   `seed/notices.json` and `seedNotice`.
