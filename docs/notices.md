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
`0051_demo-purge-notices.sql`; ID prefixes `ntc`, `ntcc`).

| Column | Meaning |
| --- | --- |
| `school_id`, `session_id` | A notice belongs to one session: class targeting needs that session's roster. |
| `title` | 1 to 200 characters. |
| `body_mode` | `plain` or `template` (see "Rendering"). |
| `body` | Plain text, or the author's Handlebars/HTML source; at most 200,000 characters. |
| `page_size` | The paper it prints on, `full` (default) or `half` A4, chosen per notice for **both** body modes (see "Print size"). Fixed with the rest of the row at publication. |
| `status` | `draft` or `published`. One way. |
| `to_staff` | Addressed to the school's staff (every member). |
| `cadet_scope` | Students addressed: `none`, `all_classes`, `selected_classes`. |
| `created_by`, `created_at`, `updated_at` | The author (null after the account is deleted). |
| `version` | Counts the writes: 1 when created, plus one per saved edit and for the publication. The optimistic-concurrency token (see "Concurrent changes"). |
| `published_by`, `published_at` | Set together when published. |
| `issued_on` | The calendar date printed on the notice, decided once at publication; null for a draft. |
| `template_revision_id` | The school's Notice template revision pinned at publication (plain notices only). |
| `published_staff_count`, `published_cadet_count` | Who was notified at publication; null for a draft. |

`notice_class (id, notice_id, class_id, class_name, school_id)` holds the
classes of a `selected_classes` notice. A row is an **audience record that
outlives its class**:

- `class_id` is the live reference used for targeting and visibility. It is
  `ON DELETE SET NULL`: a notice never blocks deleting a class, and a deleted
  class addresses nobody.
- `class_name` is the class's name as the audience was recorded: when the draft
  was last saved, and again at publication (`recordPublishedClasses`). A
  published notice shows these names, so "sent to Class 5 and Class 8" stays
  true after Class 8 is renamed or deleted.
- Publishing drops a draft's rows whose class is already gone (it was never
  addressed).

The DTO carries both views and never mixes them: `classIds` is the existing
classes (what the editor edits), `classes: [{ classId, name }]` the record for
display (`classId` null = deleted since; a draft shows current names, a
published notice the names it was published with).

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

Other CHECKs: the published facts (including `issued_on`) are all set or all
null; a revision can be pinned only on a published plain notice; the title
length; `version >= 1`.

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

### Concurrent changes

A draft can be edited by its author while a publisher reads it, and by two
people at once. Both writes therefore name the version the caller read
(`expectedVersion`, from `getNotice.version`, `previewNotice.version` or
`previewNoticePublish.version`), checked under the row lock:

- `updateNotice` with a stale version is `CONFLICT` and writes nothing, so
  nobody overwrites a change they did not see;
- `publishNotice` with a stale version is `CONFLICT` and notifies nobody.
  Publication is irreversible, so it must only ever send the text and audience
  the publisher reviewed.

