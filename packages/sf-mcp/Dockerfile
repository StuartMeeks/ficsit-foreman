# syntax=docker/dockerfile:1

# Foreman unified MCP server image (sf-mcp).
#
# Serves BOTH the Satisfactory game-data graph tools and the live save-game tools
# from one HTTP endpoint on :8723, with the bundled stable game data baked in, so
# `docker run -p 8723:8723 <image>` works out of the box. Override game data with
# SATISFACTORY_GAME_CHANNEL, or mount an install and set SATISFACTORY_DOCS_PATH /
# SATISFACTORY_GAME_DIR. Point at a save with SAVE_FILE_PATH (legacy/dev) or mount
# the shared saves volume at SAVE_DATA_DIR for per-playthrough saves.
#
# Builds the workspace lib chain sf-core → sf-game-data (+ bundled data) →
# sf-game-data-graph (carries the native kuzu addon) → sf-save-data (the .sav
# parser), then sf-mcp. Base is glibc (bookworm-slim), not Alpine: the native
# `kuzu` addon ships a glibc prebuilt binary that will not load under musl.

# ── Build stage ─────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Install dependencies against the workspace lockfile first (better layer caching).
# Every package.json in the build chain must be present so npm ci can wire the
# workspace symlinks.
COPY package.json package-lock.json tsconfig.base.json ./
# Pin the npm version from package.json's packageManager field (consistent
# lockfile resolution; also silences the npm update notice).
RUN npm install -g "npm@$(node -p 'require("./package.json").packageManager.split("@")[1]')"
COPY packages/sf-core/package.json ./packages/sf-core/package.json
COPY packages/sf-game-data/package.json ./packages/sf-game-data/package.json
COPY packages/sf-game-data-graph/package.json ./packages/sf-game-data-graph/package.json
COPY packages/sf-save-data/package.json ./packages/sf-save-data/package.json
COPY packages/sf-mcp/package.json ./packages/sf-mcp/package.json
RUN npm ci

# Build the shared kernel + the data/graph/save libs first, then verify the
# symlinks resolve.
COPY packages/sf-core ./packages/sf-core
RUN npm run build -w @foreman/sf-core
COPY packages/sf-game-data ./packages/sf-game-data
RUN npm run build -w @foreman/sf-game-data
COPY packages/sf-game-data-graph ./packages/sf-game-data-graph
RUN npm run build -w @foreman/sf-game-data-graph
COPY packages/sf-save-data ./packages/sf-save-data
RUN npm run build -w @foreman/sf-save-data
RUN node -e "require.resolve('@foreman/sf-game-data-graph')" \
  && node -e "require.resolve('@foreman/sf-save-data')"

# Build the server, then drop dev dependencies so node_modules carries only
# runtime deps (keeping the kuzu binary and the workspace links).
COPY packages/sf-mcp ./packages/sf-mcp
RUN npm run build -w @foreman/sf-mcp && npm prune --omit=dev

# ── Runtime stage ───────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    MCP_HTTP_HOST=0.0.0.0 \
    MCP_HTTP_PORT=8723
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/sf-core/package.json ./packages/sf-core/package.json
COPY packages/sf-game-data/package.json ./packages/sf-game-data/package.json
COPY packages/sf-game-data-graph/package.json ./packages/sf-game-data-graph/package.json
COPY packages/sf-save-data/package.json ./packages/sf-save-data/package.json
COPY packages/sf-mcp/package.json ./packages/sf-mcp/package.json
COPY --from=builder /app/node_modules ./node_modules
# Compiled output of the lib chain (the workspace symlinks resolve to these paths):
# sf-core ← sf-game-data (+ bundled data) ← sf-game-data-graph (carries kuzu);
# sf-save-data (the .sav parser).
COPY --from=builder /app/packages/sf-core/dist ./packages/sf-core/dist
COPY --from=builder /app/packages/sf-game-data/dist ./packages/sf-game-data/dist
COPY --from=builder /app/packages/sf-game-data/data ./packages/sf-game-data/data
COPY --from=builder /app/packages/sf-game-data-graph/dist ./packages/sf-game-data-graph/dist
COPY --from=builder /app/packages/sf-save-data/dist ./packages/sf-save-data/dist
COPY --from=builder /app/packages/sf-mcp/dist ./packages/sf-mcp/dist

# Shared saves volume (SAVE_DATA_DIR=/data/saves, read here, written by the
# server). This service starts first (the server depends on it), so it is the
# one that first-mounts the volume and fixes its ownership: create the mount
# point owned by the unprivileged user so a fresh volume inherits it, letting the
# server (same uid) write. node:22 uses uid 1000 in both images, so ownership is
# consistent. (An already-created volume keeps its old ownership — remove it once.)
RUN mkdir -p /data/saves && chown -R node:node /data

USER node
EXPOSE 8723

# Health: hit the /health endpoint the HTTP transport exposes (Node 22 has fetch).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.MCP_HTTP_PORT||8723)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/sf-mcp/dist/index.js"]
