# syntax=docker/dockerfile:1

# Foreman save-game MCP server image (scaffold).
#
# Builds the @foreman/mcp-save-game workspace. The package is currently a v1
# scaffold (see packages/mcp-save-game/SPEC.md) — the entry point exits
# immediately, so this image is wired up but not yet a running server. The HTTP
# transport, /health endpoint and HEALTHCHECK will be added with the v1 build.
#
# Point it at a save with SAVE_FILE_PATH (mount the save directory read-only).
#
# Base is glibc (bookworm-slim), not Alpine: the native `kuzu` addon ships a
# glibc prebuilt binary and will not load under musl.

# ── Build stage ─────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Install dependencies against the workspace lockfile first (better layer caching).
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/mcp-save-game/package.json ./packages/mcp-save-game/package.json
RUN npm ci

# Build, then drop dev dependencies so node_modules carries only runtime deps
# (keeping the kuzu binary that was just installed for this platform).
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

CMD ["node", "packages/mcp-save-game/dist/index.js"]
