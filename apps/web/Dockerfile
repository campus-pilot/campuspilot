FROM node:24-slim AS builder
RUN npm install -g pnpm@11
WORKDIR /app

COPY . .
RUN --mount=type=cache,target=/pnpm-store pnpm install --store-dir /pnpm-store

ARG VITE_SERVER_URL
ENV VITE_SERVER_URL=${VITE_SERVER_URL}
ENV NODE_ENV=production
RUN cd apps/web && pnpm run build

FROM node:24-slim AS runner
WORKDIR /app
COPY --from=builder /app .
ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0
EXPOSE 3001
CMD ["sh", "-c", "cd apps/web && npm run start"]
