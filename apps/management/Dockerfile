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

FROM nginx:1.29-alpine AS runner
COPY apps/management/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/management/out /usr/share/nginx/html

EXPOSE 3002

HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD wget --quiet --tries=1 --spider http://localhost:3002/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
