# syntax=docker/dockerfile:1

# Foreman MCP server image.
#
# Defaults to the HTTP transport on :8723 with the bundled stable game data
# baked in, so `docker run -p 8723:8723 <image>` serves data out of the box.
# Override game data with SATISFACTORY_GAME_CHANNEL, or mount an install and set
# SATISFACTORY_DOCS_PATH / SATISFACTORY_GAME_DIR.
#
# Base is glibc (bookworm-slim), not Alpine: the native `kuzu` addon ships a
# glibc prebuilt binary and will not load under musl.

# ── Build stage ─────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Install dependencies against the workspace lockfile first (better layer caching).
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/mcp/package.json ./packages/mcp/package.json
RUN npm ci

# Build, then drop dev dependencies so node_modules carries only runtime deps
# (keeping the kuzu binary that was just installed for this platform).
COPY packages/mcp ./packages/mcp
RUN npm run build -w @foreman/mcp && npm prune --omit=dev

# ── Runtime stage ───────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    MCP_HTTP_HOST=0.0.0.0 \
    MCP_HTTP_PORT=8723
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/mcp/package.json ./packages/mcp/package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/mcp/dist ./packages/mcp/dist
COPY --from=builder /app/packages/mcp/data ./packages/mcp/data

USER node
EXPOSE 8723

# Health: hit the /health endpoint the HTTP transport exposes (Node 22 has fetch).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.MCP_HTTP_PORT||8723)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/mcp/dist/index.js"]
