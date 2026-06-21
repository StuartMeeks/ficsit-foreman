# syntax=docker/dockerfile:1

# FICSIT Foreman web client image.
#
# Builds the Vite/React SPA and serves it with nginx, reverse-proxying /api to
# the backend (the compose "server" service) so the browser uses a single
# origin. Build from the repo ROOT so the workspace lockfile is available:
#
#   docker build -f packages/client/Dockerfile -t foreman-web .

# ── Build stage ─────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/client/package.json ./packages/client/package.json
RUN npm ci

COPY packages/client ./packages/client
RUN npm run build -w @foreman/client

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM nginx:alpine AS runtime
COPY packages/client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/packages/client/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1
