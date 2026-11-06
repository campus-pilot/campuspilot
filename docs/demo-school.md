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
   calls `systemAdmin.startDemoSchoolJob`. The API calls the ingress-public
   service `DemoSchoolControl.startSeed({ jobId, attempt })`, which checks the
   job row (that attempt, still queued or running) and starts the
   ingress-private workflow `DemoSchool` with key `{jobId}.{attempt}`.
   Starting again while the run is alive reuses it; if the recorded run has
   ended without finishing the job, a new attempt is started.
   `retryDemoSchoolJob` (failed jobs only) also starts a new attempt. The
   workflow refuses a finished job and any attempt other than the current one,
   and every status write is fenced by attempt.
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

Demo staff accounts are created, made members and marked
`demo_school_id = schoolId` in one transaction; a replay recognises an account
only by that marker, and any other existing account with the address fails the
step. The `credentials` step generates an 80-bit password per account
(`XXXX-XXXX-XXXX-XXXX`, Crockford base32 from `node:crypto`), stores
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

1. records purge intent: under the school lock it sets
   `demo_school_job.purge_requested_at`. From then on start, retry,
   `DemoSchoolControl.startSeed`, the job context guard and every seed step
   refuse, and a seed step that uploaded a file deletes it again
   (`assertUploadsKept`);
2. cancels any running seed invocation and waits until it has ended (it
   refuses with "still stopping" after a minute; the intent stays recorded, so
   the school stays frozen until the purge is repeated);
3. revokes demo users' sessions (including Redis);
4. in one transaction locks the school, records the purge manifest
   (`demo_school_purge`: the S3 keys the database references and the demo user
   IDs) and runs `purge_demo_school(schoolId)`, which deletes every row the
   school owns and its demo-only users. Finance trigger functions allow those
   `DELETE`s only for a demo school (`is_demo`, immutable after insert since
   0027) that has a `demo_purge_marker` row for the current transaction, which
   only `purge_demo_school()` writes; the marker table is not writable by
   PUBLIC. The function-name check on the call stack is defence in depth only
   (a same-named function could spoof it). `UPDATE` rules are unchanged, real
   schools stay append-only, and every function pins `search_path`;
5. revokes the manifest users' sessions again after commit;
6. asks `DemoSchoolControl.startPurgeCleanup({ schoolId, attempt })` to start
   the private `DemoSchoolPurge` workflow (key `{schoolId}.{attempt}`). It
   takes only IDs, refuses while the school exists, reads the manifest, and
   deletes only keys under `schools/{schoolId}/` and `users/{demoUserId}/`
   (never an empty or root prefix). There is no timed wait: step 2 waited for
   cancelled runs and late uploads delete themselves. A terminal failure marks
   the manifest `failed` with `last_error`.

The manifest is an outbox. If Restate or the worker is unavailable it stays
`pending`; the API server sweeps it on start and then 10 minutes after each
sweep ends (chained, bounded to 20 rows, rows claimed with `FOR UPDATE SKIP
LOCKED`, so replicas never overlap). `failed` cleanups are retried under the
next attempt up to 5 attempts, then left `failed` for an operator.

Calls to `DemoSchoolControl` use an idempotency key (`demo-seed:{jobId}.{attempt}`,
`demo-purge:{schoolId}.{attempt}`) and a 10 s timeout: if the worker is down,
admin requests fail fast with "The demo worker is unavailable" and a repeated
call joins the same Restate invocation. All control and workflow inputs are
validated with Zod before any journal entry; database errors reach Restate only
as a generic message (details, without SQL parameters, are in the worker log).

The requesting admin's account is never deleted; only its memberships go.
Accounts invited into a demo with a real address (by the admin or by a
prospect using a demo login) are not demo-owned: they keep their account and
lose only their access to the demo. The
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

## Migrations

0025 and 0026 add columns and foreign keys on `"user"` and `"school"` and
replace finance trigger functions; they take brief exclusive locks on those
tables while the migration batch runs. 0027 starts with
`SET LOCAL lock_timeout = '5s'`, so a deploy fails fast instead of queueing
behind a long transaction (and blocking auth and school queries). Applied
migrations are never edited.

## Deploying

The `campuspilot-plus-worker` image runs `node dist/src/index.mjs` on
`WORKER_PORT` with the API server's environment plus `RESTATE_WORKER_URL`.
After each deploy, register it: `node dist/scripts/restate-register.mjs`.
Set `RESTATE_IDENTITY_KEYS` (comma-separated `publickeyv1_…` keys of your
Restate server); the worker then rejects unsigned requests. It is required when
`NODE_ENV=production`. When it is absent outside production (local dev), the
worker accepts unsigned requests and logs `worker.identity-keys.absent`.

**Restate ingress and the admin API must never be publicly reachable.** Restate
OSS does not authenticate ingress callers, which is why the workflows are
ingress-private and only `DemoSchoolControl` (which takes IDs and validates
them against the database) is callable through ingress.

## Extending

- New user-visible feature: extend the seed JSON and a step so a new demo shows it.
- New school-owned table: add it to `purge_demo_school` in a migration.
- New school-owned S3 object: make sure purge collects its key or it lives under
  `schools/{schoolId}/`.
- `packages/api/scripts/local-demo.ts` is kept as the separate one-off seeder of
  the dedicated `docker/local-demo` stack; it is not used by this feature.
