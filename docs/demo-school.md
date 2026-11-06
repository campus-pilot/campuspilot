# Demo schools

A demo school is a complete, realistic and freshly dated sample school that a
platform admin creates from the admin app (`/organizations` → **Demo school**).
It is marked by its own fact, `school.is_demo`; nothing infers demo status from
the slug, the staff email domain or the existence of a job.

## How it works

1. `systemAdmin.createDemoSchool` creates, in one transaction, the school
   (`is_demo = true`, `demo_created_by = admin`), the admin's membership with
   the `principal` role, and a `demo_school_job` row (`queued`).
2. The dialog uploads the optional logo through the normal logo endpoint, then
   calls `systemAdmin.startDemoSchoolJob`, which submits the Restate workflow
   `DemoSchool` with key `{jobId}.{attempt}`. Submitting again attaches to the
   same run; `retryDemoSchoolJob` (failed jobs only) starts a new attempt.
3. `apps/worker` runs the workflow. Every step builds a `system-job` router
   context acting as the requesting admin (`workflows/demo-school/job-context.ts`)
   and calls the real procedures, so OPA checks every write. The context factory
   refuses a school that is not a demo or whose requester is no longer principal.
4. The admin UI polls `getDemoSchoolJob` (dialog) and `getSchoolDemoJob`
   (organizations table). `demo_school_job` is the status store; Restate is not.

Steps: staff (+ generated monogram logo when none was uploaded) → session →
classes → students (with illustrated photos) → exams → finance → templates →
credentials. The seed and `asOf` are drawn once and stored on the job, so a
retry rebuilds the same plan and every idempotent step finds its earlier work.
Exam state and billing months follow from `asOf` (see `dates.ts`, `plan.ts`).

### Credentials

The `credentials` step generates a password per demo staff account, stores
only its hash through Better Auth's server adapter and writes
`schools/{schoolId}/demo/credentials.csv` to private S3. It returns only that
key: passwords never reach the Restate journal, the job row or logs. Download
it with `getDemoCredentialsDownload` (admin school settings or the dialog); the
URL expires after five minutes. Staff emails are
`{role}.{slug}@campuspilot.in` and `teacher{n}.{slug}@campuspilot.in`. No email
is sent; the app has no mail transport.

### Purge

**Purge demo school** (admin school settings, demo schools only) calls
`purgeDemoSchool({ schoolId, confirmation: slug })`, which:

1. cancels any running seed invocation (Restate admin API);
2. collects the school's S3 keys and the `schools/{id}/` and `users/{demoUser}/`
   prefixes, and revokes demo users' sessions (including Redis);
3. runs `purge_demo_school(schoolId)` in one transaction. That SQL function
   deletes every row the school owns and its demo-only users, using the
   demo-only finance exception: finance trigger functions allow `DELETE` only
   when the transaction-local `campuspilot.demo_purge_school_id` names the row's
   school **and** that school `is_demo` (`finance_demo_purge_allows`). `UPDATE`
   rules are unchanged and real schools stay append-only;
4. after commit submits `DemoSchoolPurge` (keyed by school ID), which lists the
   prefixes again and deletes objects in retried batches.

The requesting admin's account is never deleted; only its memberships go. The
general **Delete school** UI is commented out: deleting a school with data fails
because of `NO ACTION` foreign keys and append-only finance.

## Running locally

```sh
cp apps/server/.env apps/worker/.env
printf 'WORKER_PORT=9080\nRESTATE_WORKER_URL=http://host.docker.internal:9080\n' >> apps/worker/.env
pnpm dev:worker            # starts the worker and registers it (force) with Restate
# or, for an already running worker:
pnpm --filter worker register [--force]
```

`RESTATE_WORKER_URL` is the URI Restate (in Docker) uses to reach the worker;
`RESTATE_ADMIN_URL` comes from the server env. The API needs
`RESTATE_INGRESS_URL` to submit workflows and `RESTATE_ADMIN_URL` to cancel them.

## Deploying

The `campuspilot-plus-worker` image runs `node dist/src/index.mjs` on
`WORKER_PORT` with the API server's environment plus `RESTATE_WORKER_URL`.
After each deploy, register it: `node dist/scripts/restate-register.mjs`.
The endpoint does not yet verify Restate request signatures; restrict network
access to the worker to the Restate server (or configure identity keys).

## Extending

- New user-visible feature: extend the seed JSON and a step so a new demo shows it.
- New school-owned table: add it to `purge_demo_school` in a migration.
- New school-owned S3 object: make sure purge collects its key or it lives under
  `schools/{schoolId}/`.
- `packages/api/scripts/local-demo.ts` is kept as the separate one-off seeder of
  the dedicated `docker/local-demo` stack; it is not used by this feature.
