# Coolify: Build Pack = Dockerfile, Dockerfile location `apps/web/Dockerfile`, Base directory `/`
# (the build needs the workspace: @ketsuban/registrar). Port 3000. NEXT_PUBLIC_* are inlined at
# `next build`, so they must be present as build args / build-time env in the Coolify project.
ARG NODE_VERSION=22-slim

# ── deps ────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS dependencies
RUN corepack enable && corepack prepare pnpm@12.3.4 --activate
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/registrar/package.json packages/registrar/
# The contracts package is the source of the generated errors ABI; only its manifest and that file are
# needed here, never the Solidity toolchain.
COPY packages/contracts/package.json packages/contracts/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
  pnpm install --frozen-lockfile --filter @ketsuban/web... --config.dedupe-peer-dependents=false

# ── build (standalone) ──────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS builder
RUN corepack enable && corepack prepare pnpm@12.3.4 --activate
WORKDIR /repo
COPY --from=dependencies /repo ./
COPY packages/registrar packages/registrar
COPY packages/contracts/abi packages/contracts/abi
COPY apps/web apps/web
ENV NODE_ENV=production
# Coolify passes the deployed commit → baked into the build stamp (NEXT_PUBLIC_BUILD_SHA).
ARG SOURCE_COMMIT
ENV SOURCE_COMMIT=$SOURCE_COMMIT
ARG NEXT_PUBLIC_PRIVY_APP_ID
ARG NEXT_PUBLIC_PRIVY_CLIENT_ID
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_ATTEST_URL
ARG NEXT_PUBLIC_CHAIN_ID
ARG NEXT_PUBLIC_MULTIPASS
ARG NEXT_PUBLIC_NAME_DOMAINS
ARG NEXT_PUBLIC_PARENT_NAMES
ARG NEXT_PUBLIC_SITE_URL
RUN pnpm --filter @ketsuban/registrar build && pnpm --filter @ketsuban/web build

# ── run ─────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
COPY --from=builder --chown=node:node /repo/apps/web/public ./apps/web/public
COPY --from=builder --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000

# Gate the traffic swap on READINESS, not on "the process started": Coolify's zero-downtime deploy
# cuts over when the container reports healthy. Uses node's global fetch (slim image has no curl).
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
