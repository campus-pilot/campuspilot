# Demo schools

A demo school is a complete, realistic and freshly dated sample school that a
platform admin creates from the admin app (`/organizations` → **Demo school**).
It is marked by its own fact, `school.is_demo`; nothing infers demo status from
the slug, the staff email domain or the existence of a job.

## How it works

1. `systemAdmin.createDemoSchool` creates, in one transaction, the school
   (`is_demo = true`, `demo_created_by = admin`), the admin's membership with
   the `principal` role, and a `demo_school_job` row (`queued`). The dialog
   closes at once and a persistent toast follows the job.
2. The client uploads the optional logo through the normal logo endpoint,
   then calls `systemAdmin.startDemoSchoolJob`. It **returns immediately**:
   it only records `start_requested_at` (the outbox entry) and hands the start
   over in the background. The hand-over is a signed, idempotent one-way send
   (`/send`, key `demo-seed:{jobId}.{attempt}`) to the ingress-public
   `DemoSchoolControl.startSeed`. Restate answers as soon as it has durably
   accepted the call, whether or not a worker is running; the API records
   `submitted_at` and the control invocation. `retryDemoSchoolJob` (failed
   jobs only) starts a new attempt the same way.
3. `DemoSchoolControl.startSeed` verifies the HMAC signature, checks the job
   row (that attempt, still queued or running, no purge) and starts the
   ingress-private workflow `DemoSchool` with key `{jobId}.{attempt}`,
   recording its invocation ID on the job. The workflow refuses a finished
   job and any attempt other than the current one; every status write is
   fenced by attempt.
4. `apps/worker` runs the workflow. Every step builds a `system-job` router
   context acting as the requesting admin (`workflows/demo-school/job-context.ts`)
   and calls the real procedures, so OPA checks every write. The context factory
   refuses a school that is not a demo or whose requester is no longer principal.
5. The admin UI follows the job with `systemAdmin.watchDemoSchoolJob`, an oRPC
   event iterator served as server-sent events: the current state, then every
   change (step, status, error), ending when the job succeeded or failed.
   `demo_school_job` is the status store; Restate is not.

All control and workflow inputs are validated with Zod before any journal
entry; database errors reach Restate only as a generic message (details,
without SQL parameters, are in the worker log).

### The outbox: nothing is silently stuck

`demo_school_job` (requested starts) and `demo_school_purge` (requested purges)
are the outbox. The API server sweeps it on start and then 30 s after each
sweep ends (chained, at most 20 rows per kind, rows claimed with `FOR UPDATE
SKIP LOCKED`, so replicas never overlap; `demo-school.outbox.ts`):

