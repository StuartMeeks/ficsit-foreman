# @foreman/client

The FICSIT Foreman web client — a React + TypeScript + Vite single-page app. It
runs as the `web` service in the `foreman` Docker Compose project, served by
nginx, which reverse-proxies `/api` to the backend so the browser uses a single
origin (no CORS).

> **Phase 3 status: in progress.** A working conversation with the foreman
> (session + streaming chat), an active work-order panel, a history list, and
> onboarding/settings are in place. The work-order panel is currently minimal and
> is being **reworked against the Work Orders v2 model** ([`WORK_ORDER_SPEC.md`](../../WORK_ORDER_SPEC.md))
> — states, checklists, machine counters, revisions, and opportunities. The visual
> language follows the north star in [`design-reference/`](./design-reference/) via
> [`design-tokens.css`](./design-tokens.css).

## What works

- **Foreman chat** — creates a session automatically, streams the foreman's
  reply token-by-token over SSE, and shows tool calls (game-data + work-order
  tools) as inline chips.
- **Active work order** — when the foreman issues one, it appears in the right
  panel; a minimal history list sits beneath it.
- **Settings** — set the foreman's personality and the pioneer profile (stored
  on the session) and an optional Anthropic API key (kept only in the browser,
  sent per request — needed unless the server has its own key).

## Run

### With Docker Compose (recommended)

From the repo root, the whole stack builds and runs together:

```bash
docker compose up -d --build
```

Then open **http://localhost:8725**. (Backend on `:8724`, MCP on `:8723`.)

### Bare metal (dev)

```bash
# from the repo root
npm install
npm run dev:web        # Vite dev server on http://localhost:5173
```

The dev server proxies `/api` to `http://localhost:8724` (override with
`VITE_API_TARGET`), so run the backend (`npm run dev:server`) and MCP server
alongside it.

## Notes / next steps

- **Fonts** fall back to system mono/sans for now. The north star uses IBM Plex
  Mono, Barlow, and Barlow Condensed — these should be self-hosted (no CDN) in a
  later pass.
- The work-order panel is being rebuilt against the Work Orders v2 model
  ([`WORK_ORDER_SPEC.md`](../../WORK_ORDER_SPEC.md)). The prototype's per-step and
  per-material progress (`2/6`, ✓/✗) is now directly supported — v2 checklists
  carry stable ids and checked state, so the panel can render and mutate them via
  the work-order REST endpoints.
