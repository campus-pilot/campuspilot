FROM node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS builder
RUN npm install --global pnpm@10.33.0
WORKDIR /app
ENV SKIP_ENV_VALIDATION=1

COPY . .
RUN --mount=type=cache,target=/pnpm-store pnpm install --frozen-lockfile --store-dir /pnpm-store

ENV NODE_ENV=production
RUN pnpm --filter worker build
RUN --mount=type=cache,target=/pnpm-store pnpm --filter worker deploy --prod --legacy --frozen-lockfile --store-dir /pnpm-store /runtime
# npm packages occasionally publish repository metadata; it is not a runtime dependency.
RUN find /runtime/node_modules -depth -type d \( -name .git -o -name .github \) -exec rm -rf '{}' +

FROM node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS runner
ARG SOURCE_REVISION
LABEL org.opencontainers.image.revision=$SOURCE_REVISION
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /runtime/node_modules /app/node_modules
COPY --from=builder /app/apps/worker/dist /app/dist

# Restate calls the worker on this port (WORKER_PORT). The worker registers
# itself with Restate on every start, so no separate deploy step is needed.
EXPOSE 9080

CMD ["node", "dist/src/index.mjs"]
