# syntax=docker/dockerfile:1

# FICSIT Foreman backend image.
#
# The Express/Anthropic proxy with foreman persona, MCP game-data tool use, and
# work-order persistence. Build from the repo ROOT so the workspace lockfile is
# available:
#
#   docker build -f packages/server/Dockerfile -t foreman-server .
#
# Defaults to HTTP on :8724, talking to the MCP server at http://mcp:8723/mcp
# (the compose service name) and persisting to a SQLite database under /data.
# Provide ANTHROPIC_API_KEY for the hosted tier, or let clients pass their own.
#
# Base is glibc (bookworm-slim), matching the Prisma query-engine prebuilt.

# ── Build stage ─────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Install workspace dependencies first for better layer caching.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/server/package.json ./packages/server/package.json
RUN npm ci

# Build: generate the Prisma client and compile TypeScript.
COPY packages/server ./packages/server
RUN npm run build -w @foreman/server

# ── Runtime stage ───────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8724 \
    MCP_URL=http://mcp:8723/mcp \
    DATABASE_URL=file:/data/foreman.db \
    SYSTEM_PROMPT_PATH=/app/SYSTEM_PROMPT.md
WORKDIR /app

# node_modules is copied whole (not pruned): it carries the generated Prisma
# client, the query engine, and the Prisma CLI used to apply migrations at start.
COPY package.json package-lock.json ./
COPY packages/server/package.json ./packages/server/package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/server/prisma ./packages/server/prisma
# The foreman system prompt is the repo-root source of truth.
COPY SYSTEM_PROMPT.md ./SYSTEM_PROMPT.md

# Writable data dir for the SQLite database; the named volume inherits this
# ownership on first creation so the unprivileged user can write.
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]

USER node
EXPOSE 8724

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8724)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Apply pending migrations, then start. Migrations are idempotent.
CMD ["sh", "-c", "npm run db:deploy -w @foreman/server && node packages/server/dist/index.js"]
