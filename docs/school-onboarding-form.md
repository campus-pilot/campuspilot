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
deletes its objects. Nothing is scheduled after the save (no WhatsApp alert).

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

## Admin

`systemAdmin.listSchoolRegistrationRequests` and
`systemAdmin.getSchoolRegistrationRequestMedia` (5-minute presigned URLs),
both behind OPA `system.school_registration_request.read` (platform admins)
and hidden from MCP. Storage keys never leave the API.
