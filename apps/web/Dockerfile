FROM node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS builder
RUN npm install --global pnpm@10.33.0
WORKDIR /app

COPY . .
RUN --mount=type=cache,target=/pnpm-store pnpm install --frozen-lockfile --store-dir /pnpm-store

ARG VITE_SERVER_URL
ARG VITE_CONTACT_EMAIL
ARG VITE_CONTACT_PHONE_NUMBER
ARG VITE_CONTACT_PHONE_LABEL
ARG VITE_WHATSAPP_NUMBER
ARG VITE_WHATSAPP_LABEL
ARG VITE_CALENDAR_URL
ARG VITE_STAFF_LOGIN_URL
ARG VITE_STUDENT_LOGIN_URL=""
ENV VITE_SERVER_URL=${VITE_SERVER_URL} \
    VITE_CONTACT_EMAIL=${VITE_CONTACT_EMAIL} \
    VITE_CONTACT_PHONE_NUMBER=${VITE_CONTACT_PHONE_NUMBER} \
    VITE_CONTACT_PHONE_LABEL=${VITE_CONTACT_PHONE_LABEL} \
    VITE_WHATSAPP_NUMBER=${VITE_WHATSAPP_NUMBER} \
    VITE_WHATSAPP_LABEL=${VITE_WHATSAPP_LABEL} \
    VITE_CALENDAR_URL=${VITE_CALENDAR_URL} \
    VITE_STAFF_LOGIN_URL=${VITE_STAFF_LOGIN_URL} \
    VITE_STUDENT_LOGIN_URL=${VITE_STUDENT_LOGIN_URL}
ENV NODE_ENV=production
RUN pnpm --filter web build

FROM nginx:1.29-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de AS runner
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/build/client /usr/share/nginx/html

EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD wget --quiet --tries=1 --spider http://localhost:3001/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
