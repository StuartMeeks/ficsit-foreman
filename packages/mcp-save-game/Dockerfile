# syntax=docker/dockerfile:1

# Foreman save-game MCP server image.
#
# Builds the @foreman/mcp-save-game workspace and runs it over the HTTP
# transport. Point it at a save with SAVE_FILE_PATH (mount the save directory
# read-only). Depends on the @foreman/sf-game-data workspace package (parser +
# bundled game data) for resolving real item display names, so core is built
# first and its bundled data ships in the runtime image. The parsers are pure
# JavaScript (no native addon); bookworm-slim is kept for parity.

# ── Build stage ─────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Install dependencies against the workspace lockfile first (better layer caching).
# Both core's package.json and the server's must be present so npm ci can wire
# the workspace symlink.
COPY package.json package-lock.json tsconfig.base.json ./
# Pin the npm version from package.json's packageManager field (consistent
# lockfile resolution; also silences the npm update notice).
RUN npm install -g "npm@$(node -p 'require("./package.json").packageManager.split("@")[1]')"
COPY packages/sf-core/package.json ./packages/sf-core/package.json
COPY packages/sf-game-data/package.json ./packages/sf-game-data/package.json
COPY packages/mcp-save-game/package.json ./packages/mcp-save-game/package.json
RUN npm ci

# Build the shared kernel + core first, then verify the workspace symlink resolves.
COPY packages/sf-core ./packages/sf-core
RUN npm run build -w @foreman/sf-core
COPY packages/sf-game-data ./packages/sf-game-data
RUN npm run build -w @foreman/sf-game-data
RUN node -e "require.resolve('@foreman/sf-game-data')"

# Build the server, then drop dev dependencies so node_modules carries only
# runtime deps (keeping the core workspace link).
COPY packages/mcp-save-game ./packages/mcp-save-game
RUN npm run build -w @foreman/mcp-save-game && npm prune --omit=dev

# ── Runtime stage ───────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    MCP_HTTP_HOST=0.0.0.0 \
    MCP_HTTP_PORT=8726
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/sf-core/package.json ./packages/sf-core/package.json
COPY packages/sf-game-data/package.json ./packages/sf-game-data/package.json
COPY packages/mcp-save-game/package.json ./packages/mcp-save-game/package.json
COPY --from=builder /app/node_modules ./node_modules
# Core's compiled output + bundled game data (the workspace symlink resolves to
# these paths; the bundled en-US.json supplies real item display names); sf-core
# too (sf-game-data depends on it).
COPY --from=builder /app/packages/sf-core/dist ./packages/sf-core/dist
COPY --from=builder /app/packages/sf-game-data/dist ./packages/sf-game-data/dist
COPY --from=builder /app/packages/sf-game-data/data ./packages/sf-game-data/data
COPY --from=builder /app/packages/mcp-save-game/dist ./packages/mcp-save-game/dist

# Shared saves volume (SAVE_DATA_DIR=/data/saves, read here, written by the
# server). This service starts first (the server depends on it), so it is the
# one that first-mounts the volume and fixes its ownership: create the mount
# point owned by the unprivileged user so a fresh volume inherits it, letting the
# server (same uid) write. node:22 uses uid 1000 in both images, so ownership is
# consistent. (An already-created volume keeps its old ownership — remove it once.)
RUN mkdir -p /data/saves && chown -R node:node /data

USER node
EXPOSE 8726

# Health: hit the /health endpoint the HTTP transport exposes (Node 22 has fetch).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.MCP_HTTP_PORT||8726)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/mcp-save-game/dist/index.js"]
