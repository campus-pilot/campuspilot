# Local document preview

User-authorized reusable login for the isolated synthetic preview:

- Email: `documents@preview.test`
- Password: `DocumentPreview123!`
- Role: school manager at Greenwood Public School
- Management: http://localhost:3092
- Worktree: `/Users/sks/.codex/worktrees/document-artifacts/campuspilot`
- Branch: `codex/document-artifacts`

These are local test credentials. They are not a production account or a general authorization to modify other schools. Use them when the user requests testing this preview.

The running preview's exact school/session URL is written to `/private/tmp/campuspilot-document-preview.json`. Read that file rather than assuming IDs; a fresh launch creates a new synthetic dataset. It includes 24 enrolled Grade 8 students, six subject plans with approved marks, approved exam-wide attendance and activities, a six-day timetable, and selected templates for all four document types.

To launch a fresh preview when no preview is already running, enable Docker Desktop, then from this worktree run:

```sh
pnpm --filter server exec tsx ../../scripts/document-preview.ts
```

The script starts isolated PostgreSQL, Redis, OPA, MinIO, and Gotenberg containers, applies migrations, seeds the account and data, serves the API on 3090, and starts management on 3092. It requires those two ports to be available. Keep the parent process running while testing. Interrupting it shuts down the frontend and disposes the temporary containers and their data. Do not restart that parent just to refresh code if a user is testing or has unsaved work.

The harness is for interactive local testing; it is separate from normal development infrastructure and automated integration-test containers. Application code continues to read typed configuration from `@campuspilot/env`; the test harness supplies its isolated environment before importing the app.

Alternative ports can be supplied with `--api-port 3093 --app-port 3094` for a fresh launch. Alternate URL metadata is written to `/private/tmp/campuspilot-document-preview-3094.json`. Next supports one development server per worktree, so concurrent previews require a separate checkout as well as separate ports. The launcher checks port availability before creating test data and disposes its containers if its app process exits.
