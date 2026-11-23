# School Onboarding form

`campuspilot.in/onboarding` is a standalone page where a school sends what we
need to set it up: school name, logo (optional), phone (required), Gmail
address (optional), address, the classes it runs with their sections and
subjects, and anything else as typed notes or a voice note recorded in the
page. It is for people we send the link to: nothing on the site links to it
and it is kept out of search. Each submission is a
`school_registration_request` row; platform admins read them on the admin
app's **School onboarding** page.

This is not the in-app guided setup of a self-created school
(`school_onboarding`, see [Self-service school creation](school-creation.md)),
and a request creates no school.

## The page

- Route `apps/web/src/routes/onboarding.tsx`, outside the `_site` layout (no
  navigation or footer). Code in `apps/web/src/pages/onboarding/`.
- Five steps with a stepper and "Step n of 5": School (name, logo, address),
  Contact (phone, Gmail), Classes and sections, Subjects, Anything else
  (notes, voice note). "Continue" checks only the step in view; finished
  steps can be revisited from the stepper.
- Classes offered: Nursery, LKG, UKG, Class 1 to 12. Sections: A to D.
  Subjects: Mathematics, English, Hindi, SST, Science, ECA, Sanskrit
  (`DEFAULT_*_NAMES` in `packages/api/src/leads/school-onboarding.ts`). Every
  list also takes typed names; a typed name matching an offered one (ignoring
  case) selects it. Sections and subjects are chosen per class, and a row's
  "Use for all classes" copies its choice to every class.
- The voice note is recorded with `MediaRecorder` (`voice-recorder.ts`, an
  external store read with `useSyncExternalStore`; the microphone is released
  when the field unmounts through a ref cleanup). Recording stops by itself at
  10 minutes. Browsers record WebM/Opus (Chrome, Firefox) or MP4/AAC
  (Safari), asked for 64 kbps.
- After the save the page says the school will hear from us in 1 to 2
  business days and points to `/contact`.

### Kept out of search

- `<meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex">`.
- `robots.txt` disallows `/onboarding`.
- nginx sends `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet`.
- Not in `seoRoutes`: no sitemap entry, canonical or social card.

## Submission

`POST /public/leads/school-onboarding`, one `multipart/form-data` request:
`submission` (JSON: `submissionId`, `sourcePath`, `response`), and optional
`logo` and `voiceNote` files. Gated like the demo request form
([Website leads](leads.md)): the browser solves the same ALTCHA challenge
(`GET /public/leads/challenge`) and sends it in `x-altcha`; the solution is
spent once in Redis; 5 submissions per client IP per 10 minutes. The route
lives under `/public/leads/` for the shared credential-less CORS rule.

The handler (`packages/api/src/leads/school-onboarding.http.ts`) checks the
proof-of-work, the declared size, the multipart body, the answers
(`schoolOnboardingSubmissionSchema`), returns the saved request for a known
`submissionId` (browser retries reuse it), spends the solution, writes the
files to S3 and inserts the row. A concurrent retry that loses the insert
deletes its objects. The response depends on that insert only; the team's
WhatsApp alert (below) is scheduled after it.

### Limits

| What | Limit | Enforced |
| --- | --- | --- |
| Logo | 2 MB; JPEG, PNG or WebP by its bytes | page and server |
| Voice note | 10 minutes; 12 MB; WebM, Ogg or MP4 by its bytes | length by the page, size and format by the server |
| Reported voice length (`voiceNoteSeconds`) | 1 to 600 s, and present exactly when a voice note is sent | server |
| Whole body | both file caps + 256 KB answers + framing | server (`content-length`, then streaming) |
| Classes | 40; each 1 to 26 sections and 1 to 30 subjects, names up to 40 characters, no duplicates (ignoring case) | page and server |
| Notes | 5,000 characters | page and server |

The server cannot measure compressed audio cheaply, so the 10-minute limit is
the recorder's; the byte cap bounds what a caller who skips the page can send.

## Data

