# Ayush's local school demo

This checkout contains a persistent synthetic school provisioned using real
password sessions and the application's permission-checked procedures.

## Access

- Platform administration: http://localhost:3103/sign-in
- School management: http://localhost:3102/auth/login
- API: http://localhost:3100
- Platform administrator: `ayush.91011@gmail.com`
- Principal: `principal@maplegrove.test`
- Manager: `manager@maplegrove.test`
- Accountant: `accounts@maplegrove.test`
- Examination coordinator: `exams@maplegrove.test`
- Teachers: `nursery@maplegrove.test`, `lkg@maplegrove.test`,
  `ukg@maplegrove.test`, `class-1@maplegrove.test`,
  `class-2@maplegrove.test`, `class-3@maplegrove.test`

Passwords are generated locally and saved in the ignored, owner-readable
`tmp/local-demo/credentials.json`. `platform.password` is the platform password;
`staffPassword` is shared by the ten synthetic staff accounts. They can be changed
in account settings. No emails or real payments are sent. Staff and family email
addresses use the reserved `.test` domain; pupil phone numbers are placeholders.

The platform administrator has **no school membership and no school role**.
Use the platform app for that account and a staff account in management. The app
shares its localhost authentication cookie across ports; use separate browser
profiles or a private window to keep platform and school sessions open together.

## Data

Maple Grove Public School, Bengaluru, has an active **2026–2027** session:

- Nursery, LKG, UKG, Class 1, Class 2, and Class 3, each with section A,
  one assigned teacher and three registered, enrolled pupils (18 total).
- Four preschool subjects and five primary subjects, with workbooks and
  explicit oral/activity or written/oral assessment weights.
- First, Second, Third, and Fourth Semester Examinations, each with 27 subject
  plans and a complete six-class timetable. The first two are completed with
  approved results, attendance and co-scholastic assessments. The third is active
  for entering results; the fourth is ready to start.
- Seven selected, school-owned document templates: report card, ID card, admit
  card, timetable, bill, receipt and account statement. The application also has
  placeholder settings screens for future document types; these have no template
  backend and are outside the seven supported types.
  Report/ID templates have school-owned corrections to imported context/CSS
  selectors. Admit cards use full A4 so every assessment slot and signature fits.
- Configured admission document categories: birth certificate, parent/guardian
  address proof, and transfer certificate where applicable. No fabricated identity
  documents are uploaded.

Monthly tuition in INR is 1,800 / 2,000 / 2,200 / 2,500 / 2,800 / 3,000 in class
order. Each pupil has activity fees of 200 and learning resources of 150. One
pupil per class opts into 900 transport. Examination fees are optional run-time
charges and are not charged in the sample November run. Billing uses explicit
`INR`, `Asia/Kolkata`, and an April cycle start; amounts are stored in paise.

November has 18 bills totaling **INR 54,600**, 12 sample payments totaling
**INR 30,000**, and **INR 24,600** outstanding. Each class has one fully paid,
one partly paid, and one unpaid account. All monetary facts are synthetic.

Exact IDs, navigation URLs, staff assignments and verification results are saved
in `tmp/local-demo/state.json`. Downloaded sample PDFs for all seven types are in
`tmp/local-demo/documents/`.

Verification passed through real password sessions, application procedures and
database reads: the administrator has no school membership/role, all six classes
have three pupils and one teacher, all four exam states match the intended setup,
and all 18 financial account projections reconcile with their ledgers. A complete
second provisioning run preserved the counts of users, schools, students, bills,
payments, selected templates and PDFs. PDF checks covered all 54 pages; visual
review covered the seven layouts and the corrected preschool/primary designs.

## Services and persistence

Docker Compose project `campuspilot-ayush-local` is separate from other projects.
Its ports bind to loopback and its named volumes preserve the database, stored
templates, generated PDFs, Redis and Restate data across restarts.

| Service | Host port |
| --- | --- |
| PostgreSQL | 55432 |
| Redis | 56379 |
| RustFS API / console | 59000 / 59001 |
| OPA | 58181 |
| Gotenberg | 58781 |
| Restate ingress / admin / fabric | 58080 / 59070 / 55122 |

