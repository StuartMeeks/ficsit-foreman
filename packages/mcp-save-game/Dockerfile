# syntax=docker/dockerfile:1

# Foreman save-game MCP server image.
#
# Builds the @foreman/mcp-save-game workspace and runs it over the HTTP
# transport. Point it at a save with SAVE_FILE_PATH (mount the save directory
# read-only). The parser is pure JavaScript (no native addon), so the base
# image is unconstrained; bookworm-slim is kept for parity with the game-data
# image.

# ── Build stage ─────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Install dependencies against the workspace lockfile first (better layer caching).
COPY package.json package-lock.json tsconfig.base.json ./
# Pin the npm version from package.json's packageManager field (consistent
# lockfile resolution; also silences the npm update notice).
RUN npm install -g "npm@$(node -p 'require("./package.json").packageManager.split("@")[1]')"
COPY packages/mcp-save-game/package.json ./packages/mcp-save-game/package.json
RUN npm ci

# Build, then drop dev dependencies so node_modules carries only runtime deps.
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
COPY packages/mcp-save-game/package.json ./packages/mcp-save-game/package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/mcp-save-game/dist ./packages/mcp-save-game/dist

USER node
EXPOSE 8726

# Health: hit the /health endpoint the HTTP transport exposes (Node 22 has fetch).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.MCP_HTTP_PORT||8726)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/mcp-save-game/dist/index.js"]
