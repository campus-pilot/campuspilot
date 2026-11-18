# Website leads (demo requests)

The website's `/book-demo` page collects demo requests with a two-step form
instead of a calendar embed. Each submission is a **lead**: saved first, then
alerted to the team on WhatsApp in the background.

## Flow

1. The browser fetches a proof-of-work challenge
   (`GET /public/leads/challenge`, ALTCHA format, HMAC-signed with
   `LEAD_CHALLENGE_HMAC_KEY`, valid 10 minutes), solves it with Web Crypto
   (`packages/api/src/leads/altcha-solver.ts`) and posts the answers to
   `POST /public/leads/demo-request` with the solution in the `x-altcha`
   header. Nothing is shown to the person.
2. The server verifies the solution, validates the answers
   (`demoRequestResponseSchema`), spends the solution in Redis and inserts the
   `lead` row. The response depends on that insert only.
3. After commit the API schedules the alert with Restate (a signed one-way
   send to `LeadControl.scheduleAlert`) and never waits for the worker. The
   API's 30 s sweep re-sends any lead Restate has not accepted.
4. The worker's `leadAlert` workflow (one run per lead) sends the
   `demo_lead_alert` WhatsApp template to `LEAD_ALERT_WHATSAPP_TO` and records
   `sent` or `failed` on the row. Every failure is retried with backoff for a
   day (the recipient is our own number, so a duplicate costs one message).

The browser retries failed or lost tries with the same `submissionId`; the
server returns the already saved lead for a known id, so a retry never creates
a second lead.

## Data

`lead` keeps the answers as submitted in `response` (JSONB), with `form`
(`book_demo`) and `form_version`. Adding a question needs no migration; bump
`DEMO_REQUEST_FORM_VERSION` when a question's meaning changes. The alert
columns (`alert_*`) are the outbox and the alert's outcome. Leads are not
school data and are not touched by the demo purge.

Platform admins read leads on the admin app's **Demo requests** page
(`systemAdmin.listLeads`, OPA action `system.lead.read`), which lists every
answer as key and value.

## Configuration

| Setting | Where | Notes |
| --- | --- | --- |
| `LEAD_ALERT_WHATSAPP_TO` | server and worker | E.164; our own number, not the WhatsApp Business sending number. Unset: leads are saved and alerts fail as not configured. |
| `LEAD_CHALLENGE_HMAC_KEY` | server | Required in production; same value on every replica. |
| `WHATSAPP_*` | worker | The platform's WhatsApp Business settings. |

The `demo_lead_alert` template (Utility, English, named parameters) lives in
the production Campuspilot WhatsApp account; its text and parameter names are
documented in `packages/api/src/workflows/lead-alert/constants.ts` and must
match Meta.
