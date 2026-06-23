# syntax=docker/dockerfile:1

# FICSIT Foreman backend image.
#
# The Express/Anthropic proxy with foreman persona, MCP game-data tool use, and
# work-order persistence. Build from the repo ROOT so the workspace lockfile is
# available:
#
#   docker build -f packages/server/Dockerfile -t foreman-server .
#
# Defaults to HTTP on :8724, talking to the MCP server at http://mcp-game-data:8723/mcp
# (the compose service name) and persisting to a SQLite database under /data.
# Provide ANTHROPIC_API_KEY for the hosted tier, or let clients pass their own.
#
# Base is glibc (bookworm-slim): Prisma 7 has no Rust query engine — it connects
# via the better-sqlite3 driver adapter, a native addon with a glibc prebuilt.

# ── Build stage ─────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# bookworm-slim omits the openssl package; without it the Prisma CLI cannot
# detect the libssl version and warns while falling back to openssl-1.1.x.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# Install workspace dependencies first for better layer caching.
COPY package.json package-lock.json tsconfig.base.json ./
# Pin the npm version declared in package.json's packageManager field so the
# lockfile resolves identically here, in CI, and for local dev; also silences
# the npm update notice (the base image bundles npm 10).
RUN npm install -g "npm@$(node -p 'require("./package.json").packageManager.split("@")[1]')"
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
    MCP_URL=http://mcp-game-data:8723/mcp \
    DATABASE_URL=file:/data/foreman.db \
    SYSTEM_PROMPT_PATH=/app/SYSTEM_PROMPT.md
WORKDIR /app

# openssl so the Prisma CLI (migrate deploy at start-up) detects libssl cleanly.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# node_modules is copied whole (not pruned): it carries the generated Prisma
# client, the better-sqlite3 native addon + driver adapter, and the Prisma CLI
# used to apply migrations at start.
COPY package.json package-lock.json ./
# Pin the npm version from package.json's packageManager field (the migrate-deploy
# step at start-up runs via npm); also silences the notice.
RUN npm install -g "npm@$(node -p 'require("./package.json").packageManager.split("@")[1]')"
COPY packages/server/package.json ./packages/server/package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/server/prisma ./packages/server/prisma
# Prisma 7 reads the datasource URL from the config file (not schema.prisma), so
# the migrate-deploy step at container start needs it present.
COPY --from=builder /app/packages/server/prisma.config.ts ./packages/server/prisma.config.ts
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
