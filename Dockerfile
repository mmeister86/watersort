# --- Build stage -----------------------------------------------------------
# Installs all workspace dependencies, builds the SPA and the server bundle,
# then drops dev dependencies so only what the runtime needs is copied over.
FROM node:22-alpine AS build
WORKDIR /app

# Manifests first so the dependency layer is cached across source-only changes.
# npm workspaces require every workspace package.json to be present for `ci`.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY web/package.json ./web/
COPY server/package.json ./server/
RUN npm ci

# Sources (see .dockerignore). `npm run build` emits server/dist/index.js and
# web/dist; `npm prune --omit=dev` turns node_modules into the production set.
COPY . .
RUN npm run build \
 && npm prune --omit=dev

# --- Runtime stage ---------------------------------------------------------
FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000

# The server bundle is external-dependency based: it needs the pruned
# node_modules (hono, @hono/node-server). The SPA is served from `public/`,
# which is one of the locations `server/src/index.ts` probes at startup.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server
# Explicit ESM marker for `node server/index.js`: server/package.json carries
# `"type": "module"`, so the runtime does not depend on Node's module-syntax
# auto-detection.
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/web/dist ./public

# The Coolify volume mounts at /data. Create it owned by `node` so a fresh
# named volume is writable; host bind mounts may still need matching perms.
RUN mkdir -p /data && chown -R node:node /data

USER node

EXPOSE 3000

# Liveness probe against the public, unauthenticated health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