- a requested start Restate has not accepted is sent again under the same
  idempotency key; the job shows `last_submit_error` meanwhile. After 10
  minutes without acceptance the job fails with step `start` ("The workflow
  engine could not be reached…") and can be retried;
- an accepted job or purge whose run Restate **paused** (Restate's default
  retry policy pauses an invocation after 70 attempts, about an hour with the
  worker down) is cancelled and marked failed; one whose run **ended** without
  finishing it (or that Restate no longer knows) is marked failed. Both
  checks start 60 s after acceptance and are fenced by the invocation that was
  checked;
- pending purges are sent again (no deadline: the school is already frozen;
  the hand-over error is shown in the admin shell instead); failed purges are
  retried automatically under the next attempt, attempt *n* waiting *n* × 2
  minutes, up to 5 attempts in total.

While the worker is down, an accepted start simply waits in Restate (the
toast reads "Queued; waiting for the demo worker…") and runs when it is back.

### Progress streams

`watchDemoSchoolJob({ jobId })` and `watchDemoSchoolPurge({ schoolId })` are
permission-checked like their `get…` counterparts (`READ_DEMO_SCHOOL`). Each
polls its row at most once per second, sends a value only when it changed,
and ends when the row is final, after 10 minutes (the client reopens it), or
when the client disconnects: the request signal aborts the pending sleep and
oRPC returns the generator, so nothing outlives the connection. At most 200
streams run per API process (`demo-school.watch.ts`). The RPC handler adds
SSE keep-alive comments.

The admin app consumes the streams with TanStack Query: a query function
iterates the oRPC event iterator and writes each event into the query
(`demo-job-hooks.ts`), with no `useEffect`. The progress toast
(`demo-job-toast.tsx`, Sonner via `@campuspilot/ui`) and the organizations
table row share one query per job. Dismissing the toast closes the stream;
the workflow keeps running.

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
`purgeDemoSchool({ schoolId, confirmation: slug })`, which **returns
immediately** after one transaction under the school lock that:

- records purge intent on the jobs (`demo_school_job.purge_requested_at`). From
  then on start, retry, `DemoSchoolControl.startSeed`, the job context guard
  and every seed step refuse, and a seed step that uploaded a file deletes it
  again (`assertUploadsKept`);
- inserts the `demo_school_purge` request (`pending`, attempt 1, the school's
  name and slug). A repeated request returns the existing one.

The request is handed over like a start (signed send to
`DemoSchoolControl.startPurge`, key `demo-purge:{schoolId}.{attempt}`), which
starts the private, durable `DemoSchoolPurge` workflow (key
`{schoolId}.{attempt}`). It records each stage in `demo_school_purge.stage`
and the admin follows it through `watchDemoSchoolPurge`:

1. `stopping-seed`: freezes the jobs again (idempotent), finds every live
   `DemoSchool` run of the school's jobs by workflow key in Restate's
   `sys_invocation` (so a run whose ID was not recorded yet is found too),
   cancels each with `ctx.invocation(id).cancel()` and waits with
   `attach()`. This wait is durable and has no timeout: a seed step that is
   still writing finishes first, and a worker restart resumes the wait. (The
   old 60 s wait that could leave a school frozen is gone.)
2. `revoking-sessions`: revokes demo users' sessions (including Redis).
3. `deleting-data`: one transaction locks the purge row and the school,
   records the manifest (`object_keys`, `demo_user_ids`), runs
   `purge_demo_school(schoolId)` (every row the school owns and its demo-only
   users) and sets `data_deleted_at`; a replay after commit does nothing.
   Finance trigger functions allow those `DELETE`s only for a demo school
   (`is_demo`, immutable after insert since 0027) that has a
   `demo_purge_marker` row for the current transaction, which only
   `purge_demo_school()` writes; the marker table is not writable by PUBLIC.
   The function-name check on the call stack is defence in depth only. `UPDATE`
   rules are unchanged, real schools stay append-only, and every function pins
   `search_path`.
4. Revokes the manifest users' sessions again.
5. `deleting-files`: refuses while the school row exists, reads the manifest,
   and deletes only keys under `schools/{schoolId}/` and `users/{demoUserId}/`
   (never an empty or root prefix), plus whatever those prefixes still hold.

Every stage is idempotent, so a retry under a new attempt resumes; once the
data is deleted only the session revoke and the file stage run again. A
terminal failure marks the purge `failed` with `last_error`, keeping the stage
where it stopped. Purges that need an admin (failed, or a hand-over that keeps
failing) appear as warnings in the admin shell (`AppShellAlert`, one per
purge) with **Retry purge** for admins allowed to purge
(`retryDemoSchoolPurge`, `PURGE_DEMO_SCHOOL`); `listDemoSchoolPurges` lists them.

### DemoSchoolControl authentication

Restate OSS ingress does not authenticate callers, and `DemoSchoolControl` is
the only demo service ingress exposes. The API signs every control call:
headers `x-worker-control-timestamp` and `x-worker-control-signature`, an
HMAC-SHA256 with `WORKER_CONTROL_SECRET` over `v1`, `{service}/{handler}`, the
timestamp and the canonical JSON of the input
(`packages/api/src/workflows/control-auth.ts`). The secret and the signing
module belong to the worker as a whole: any future workflow entry point on
ingress uses the same ones. Before any
journal entry or database read, the handler verifies it with a constant-time
compare and requires the timestamp to lie within 2 minutes of **when Restate
accepted the invocation** (`sys_invocation.created_at`, read from the admin
API). Anchoring freshness to acceptance rather than execution is what makes
it work with durable hand-overs: a start accepted while the worker was down
for an hour still runs, because Restate replays the original headers; a
captured request replayed later becomes a new invocation with a new
acceptance time and is refused. A missing secret fails closed (the API
refuses to send, the worker refuses every call). Unsigned, wrongly signed,
stale or rebound (signed for the other handler or another input) calls get
`401`.

Restate-native options were considered: request identity keys would only
authenticate Restate to the worker, not callers to Restate (and are not used,
see below), and ingress-private services cannot be called from outside Restate,
so caller authentication has to live in the handler.

### Database roles and the finance triggers

The API server and the worker connect as `DATABASE_URL`. Locally that is the
`postgres` superuser, which owns every table. In deployment, the login is a
member of the `<database>-owner` role that owns every object
(`packages/db/src/migrate.ts`); migrations `SET ROLE` to it, but membership
with `INHERIT` already passes PostgreSQL's ownership checks, and the login
may `SET ROLE` itself. So the runtime role is effectively the table owner and
could `ALTER TABLE … DISABLE TRIGGER` on the finance tables. This is a known,
accepted-for-now risk recorded for the role owner; roles were deliberately
not changed in this work.

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
pnpm dev:worker            # starts the worker; it registers itself (force) with Restate
# only if Restate lost its data while the worker kept running:
pnpm --filter worker register [--force]
```

Both `apps/server/.env` and `apps/worker/.env` need the same
`WORKER_CONTROL_SECRET` (`openssl rand -hex 32`); without it no demo can be
started or purged.

`RESTATE_WORKER_URL` is the URI Restate (in Docker) uses to reach the worker;
`RESTATE_ADMIN_URL` comes from the server env. The API needs
`RESTATE_INGRESS_URL` to hand work over and `RESTATE_ADMIN_URL` to check and
cancel paused runs; the worker needs `RESTATE_ADMIN_URL` to authenticate
control calls and to find seed runs to stop.

## Migrations

0028 adds the outbox and purge-progress columns (and renames
`demo_school_purge.cleanup_attempt` to `attempt`); it touches only the demo
tables and also starts with `SET LOCAL lock_timeout = '5s'`.

0025 and 0026 add columns and foreign keys on `"user"` and `"school"` and
replace finance trigger functions; they take brief exclusive locks on those
tables while the migration batch runs. 0027 starts with
`SET LOCAL lock_timeout = '5s'`, so a deploy fails fast instead of queueing
behind a long transaction (and blocking auth and school queries). Applied
migrations are never edited.

## Deploying

Environment variables for this feature:

| Variable | Read by | Notes |
| --- | --- | --- |
| `WORKER_CONTROL_SECRET` | API server **and** worker (same value) | New. Required when `NODE_ENV=production`; at least 32 characters. Worker-wide, not demo-specific |
| `RESTATE_INGRESS_URL` | API server | Hand-over sends |
| `RESTATE_ADMIN_URL` | API server and worker | Never publicly reachable |
| `RESTATE_WORKER_URL`, `WORKER_PORT` | worker | Unchanged |

The `campuspilot-plus-worker` image runs `node dist/src/index.mjs` on
`WORKER_PORT` with the API server's environment plus `RESTATE_WORKER_URL`.
Once listening, it registers that URL with Restate's admin API
(`RESTATE_ADMIN_URL`) with `force`, retrying with backoff (1 s doubling to
30 s) until Restate accepts; it keeps serving meanwhile and logs
`worker.register.retry` / `worker.registered`. Every start and every replica
does this, which is harmless because the URL is stable. There is no deploy-time
registration step and so no automatic rollback when registration fails: watch
for repeated `worker.register.retry`. `force` replaces the service definitions
at that URL, so release changes to an existing workflow only when none of its
runs is in flight.
Restate request signing (identity keys) is not used: Restate and the worker
run in the same private cluster and the worker is never routed from outside
it, so anything that can reach the worker's port is already inside the
cluster. Keep it that way: do not expose the worker through an Ingress or
tunnel.

**Restate ingress and the admin API must never be publicly reachable.** Restate
OSS does not authenticate ingress callers, which is why the workflows are
ingress-private and only `DemoSchoolControl` (which authenticates every call,
takes IDs and validates them against the database) is callable through
ingress.

## Extending

- New user-visible feature: extend the seed JSON and a step so a new demo shows it.
- New school-owned table: add it to `purge_demo_school` in a migration.
- New school-owned S3 object: make sure purge collects its key or it lives under
  `schools/{schoolId}/`.
- `packages/api/scripts/local-demo.ts` is kept as the separate one-off seeder of
  the dedicated `docker/local-demo` stack; it is not used by this feature.
