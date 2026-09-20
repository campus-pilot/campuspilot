FROM node:24-slim AS builder
RUN npm install --global pnpm@10.33.0
WORKDIR /app

COPY . .

#  Decalre  multiple env as like this in future and once we use multi env remove this line of comment
# ARG FOO BAR BAZ
# ENV FOO BAR BAZ

ARG NEXT_PUBLIC_SERVER_URL 
ENV NEXT_PUBLIC_SERVER_URL

RUN --mount=type=cache,target=/pnpm-store pnpm install --frozen-lockfile --store-dir /pnpm-store
RUN pnpm --filter management build

FROM node:24-slim AS runner

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
