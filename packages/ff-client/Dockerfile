# syntax=docker/dockerfile:1

# FICSIT Foreman web client image.
#
# Builds the Vite/React SPA and serves it with nginx, reverse-proxying /api to
# the backend (the compose "ff-server" service) so the browser uses a single
# origin. Build from the repo ROOT so the workspace lockfile is available:
#
#   docker build -f packages/ff-client/Dockerfile -t foreman-ff-client .

# ── Build stage ─────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
# Pin the npm version from package.json's packageManager field (consistent
# lockfile resolution; also silences the npm update notice).
RUN npm install -g "npm@$(node -p 'require("./package.json").packageManager.split("@")[1]')"
COPY packages/ff-client/package.json ./packages/ff-client/package.json
RUN npm ci

COPY packages/ff-client ./packages/ff-client
RUN npm run build -w @foreman/ff-client

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM nginx:alpine AS runtime
COPY packages/ff-client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/packages/ff-client/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1
