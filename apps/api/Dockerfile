# Production image for the relay / verification API (Coolify-friendly: single port, env-configured).
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@12.3.4 --activate
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/registrar/package.json packages/registrar/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @att/api... --config.dedupe-peer-dependents=false
COPY packages/registrar packages/registrar
COPY apps/api apps/api
RUN pnpm --filter @att/registrar build && pnpm --filter @att/api build
RUN pnpm deploy --filter @att/api --prod /out

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out /app
EXPOSE 8787
USER node
HEALTHCHECK --interval=10s --timeout=3s --retries=6 CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
CMD ["node", "dist/server.js"]
