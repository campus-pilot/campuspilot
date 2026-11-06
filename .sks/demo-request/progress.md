# Demo school implementation progress

Branch: `feature-demo`. Plan: `.sks/demo-request/plan.md`.

## Phase 1: Foundations
- [x] Migration `0025_demo-school` (drizzle-kit generated + hand-written SQL):
      `school.is_demo`, `school.demo_created_by`, `user.demo_school_id`,
      `demo_school_job`, `finance_demo_purge_allows()`, trigger functions
      (DELETE branches only; UPDATE bodies diffed identical to 0018),
      `purge_demo_school()` (SECURITY INVOKER).
- [x] OPA actions `system.school.demo.{create,read,credentials.read,purge}` →
      `platform.admin`; regenerated; rego tests (65/65 pass).
- [x] `SchoolDto.isDemo` (system admin) and `MySchoolDto.isDemo` (management).
- [x] `system-job` principal + `createDemoSchoolJobContext` (worker only).
- [x] DB-level purge integration test (4/4).
- Decision: `user.demo_school_id` FK is NO ACTION and `purge_demo_school`
  deletes demo users itself (before the school), so a school can never be
  removed while orphaning demo logins. Plan had the API delete them after.
- Decision: seed steps call the existing HTTP upload handlers with a real
  `Request`/`FormData` instead of extracting helpers (same validation path).

## Phases 2–4: worker, seed + steps, workflow + API (one commit)
- [x] `@restatedev/restate-sdk ~1.17.4`; clients aligned to `~1.17.4` (core types must match).
- [x] Seed JSON + Zod (`seed/`, `seed.ts`), PRNG (`prng.ts`), dates, identity,
      procedural PNG avatars/monogram (`images.ts`; no binaries, no faces),
      pure `buildDemoPlan` + `paymentEvents` (`plan.ts`).
- [x] Step functions (`steps.ts`), shared ordered runner `runDemoSeedSteps`,
      Restate `DemoSchool` workflow (key `{jobId}.{attempt}`), `DemoSchoolPurge`.
- [x] `systemAdmin` procedures: listDemoClassCatalogue, createDemoSchool,
      startDemoSchoolJob, retryDemoSchoolJob, getDemoSchoolJob, getSchoolDemoJob
      (extra: table status by school), getDemoCredentialsDownload, purgeDemoSchool.
      All MCP `hidden`; purge/start/retry `destructive: true`.
- [x] `apps/worker` (http2 + createEndpointHandler for clean shutdown), dev entry
      registers with `force`, `scripts/restate-register.ts`, Dockerfile, release
      matrix `campuspilot-plus-worker`, `pnpm dev:worker`.
- Tests: demo-plan unit 10/10, demo-seed integration 3/3 (2-class school,
  reconcile, idempotent re-run, CSV logins), router integration 8/8, purge 4/4,
  server MCP catalog unit 23/23.
- Pre-existing failures (also without any demo test): document router tests use
  `*-modern` marketplace slugs that do not exist; billing/ledger tests hit
  serialization conflicts under parallel load.
- Not done: docker/dev compose has no app services (server isn't there either),
  so no worker container was added; dev runs it through turbo.

## Phases 5–7
- [x] Purge procedure + DemoSchoolPurge (in the API commit); admin Purge setting,
      Delete school UI commented out (UI commit).
- [x] Admin dialog/form/progress/badges/credentials; management banner.
- [x] AGENTS.md "Demo schools" section; docs/demo-school.md.
- Local e2e (dev stack): migrations 0023–0025 applied; full 13-class demo
  seeded via Restate in ~60 s (147 students, 1141 bills, 793 payments);
  worker SIGKILLed mid-seed and restarted → completed, no duplicate rows;
  purge while seeding → seed cancelled, 0 rows / 0 S3 objects / 0 demo users
  left; three more demos purged. Journal holds only the CSV key.
- Browser verification NOT done: the user's own management dev server on
  :3002 fails with missing NEXT_PUBLIC_MCP_URL, and admin needs an admin login.
- Pending confirmation: marketplace default selector bugs (see final report).

## Review 1 fixes
- H1: workflows `ingressPrivate`; public `DemoSchoolControl` validates IDs
  against the DB; purge takes only schoolId and reads `demo_school_purge`;
  prefix allow-list; seed refuses finished jobs/stale attempts; worker
  `identityKeys` from `RESTATE_IDENTITY_KEYS` (required in production).
- M1: 80-bit Crockford base32 passwords + unit test. M2: manifest allow-list;
  `updateSchool` drops `logoS3Key` (no caller used it).
- L1/L2: new migration 0026 (0025 was already applied locally): pinned
  search_path, qualified calls, per-transaction marker + call-stack check.
- L3/L4: atomic demo staff creation; replay only by demo_school_id.
- L5: attempt-fenced writes, early failures terminal, dead-run restart.
- L6: manifest outbox, API sweep on boot and every 10 min, wait for cancel,
  30 s settle sleep before listing.
- L7: invited real accounts keep their account (copy + docs). L8: table
  status from the job. Info: requested_by ON DELETE SET NULL.
- Verified: demo tests 29/29, related API tests 75/75, server unit 23/23,
  OPA 65/65, check-types 11/11; local e2e seed (146 students) + purge →
  0 rows/0 objects/0 demo users; ingress probes: private workflows 400,
  control refuses a succeeded job and an existing school (409).
