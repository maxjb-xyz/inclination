# Shared Node image for the API and sync services. Builds the whole monorepo,
# then runs either `apps/api/dist/main.js` or `apps/sync/dist/main.js` (command
# is chosen per-service in docker-compose.yml).
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable \
  && apt-get update \
  && apt-get install -y --no-install-recommends openssl curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
# .dockerignore strips node_modules/dist so we build from source inside the image.
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @inclination/db run generate
RUN pnpm -r --if-present run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3001 3002
# Default command (overridden per service in compose).
CMD ["node", "apps/api/dist/main.js"]
