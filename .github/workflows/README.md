# Container release workflow

`release.yml` assigns a strict `vMAJOR.MINOR.PATCH` version to each successful
push to `main`. For a new version, it publishes all five images with immutable
semver and `sha-<commit>` tags. Only after every image succeeds does it push the
Git tag and create the GitHub release. No mutable image tag is published;
deployments must pin a semver or commit-SHA tag.

The five images are `campuspilot-plus-management`, `campuspilot-plus-admin`,
`campuspilot-plus-web`, `campuspilot-plus-api`, and `campuspilot-plus-opa`. The
admin image serves `https://admin.campuspilot.in`; its sign-in route is
`https://admin.campuspilot.in/sign-in`.

The workflow is serialized per branch. A rerun that finds a semver tag already
pointing at the commit enters reuse mode: it never rebuilds or pushes an image.
Instead, it verifies that every semver and commit-SHA image reference exists and
that each pair resolves to the same digest before creating or reusing the GitHub
release. Conflicting Git tags are rejected, and tag and SHA formats are checked
before shell use. The merged-PR label lookup must succeed; `patch` is selected
only when that successful response contains no `major` or `minor` label. Failed
build or reuse-verification jobs cannot publish a Git tag or GitHub release.

The `campuspilot-plus` image prefix is the user's explicit naming decision for
this release line; it is not inferred from the repository or application names.

## Repository variables

Configure these in **Settings → Secrets and variables → Actions → Variables**.
They are browser-public build settings embedded into frontend assets.

| Variable | Image | Production value or owner input |
| --- | --- | --- |
| `NEXT_PUBLIC_SERVER_URL` | `campuspilot-plus-management`, `campuspilot-plus-admin` | `https://api.campuspilot.in` |
| `VITE_SERVER_URL` | `campuspilot-plus-web` | `https://api.campuspilot.in` |
| `VITE_CONTACT_EMAIL` | `campuspilot-plus-web` | `shubhaman47@gmail.com` |
| `VITE_CONTACT_PHONE_NUMBER` | `campuspilot-plus-web` | `+917023908472` |
| `VITE_CONTACT_PHONE_LABEL` | `campuspilot-plus-web` | `+91 70239 08472` |
| `VITE_WHATSAPP_NUMBER` | `campuspilot-plus-web` | `917023908472` |
| `VITE_WHATSAPP_LABEL` | `campuspilot-plus-web` | `+91 70239 08472` |
| `VITE_CALENDAR_URL` | `campuspilot-plus-web` | `https://cal.com/shubham-kumar-47/campus-pilot` |
| `VITE_STAFF_LOGIN_URL` | `campuspilot-plus-web` | `https://app.campuspilot.in/auth/login` |
| `VITE_STUDENT_LOGIN_URL` | `campuspilot-plus-web` | Optional; an unset or empty value disables the Students & Families login choice. Do not point this at the system-admin app |

The workflow passes an empty `VITE_STUDENT_LOGIN_URL` build argument when the
repository Variable is unset. The web environment normalizes that empty string
to `undefined`; it is not replaced with a placeholder or admin URL.

The API and OPA images consume no build variables. Runtime database, auth,
Google OAuth, S3, Redis, OPA, Restate, and service credentials must be supplied
only by the deployment environment; they must never be passed as image build
arguments.

No Actions Secrets are required for image builds beyond GitHub's automatic
`GITHUB_TOKEN`. Permissions are scoped per job: preparation reads repository and
pull-request metadata, new image builds read contents and write packages, reuse
verification only reads packages, and only the final release job writes
repository contents. Third-party actions and production base images are pinned
to verified immutable revisions. Private image pulls use separate cluster-side
GHCR credentials and are outside this workflow.

Apply the `minor` or `major` label to a merged pull request to select that bump;
otherwise the workflow publishes a patch release.