RustFS 1.0.0 supplies local S3 storage. The existing demo templates and PDFs were
copied through the S3 API and verified byte-for-byte; the migration manifest is
`tmp/local-demo/storage-migration.json`. The previous MinIO container was removed;
its original volume is retained as a rollback copy. The active stack uses
separate `rustfs_data` and `rustfs_logs` named volumes.

The application keeps the standard `S3_*` keys. Docker maps those values to the
storage container's internal credential settings. Production AWS S3 continues to
use the same keys; omit `S3_ENDPOINT` and use `S3_FORCE_PATH_STYLE=false` there.

## Restart

Prerequisites: Docker Desktop and Node/npm. Commands below use Node 24 and pnpm 10.33
without changing the machine's default Node installation.

From the repository root:

```sh
docker compose --env-file apps/server/.env -f docker/local-demo/compose.yml up -d --wait postgres redis opa gotenberg restate rustfs
docker compose --env-file apps/server/.env -f docker/local-demo/compose.yml run --rm --no-deps rustfs-init
npx --yes --package=node@24 --package=pnpm@10.33.0 pnpm --filter @campuspilot/db db:migrate
```

Start the three app servers in the background:

```sh
npx --yes --package=node@24 node scripts/local-demo-apps.mjs start
```

Use `status` to check them and `stop` to stop only this launcher's app processes.
The launcher records process IDs, checks ownership before stopping, and refuses
to take over an occupied port. Alternatively, run each app in its own terminal:

```sh
npx --yes --package=node@24 --package=pnpm@10.33.0 pnpm --filter server dev
npx --yes --package=node@24 --package=pnpm@10.33.0 pnpm --filter management exec next dev --port 3102
npx --yes --package=node@24 --package=pnpm@10.33.0 pnpm --filter admin exec next dev --port 3103
```

The existing `.env` files and `tmp/local-demo/credentials.json` must be retained.
Pass `--env-file apps/server/.env` so the app and RustFS share the same S3 values.
Use the dedicated compose path above; the default development compose file uses
ports already occupied by another project. Do not use `down -v` if the demo data
should be preserved.

To rerun provisioning/verification on this dedicated local demo database:

```sh
npx --yes --package=node@24 --package=pnpm@10.33.0 pnpm --filter server exec tsx ../../packages/api/scripts/local-demo.ts
```

The provisioner reuses existing accounts, classes, admissions, enrollments,
completed exams, templates and PDFs; billing and payments have stable idempotency
keys. It is for initial setup and verification, not for resetting user edits:
if passwords or sample facts have been changed, review the script before rerunning.
It refuses a database other than the dedicated local port/database and never
deletes existing data. Service logs from this setup are in `tmp/local-demo/`.

## Google OAuth

Password login and Google OAuth are configured locally. The Google client ID and
secret are stored only in the ignored `apps/server/.env`; neither belongs in
source control. OAuth initiation was verified from both app origins with the
configured client ID and callback. Interactive Google login/consent must still be
completed in the user's browser. Register the exact redirect URI
`http://localhost:3100/api/auth/callback/google`; the frontend origins are
`http://localhost:3102` and `http://localhost:3103`.

## RustFS migration validation

The local migration verified all 17 objects against their original SHA-256 hashes
after switching the endpoint. A real school principal then generated a fresh PDF,
downloaded it through a signed URL, and deleted that test PDF through the normal
application procedures. Original school data and saved exports were preserved.

The focused S3 and logo integration suites pass all 11 checks, covering binary
data, object metadata, listings, encoded object keys, signed uploads/downloads,
and deletion. Application S3 configuration and its environment key schema are
unchanged; only local credential values and storage containers changed.
Both compose configurations were validated. The standard development RustFS
service and its bucket initializer were also launched in an isolated compose
project on random ports; bucket creation and a second idempotent initialization
both passed, and that temporary project's containers/volumes were removed.

The whole API suite is not green: a broad RustFS run had 422 passing and 11 failing
tests. A comparison run against the original MinIO binary also had 11 failures
(424 passing, including the two newly added storage tests). Both runs expose
document catalog/printing expectation failures and PostgreSQL finance
serialization conflicts; the particular finance cases vary with concurrency.
These application issues were left outside the storage migration. Evidence is
in `tmp/local-demo/rustfs-tests.log`, `minio-baseline-tests.log`,
`rustfs-compatibility-tests.log`, and `rustfs-live-verification.log`.