`school_registration_request` (`packages/db/src/schema/school-registration-request.ts`):
`response` (JSONB, as validated), `form_version`
(`SCHOOL_ONBOARDING_FORM_VERSION`; bump it when a question's meaning changes),
`submission_id` (unique), and per file its S3 key, media type (from the
bytes) and size. Files are private objects at
`school-registration-requests/{id}/logo.{ext}` and `…/voice-note.{ext}`.
Requests are not school data: the demo purge does not touch them.

## WhatsApp alert

Each submission alerts the team on WhatsApp, the same way demo requests do
([Website leads](leads.md)): the request row is the alert's outbox
(`alert_*` columns, committed `pending`), the API hands it to Restate after
commit with a signed send to `LeadControl.scheduleOnboardingAlert`
(`leads/school-onboarding.alert-outbox.ts`, re-sent by the API's 30 s sweep),
and the worker's `schoolOnboardingAlert` workflow (one run per request, ever)
sends the `school_onboarding_alert` template to `LEAD_ALERT_WHATSAPP_TO`,
retrying for a day and recording `sent` or `failed` on the row. The template
(Utility, English, named parameters `school`, `phone`, `email`, `classes`,
`reference`; text in `workflows/lead-alert/constants.ts`) carries no logo or
voice note: the admin page has those. Its text and parameters must match Meta.

## Setting up the school

From a submission's dialog in the admin app, **Start onboarding** opens
`/school-onboarding/{requestId}/setup`, a wizard that turns the submission
into a real school (`is_demo` false). Its steps (`SCHOOL_SETUP_WIZARD_STEPS`
in `packages/api/src/school-setup/school-setup.contract.ts`): School (name,
slug, address, registration number, whether to use the sent logo), Plan and
trial (standing tier, a trial of N 28-day periods, Pro for one period by
default), Features (per feature: follow the plan, on or off; the assistant's
monthly limit), Session (April to March year and examinations, the guided
setup's four terms by default), Classes (each with its sections and
subjects, from the submission) and, last, People (the admin as manager; the
form's contact as principal and owner).

### Drafts

`school_setup` holds one row per submission. The wizard saves the draft
(`systemAdmin.saveSchoolSetupDraft`, `draft` JSONB and the step on screen)
whenever the step changes and with **Save draft**, so the admin can leave and
continue later; the dialog's button then reads **Continue onboarding**. A
draft is editable while it is `draft` or `failed`.

### Running it

**Review and create** checks the draft with `schoolSetupReadySchema` (the
same rules the API and the worker apply; problems show beside their fields
and mark their steps), then a dialog lists everything that will be created.
**Create school** calls `systemAdmin.startSchoolSetup`, which checks again
(and that the slug is free), records the start (`queued`, `requested_by`,
`start_requested_at`) and returns at once. Like a demo school
([Demo schools](demo-school.md)) the start is an outbox entry handed over with
a signed, idempotent send to the ingress-public `SchoolSetupControl.start`,
which validates the row and starts the ingress-private `SchoolSetup`
workflow (key `{setupId}.{attempt}`). The API's 30 s sweep
(`school-setup.outbox.ts`) re-sends unaccepted starts, fails one Restate has
not accepted within 10 minutes, and fails a run Restate paused or that ended
without finishing.

The workflow's steps (`SCHOOL_SETUP_RUN_STEPS`): `school` (the school row
with its standing tier, the sent logo copied to `schools/{id}/logo/`),
`plan` (`startTrialPeriod`, `setSchoolFeature` per adjustment), `session`
(`createSchoolSessionRecord` with the examinations), `classes`
(`createClassRecord`, each subject with one Written mode like the guided
setup), `exam-plans` (every examination's plan for every class) and `people`
(the admin as manager, then the principal: an existing account with the phone
number, else the email, else a new account; principal role and
`school.owner_user_id`). Each step is one transaction that locks the setup
row, checks it is still this attempt's running setup, does its writes and
records itself in `completed_steps` in the same transaction: a replay or a
retry continues where it stopped and never creates anything twice. Before
every step the worker re-checks, as the admin who started it (a `system-job`
principal), that OPA still grants `system.school_setup.manage`.

A new principal account gets **no password** in the worker (passwords never
reach Restate's journal). The result screen offers **Issue the principal's
password** (`school.issueMemberPassword`, shown once) when the principal has
none; an existing account keeps its own. A failed setup shows its step and
message with **Retry** (a new attempt from the saved draft) and **Edit the
setup**; once the school exists, edits only affect the steps still to run.
The page polls `getSchoolSetup` every 1.5 s while the setup is queued or
running.

Permissions: reading uses `system.school_registration_request.read`; saving
and starting use `system.school_setup.manage` (platform admins). All three
procedures are hidden from MCP.

## Admin

`systemAdmin.listSchoolRegistrationRequests` and
`systemAdmin.getSchoolRegistrationRequestMedia` (5-minute presigned URLs),
both behind OPA `system.school_registration_request.read` (platform admins)
and hidden from MCP. Storage keys never leave the API.
