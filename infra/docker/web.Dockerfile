# Builds the React SPA to static assets, then serves them with Caddy. This Caddy
# instance is the single externally-exposed entrypoint: it serves the SPA and
# reverse-proxies /api -> api and /collab -> sync.
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
# Build the workspace packages first (shared + editor) so the web app's typecheck
# can resolve their declared types (dist/index.d.ts); Vite aliases to source for
# bundling, but `tsc --noEmit` in the build resolves the published types.
RUN pnpm --filter "./packages/*" run build
RUN pnpm --filter @inclination/web run build

FROM caddy:2-alpine AS runtime
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
