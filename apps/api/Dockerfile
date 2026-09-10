# Production image for the relay / verification API (Coolify-friendly: single port, env-configured).
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@12.3.4 --activate
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/registrar/package.json packages/registrar/
# The contracts package is the source of the generated errors ABI; only its manifest and that file are
# needed here, never the Solidity toolchain.
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @ketsuban/api... --config.dedupe-peer-dependents=false
COPY packages/registrar packages/registrar
COPY packages/contracts/abi packages/contracts/abi
COPY apps/api apps/api
RUN pnpm --filter @ketsuban/registrar build && pnpm --filter @ketsuban/api build
RUN pnpm deploy --filter @ketsuban/api --prod /out

FROM node:22-alpine
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
WORKDIR /app
COPY --from=build /out /app
# Grants, gas top-ups and avatars live here. The directory has to exist in the image and be owned by
# the user that runs the service: a volume mounted at a path the image does not have is created
# root-owned, and this service writes as `node` — which fails as EACCES on the first grant.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8787
USER node
# Coolify overrides PORT from its "Ports Exposes" setting; probe whatever the server actually binds.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 CMD wget -qO- "http://127.0.0.1:${PORT:-8787}/healthz" || exit 1
CMD ["node", "dist/server.js"]
