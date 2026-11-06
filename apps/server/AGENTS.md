# Server route placement

- Every authentication- or account-authentication-related application handler must be implemented as an oRPC procedure under `packages/api/src/router/auth/*.ts`. Do not add one-off auth handlers to `apps/server`.

# Rate limiting

- Rate-limit routes with `createRateLimit({ id, limit, windowMs })` from `src/rate-limit.ts`. It wraps `hono-rate-limiter` with its Redis store, so limits hold across API replicas and are keyed by the ingress-reported client IP. Do not hand-roll counters or use the in-memory store.
- Give each route group its own `id`. Its Redis keys live under `server:rate-limit:{id}:`.
- Public, sessionless routes (for example `/blob/*`, 20 requests per second per IP) must always be rate-limited.

# Bundling and native dependencies

- `tsdown` inlines every `@campuspilot/*` package, plus any of their third-party dependencies not listed in `apps/server/package.json`. A dependency with a native binary (for example `sharp`) breaks when inlined: the API crashes on boot in the container. List every native dependency a workspace package uses in `apps/server/package.json` too, so it stays an external import and `pnpm deploy` installs its platform binary.