The message is `NOTICE_CHANGED_MESSAGE` ("This notice changed since you opened
it. Review it again.").

**The reviewed page includes the school's Notice template.** A plain notice is
printed inside the school's selected Notice template, which a template manager
can replace at any moment and which may carry text of its own. So a preview
also says which template revision it rendered (`previewNotice.templateRevisionId`
and `previewNoticePublish.templateRevisionId`; null = the built-in design, or a
notice that is its own template), and `publishNotice` requires it back as
`expectedTemplateRevisionId` (required, nullable, never defaulted). The
publication renders once, pins the revision that render used, and is refused
with `CONFLICT` (`NOTICE_TEMPLATE_CHANGED_MESSAGE`) when that is not the
revision named: the comparison is on the very revision that would be pinned,
so the selection cannot change between the check and the publication. The
school's letterhead facts (name, logo) are outside this, by the decision under
"What is fixed at publication".

Management: the editor keeps what was typed and offers "Load the latest
version". The publish dialog confirms the **preview that was on the page** when
Publish was pressed: it reads that render's `version` and `templateRevisionId`
from the cache (`publishReviewOf`), sends both, blocks itself when the forecast
or the server reports that either changed (saying which), and refreshes the
page behind it. With no preview on the page yet there is nothing to confirm
and Publish stays disabled.

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
  Nothing rewrites a stored audience when the feature goes off: the draft keeps
  its audience and cannot be saved or published until someone changes it.

Clients tell the error apart with `readSchoolFeatureDisabled(error)`, never by
its message. Management wraps navigation and pages in `RequireFeature` /
`FeaturePage`; the Cadet Portal has no separate features read and treats the
notice procedures' own answer as the signal (see "Cadet Portal").

Nothing is deleted when a feature is switched off: notices, cached PDFs and
inbox rows are kept and work again when it is switched on.

### Nothing new goes out while a feature is off

`notificationRequiredFeatures` (`@campuspilot/db/notifications/catalogue`)
names the features each notification type belongs to: `notice.published` needs
`notices` **and** `cadet`, `notice.published_staff` needs `notices`.
`disabledFeatureOf` (`notifications/features.ts`) is the one check, applied at
every point a copy could still leave the API:

| Point | While a required feature is off |
| --- | --- |
| Fan-out of an event not dispatched yet (`loadDispatchableEvent`, `decideDeliveries`) | Remote copies are planned `skipped: feature_disabled`. The inbox row is still written. |
| Sender, just before a queued copy is claimed (`sendDelivery`) | The copy is recorded `skipped: feature_disabled`; the provider is not called. |
| Staff resend (`resendNotificationDelivery`) | Refused with the disabled-feature error; no event is written. |
| Notice PDF source (`notifications/documents/notice.ts`) | Produces nothing. |

`feature_disabled` is its own skip reason (the delivery log reads "Feature
switched off for this school"); it is about the school, not the channel.
Copies skipped this way are not sent later when the feature returns.

Inbox rows are the record and stay: rows written before the switch, and the
row of an event fanned out after it, remain in the staff and Cadet inboxes with
the notice title. Their link lands on the calm unavailable state ("Notices is
not enabled" in management, "Notices are not available" in the Cadet Portal;
with `cadet` off the whole portal says "Cadet Portal unavailable").

## Print size

Every notice states its own print size (`notice.page_size`, the
`document_template_page_size` enum: `full` or `half`). It is an explicit fact
of the notice, chosen in the editor for plain and custom-template notices
alike, never inferred from a template.

| | `full` | `half` |
| --- | --- | --- |
| Page | Portrait A4, 16 mm margin | 210 x 148.5 mm (half an A4 sheet), 10 mm margin |
| Long notice | Continues on further A4 pages | Continues on further half pages |
| PDF | One A4 page per page | **Two copies** of each half page on one portrait A4 sheet, with a dashed cut guide (`imposeHalfPageNoticeCopies`) |

- **Two copies per sheet, by decision.** A half-page notice is the usual
  school "print and cut in half" circular: printing the PDF on plain A4 and
  cutting the stack along the guide gives two complete copies in page
  order. A notice of N half pages is N A4 sheets. Chromium paginates the
  half pages (`@page{size:210mm 148.5mm}`); pdf-lib then imposes each one
  twice on an A4 sheet. A page is scaled down to fit its half, never
  cropped.
- **Never clipped.** Both sizes flow (`flowingNoticeLayout` in
  `document.render.ts`): there is no fixed-height slot, so long content
  continues on the next page and nothing is hidden. There is no
  measurement-based refusal: a sandboxed preview cannot be measured, and
  flowing makes one unnecessary.
- **A truthful preview.** On screen a half-page notice is an A4-wide column
  with the 10 mm margin, a caption ("Half A4 · two copies per A4 sheet") and
  a line at every 128.5 mm of text, where each half page ends. A page may
  break a line earlier than the line shows (Chromium never splits a line of
  text), never later. The editor's live preview, the notice page, the
  publish dialog and the Cadet Portal (`pageSize` on `getNotice` and
  `getNoticeDocument`) state the size.
- **Templates adapt to it.** The size reaches every template as the
  context fact `print.size`. One school Notice design prints plain notices
  of both sizes (a compact letterhead and smaller type on half A4, typically
  through a `notice--{{print.size}}` class); a custom template can do the
  same. See "Rendering".
- **Versioned and pinned.** A size change is a saved edit and increments
  `version`, so a publisher never confirms a stale size. A published row is
  immutable, so `page_size` is the size pinned at publication; the cached
  PDF and every WhatsApp copy use it, and the PDF cache key names it.

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
- `print.size` (`full` or `half`: the notice's own `page_size`),
- `notice.{title,issuedOn,issuedOnDisplay,paragraphs[]}`.

Nothing about students, staff, results or money is reachable from a notice,
whoever wrote it.

### What is fixed at publication, and what is live

| Fact | Published notice |
| --- | --- |
| Title, body, audience, print size | Fixed (immutable row). |
| Template revision of a plain notice | Fixed (`template_revision_id`; the built-in design is not pinned, see below). |
| `issuedOn` / `issuedOnDisplay` | **Fixed**: `notice.issued_on`, the publication instant's calendar date in the session's finance time zone as configured at that moment (UTC without one). It is stored, never recomputed, so changing the time zone later does not move a notice's date. |
| `generatedAt` | Fixed: the publication instant. |
| School name, location, registration number, logo | **Live**, by decision: every HTML render reads the school's current letterhead. |
| Cached PDF | Rendered on first use, then never again: it keeps the letterhead of that moment. |

So a published notice's wording, date and design never change, but its
letterhead can: after a school changes its name or logo, the HTML views show
the new letterhead while an already cached PDF shows the old one. That is
accepted (a school's identity changing is rare, and the notice's content is what
must not move); do not describe a published notice as rendering "identically
every time". A draft or unsaved preview shows today's date.

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
notice always renders from its stored publication instant, issued-on date and
pinned revision (`renderPublishedNoticeHtml`), so a later template edit never
changes it. The
built-in design is not pinned: a plain notice published without a selected
template renders with whatever `notice-default` the running release ships (its
cached PDF does not change).

Notices use the flowing layout (`combineDocuments(..., 'notice', size)`):
as many full-A4 or half-A4 pages as the text needs (see "Print size"). The
layout is taken from the `print.size` the template was rendered with
(`renderNoticeDocument`), so design and page never disagree. A notice
template must not set a fixed height, `overflow: hidden` or outer page
padding.

**A school Notice template is size-adaptive.** Each notice chooses its own
size, so a Notice design has no paper footprint: its revision's
document-system `pageSize` is always `full` (saving `half` is refused) and
never decides a notice's layout. The built-in `notice-default` and the
marketplace `notice-compact` designs adapt with `notice--{{print.size}}` /
`cn--{{print.size}}`. `assertValidSchoolNoticeTemplate` renders a design at
**both** sizes against the sample and the longest notice, and the catalog
tests do the same for every bundled design, so a plain notice never fails to
print at the size it chose with a built-in or marketplace design. Settings ›
Templates › Notice previews the design at either size ("Preview as";
`previewDocumentTemplate` and `getMarketplaceTemplate` take an optional
`printSize`, refused for every other type).

### Security contract

- Plain text is data. Markup or `{{…}}` typed by an author is shown, never run.
- A custom template is written by **any** staff role, so it gets the school
  template safeguards plus the limits below. Everything is checked on save
  (`assertValidNoticeTemplate`) and again on every render, by the same function
  (`renderNoticeDocument`), so what saves is what renders.
- **Helpers are an allowlist** (`DOCUMENT_TEMPLATE_HELPERS` in
  `document.render.ts`): `each`, `if`, `unless`, `with`, `lookup`, `add`. Every
  other Handlebars built-in is unregistered on the shared instance, for school
  templates too. In particular `log` is gone: it wrote its arguments to the
  server's console with no size limit. A call to anything else is BAD_REQUEST.
- **Every render has a budget, enforced while it runs.** The renderer counts
  every character as it is produced and, for every run of a block body, one
  step plus the expression nodes of every expression or block in it, and aborts
  at the budget, so a template that multiplies (nested `each`, a value repeated
  thousands of times, loops that print nothing) costs at most the budget and
  never builds the oversized string. Structural limits refused at parse time
  (at most 4 arguments and 4 hash pairs per call, 8 path parts, sub-expressions
  4 deep, 32 nodes per statement, 64 nested blocks; nesting is checked before
  Handlebars parses) keep each unit of budget a bounded amount of CPU, so the
  budget bounds time too: the worst template that passes save exhausts the
  notice budget in about 0.1 s. Every Handlebars construct
  that can produce output is either counted or refused when the template is
  parsed; the table is in [the document system guide](document-system.md)
  ("Render budget"). Partials, inline partials and decorators are refused for
  every template, and `lookup`/`add` cannot open a block. Notices use
  `NOTICE_RENDER_MAX_CHARS` (2 million; a published notice is re-rendered with
  twice that, so a longer school name can never make it unreadable). Other
  documents use 25 million for a whole batch.
- **The school logo is placed outside the template's control.** It is the one
  large value in the context (a data URI of up to ~6.7 MB). A notice template is
  rendered with a short, random, single-use placeholder in `school.logoUrl`; the
  real image is substituted after rendering and sanitizing, at most
  `NOTICE_MAX_LOGO_USES` (3) times, and more uses are BAD_REQUEST. A rendered
  notice is therefore at most the budget plus three logos, whatever the source
  does, and the limit is the same against the sample context and against a
  school with a 5 MB logo.
- **A school Notice template renders every plain notice**, so it is held to
  the same budget and logo limit. On save (`assertValidSchoolNoticeTemplate`)
  it is rendered against the sample **and** against the longest notice the DTO
  accepts (a 200,000-character text), so a design that could not print a long
  notice is refused there. That check is a courtesy to the template's author;
  the bound is that every later render of every notice runs under the same
  budget. A template that passes the save check can therefore never cost more
  than the budget at render time; a notice it cannot print within it (for
  example tens of thousands of one-line paragraphs in a design with heavy
  per-paragraph markup) is a BAD_REQUEST for that notice.
- **A structural limit** (`assertBoundedNoticeTemplate`) keeps author templates
  simple: block helpers nested at most four deep. An `{{else if}}` chain is one
  level here (its length is limited only by the shared 64-level nesting limit,
  which every template has). The limit does not bound the cost; the budget does.
- Browsers show notice HTML only in an **empty-sandbox** iframe
  (`DocumentPreview` in `@campuspilot/components/documents`). Never add sandbox
  capabilities and never inject notice HTML into a page.
- The context is school-only (above). Do not add a field that identifies a
  person: the same rendered notice is shown to every recipient.

## Publishing

`publishNotice` (`notice.service.ts`) is one transaction:

1. lock the notice row; refuse NOT_FOUND (not visible), CONFLICT (already
   published) or CONFLICT (not the `expectedVersion` the publisher reviewed);
   after the render of step 3, CONFLICT when the template revision it used is
   not the `expectedTemplateRevisionId` the publisher reviewed;
2. re-check the `cadet` feature when students are addressed, and that a
   `selected_classes` notice still has an existing class; record the audience
   (`recordPublishedClasses`);
3. render it once with the current time, which validates it and decides the
   revision to pin and the issued-on date to store;
4. resolve the recipients (`resolveNoticeRecipients`);
5. flip `draft → published` conditionally, storing `published_at`,
   `issued_on`, `published_by`, the pinned revision and both recipient counts,
   and incrementing `version`;
6. emit the notification events (`notifyNoticePublished`).

The events are handed to the worker only after the commit. The conditional
update and the event keys both make a replayed publication harmless.

`previewNoticePublish` returns the same recipient resolution without writing
(staff count, the students' per-channel forecast, and the `version` it was made
for); the management confirmation dialog shows it and says what each channel
will really send (the PDF is mentioned only when the forecast has WhatsApp
copies to send). The server decides again inside the publication.

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

The counts are read on every (polled) log request, so they never scan other
schools: a notice and a billing run are one batch and are found through
`notification_event_batch_idx`; an admission and an examination read the
school's own pending and failed events through
`notification_event_school_unsettled_idx` (`scopePreparation`).

## The notice PDF and its cache

A published notice's content, date and design are fixed and the same for every
reader, so its PDF is rendered once and cached at

```
schools/{schoolId}/notices/{noticeId}-{pageSize}.pdf
```

(`noticePdfKey`, `ensureNoticePdfStored`). The pinned page size is part of
the key, so a PDF laid out at one size can never be served for a notice of
the other (including objects cached before notices had a size). A half-page
notice's PDF is the imposed two-copies-per-sheet file. The same object backs the staff
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
`getNoticeDocument`, `getNoticeDownload`.

**Visibility rule** (`addressedTo`, evaluated in the query on every request): a
student sees a notice when it belongs to their school, is **published**,
addresses students (`cadet_scope <> 'none'`), and they are enrolled in the
notice's session; for `selected_classes` that enrollment's class must be one of
the notice's classes. Anything else, including another class's notice, a
staff-only notice and a draft, is NOT_FOUND. Visibility is live, not frozen at
publication: a student moved to another class sees that class's notices.
Registration is not part of visibility (portal access survives unregistering);
it only decides who is notified.

The content and the printed page are two reads, because the Cadet MCP serves
`getNotice` as a core tool and an AI app must not be sent megabytes of markup
and base64 to read a few sentences:

- `getNotice` returns `{ noticeId, title, publishedAt, bodyMode, text }`, never
  HTML. `text` is the plain body for a plain notice; for a custom-template
  notice it is the readable text of the rendered document (`noticeDocumentText`,
  rendered without the logo). `bodyMode` is its own fact and decides how the app
  shows the notice.
- `getNoticeDocument` returns `{ noticeId, html }`, the sanitized printed page
  with the letterhead. MCP hidden; the app asks for it only for a
  custom-template notice.

Screens (`apps/cadet/components/notices`, shared API-free pieces in
`packages/components/src/cadet-portal/cadet-notice.tsx`):

| Route | Screen |
| --- | --- |
| `/notices` | `NoticesScreen`: infinite list, newest first. |
| `/notices/{noticeId}` | `NoticeScreen`: heading, Download PDF, then the notice. |

- **Reading on a phone.** A plain notice is shown as text (`CadetNoticeText`,
  the same paragraph rule as the printed notice), not as an A4 sheet scaled to a
  few millimetres of type. A custom-template notice is shown as its printed
  page (`getNoticeDocument`) in the shared empty-sandbox `DocumentPreview` with
  `fitPageWidth`; while the page loads, or if it cannot be loaded, its text is
  shown instead. Both offer the PDF. `fitPageWidth` scales with CSS only where
  the browser supports it (`@supports`); elsewhere the frame is full width and
  scrolls, so the notice is readable at its real size.
- **Entry points.** A notices block on Home (`HomeNotices`, the newest three,
  rendered only when there are notices) and a row on More (`MoreNoticesRow`).
  The tab bar keeps its five tabs; More is highlighted on `/notices` and
  `/notices/{id}` (its `sections`), also when a student arrives from a
  notification.
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
| `/notices/new`, `/notices/:noticeId/edit` | Editor: title, plain text or custom template (Monaco, variable list, starter), print size (Full A4 / Half A4, both modes), audience, debounced live preview labelled with its size, unsaved-changes dialog. |
| `/notices/:noticeId` | The notice page: facts, rendered notice, Edit / Publish (with forecast) / Download PDF / Delete, and the delivery log once published. Staff notification deep link. |
| `/school/:schoolId/settings/templates/notice` | The school's Notice template (document system). |

The sidebar item, the pages, the dashboard "Recent notices" card and the "Create
notice" job need the `notices` feature and their permission.

Rules the screens follow (models in `notice-model.ts`, each with tests):

- **The stored audience is shown as it is.** New student audiences are offered
  only when the school has `cadet`; a draft already addressed to students keeps
  showing that, with the reason it cannot be saved, until the author chooses
  Staff. "The portal is off" and "the features could not be read" are different
  states with different words (`CadetAudienceAvailability`); the second offers
  Retry.
- **A notice is shown only under its own session** (`noticeBelongsToSession`);
  switching session from a notice returns to the list (`sessionSwitchSuffix`).
- **A notice that cannot be loaded says why** (`noticeLoadFailure`): not found
  (no retry), feature switched off, or a failure with Retry. Deleting a draft
  removes it from the cache.
- **A loaded notice survives a failed refetch** (`noticeBoundaryState`, built
  on `resolveQueryBoundary`): the notice page, the editor with whatever was
  typed, the breadcrumb and the saved preview keep what they hold when a
  background refetch fails; only "not found" or "feature switched off"
  replaces them. The Cadet Portal's notice screens, the dashboard card, the
  delivery log, the template settings page and the admin flag editor resolve
  the same way. Where notices are shown (notice page, saved preview, publish
  forecast, Cadet list, notice and Home block) a held copy whose refresh failed
  carries the shared `QueryRefreshNote` ("Couldn't refresh. Showing the last
  loaded version." with Retry, from `refetchError`).
- **The saved preview is cached per version** (`savedNoticePreviewQueryOptions`,
  key + `{ version }`): a render of an older version never stands for the one
  the page shows, so the publish dialog never confirms a page nobody was shown.
- **Staff-facing copy says "students"** for the audience ("Students", "Staff
  and students", "Which students?"); "Cadet Portal" names the portal. The stored
  values (`cadets`, `cadet_scope`) are unchanged.
- **The live preview never goes blank on an error**: the newest render that
  worked stays under the error message (`newestRenderedPreview`: a slow render
  of older text never replaces a newer one).
- **A draft that cannot be published says why instead of offering a retry**
  (`cadetAudienceUnpublishable`): a draft addressed to students in a school
  known not to have the Cadet Portal carries a note on its page, its Publish
  button is disabled and described by that note
  (`NOTICE_UNPUBLISHABLE_REASON_ID`), and the publish dialog (still reachable
  while the school's features are loading or could not be read) repeats it with "Edit audience".
- **A notice's delivery log names only the student on each row** (`oneSubject`),
  and every row lists its copies WhatsApp first, then device notifications.
- **Field errors are linked to their inputs** (`aria-describedby`,
  `NOTICE_FIELD_IDS`) and a failed save moves focus to the first invalid field.

## Demo schools

A demo school has `notices` and `cadet` on. The `notices` step of
`DemoSchoolWorkflow` (after `templates`, so a plain notice pins the seeded
design) writes the notices of `seed/notices.json` through the real
`createNotice` / `publishNotice` procedures as the demo's principal
(`seedNotice` in `steps.ts`): a published staff-only notice, one for all
classes, one for staff and the two seniormost of the demo's classes, a
custom-template invitation, and two drafts. Each seed notice states its
`pageSize`; the "Revised school timings" circular is half A4, so a fresh demo
shows both print sizes.

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
- The built-in default design is not pinned (see "Rendering").
- The half-page preview marks where each half page ends at a fixed text
  height; Chromium may break a line or two earlier (never later). The PDF is
  the authority.
- The marketplace detail page previews Notice designs at full size only;
  Settings › Templates › Notice previews both.
- A published notice's letterhead is live in HTML and frozen in its cached PDF
  (see "What is fixed at publication, and what is live").
- Inbox rows of notices stay visible while a feature is off; only remote copies
  are held back (see "Nothing new goes out while a feature is off").
- Copies skipped as `feature_disabled` are not sent when the feature returns.
- A platform admin who is not a school member cannot use notices.
- The Cadet Portal shows no "unread notice" state beyond the notification
  inbox.
- The "Notices:" line of `DOCUMENT_CONTEXT_HELP` is prose and not checked
  against the context.

## Checklist for extending notices

**A new field on the notice context**

1. Add it to `buildNoticeContext` and `SAMPLE_NOTICE_CONTEXT` together (the
   build fails otherwise). It must not identify a person.
2. Describe it in `NOTICE_CONTEXT_FIELDS` and decide `offeredToAuthors` (the
   build fails until you do).
3. Update the "Notices:" line of `DOCUMENT_CONTEXT_HELP` and the built-in
   `notice-default` and `notice-compact` designs if it should print (both
   must keep rendering at both print sizes).
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
   addressed. A procedure that changes a notice takes `expectedVersion` and
   increments `version`; one that sends what a reader confirmed also takes
   what else that reader saw (`expectedTemplateRevisionId`). Cadet: `cadetProcedure`, no identity inputs,
   `assertNoticesEnabled`, look the notice up through `addressedTo`.
2. Integration tests: anonymous, wrong school, each role, feature off, another
   author's draft, published immutability.
3. Update the pinned MCP tool lists (`apps/server/src/mcp-catalog.test.ts`,
   `apps/server/src/cadet-http.integration.test.ts`).

**A new notification channel or type for notices**

1. Catalogue entry (one audience per type), its `notificationRequiredFeatures`,
   and every exhaustive consumer: renderers, web-push renderer, WhatsApp
   templates, delivery-log labels and reference, failure-alert topic, management
   and Cadet route maps.
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
