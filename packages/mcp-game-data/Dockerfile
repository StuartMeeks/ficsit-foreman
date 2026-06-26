# syntax=docker/dockerfile:1

# Foreman game-data MCP server image.
#
# Defaults to the HTTP transport on :8723 with the bundled stable game data
# baked in, so `docker run -p 8723:8723 <image>` serves data out of the box.
# Override game data with SATISFACTORY_GAME_CHANNEL, or mount an install and set
# SATISFACTORY_DOCS_PATH / SATISFACTORY_GAME_DIR.
#
# Depends on the @foreman/sf-game-data workspace package (parser + types +
# bundled data), so core is built first. Base is glibc (bookworm-slim), not
# Alpine: the native `kuzu` addon ships a glibc prebuilt binary that will not
# load under musl.

# ── Build stage ─────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Install dependencies against the workspace lockfile first (better layer caching).
# Both the core package.json and the server's must be present so npm ci can wire
# the workspace symlink.
COPY package.json package-lock.json tsconfig.base.json ./
# Pin the npm version from package.json's packageManager field (consistent
# lockfile resolution; also silences the npm update notice).
RUN npm install -g "npm@$(node -p 'require("./package.json").packageManager.split("@")[1]')"
COPY packages/sf-core/package.json ./packages/sf-core/package.json
COPY packages/sf-game-data/package.json ./packages/sf-game-data/package.json
COPY packages/mcp-game-data/package.json ./packages/mcp-game-data/package.json
RUN npm ci

# Build the shared kernel + core first, then verify the workspace symlink resolves.
COPY packages/sf-core ./packages/sf-core
RUN npm run build -w @foreman/sf-core
COPY packages/sf-game-data ./packages/sf-game-data
RUN npm run build -w @foreman/sf-game-data
RUN node -e "require.resolve('@foreman/sf-game-data')"

# Build the server, then drop dev dependencies so node_modules carries only
# runtime deps (keeping the kuzu binary and the core workspace link).
COPY packages/mcp-game-data ./packages/mcp-game-data
RUN npm run build -w @foreman/mcp-game-data && npm prune --omit=dev

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
COPY packages/mcp-game-data/package.json ./packages/mcp-game-data/package.json
COPY --from=builder /app/node_modules ./node_modules
# Core's compiled output + bundled game data (the workspace symlink in
# node_modules resolves to these paths); sf-core too (sf-game-data depends on it).
COPY --from=builder /app/packages/sf-core/dist ./packages/sf-core/dist
COPY --from=builder /app/packages/sf-game-data/dist ./packages/sf-game-data/dist
COPY --from=builder /app/packages/sf-game-data/data ./packages/sf-game-data/data
COPY --from=builder /app/packages/mcp-game-data/dist ./packages/mcp-game-data/dist

USER node
EXPOSE 8723

# Health: hit the /health endpoint the HTTP transport exposes (Node 22 has fetch).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.MCP_HTTP_PORT||8723)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/mcp-game-data/dist/index.js"]
