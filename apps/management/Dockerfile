FROM node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS builder
RUN npm install --global pnpm@10.33.0
WORKDIR /app

COPY . .

ARG NEXT_PUBLIC_SERVER_URL
ENV NEXT_PUBLIC_SERVER_URL=${NEXT_PUBLIC_SERVER_URL}

RUN --mount=type=cache,target=/pnpm-store pnpm install --frozen-lockfile --store-dir /pnpm-store
RUN pnpm --filter management build

FROM node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS runner
ARG SOURCE_REVISION
LABEL org.opencontainers.image.revision=$SOURCE_REVISION

WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3002

COPY --from=builder /app/apps/management/.next/standalone ./
COPY --from=builder /app/apps/management/.next/static ./apps/management/.next/static

EXPOSE 3002

HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD node -e "fetch('http://localhost:3002/').then(response => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "apps/management/server.js"]
