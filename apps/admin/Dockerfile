FROM node:24-slim AS builder
RUN npm install --global pnpm@10.33.0
WORKDIR /app

COPY . .
RUN --mount=type=cache,target=/pnpm-store pnpm install --frozen-lockfile --store-dir /pnpm-store
RUN pnpm --filter admin build

FROM nginx:1.29-alpine AS runner
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/admin/out /usr/share/nginx/html

EXPOSE 3002

HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD wget --quiet --tries=1 --spider http://localhost:3002/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
