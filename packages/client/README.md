# @foreman/client

The FICSIT Foreman web client — a React + TypeScript + Vite single-page app. It
runs as the `web` service in the `foreman` Docker Compose project, served by
nginx, which reverse-proxies `/api` to the backend so the browser uses a single
origin (no CORS).

> **Phase 3 status: in progress.** Account sign-in/up, foreman chat (session +
> streaming), the active **work-order cockpit** (built to the
> [Work Orders v2](../../docs/work-orders.md) model), and onboarding/settings are in
> place. The visual language lives in [`design-tokens.css`](./design-tokens.css)
> (the canonical palette + type), with Barlow / Barlow Condensed / IBM Plex Mono
> self-hosted (no CDN).

## What works

- **Accounts** — an email + password sign-in / sign-up gate stands before onboarding.
  Sessions are HttpOnly cookies (the client stores no auth token); on first sign-in
  the browser's existing anonymous session is claimed for the new account. Sign-out
  lives in the header. The BYO LLM key stays in the browser as before.
- **Foreman chat** — streams the foreman's reply token-by-token over SSE, and shows
  tool calls (game-data + work-order tools) as inline chips.
- **Work-order cockpit** — the active order rendered to the v2 model: state badge,
  plan-revised banner with a field-level diff + acknowledge, blocked banner,
  foreman completion suggestion, build-step and material checklists, machine built
  counters, a megawatt power hero, and collapsible recipes / resource nodes /
  two-group nearby collectibles / child orders / revision history. The pioneer
  starts, pauses, ticks items, sets counts, reverts, and **completes** (completion
  is Pioneer-only; the foreman only proposes) — all against the work-order REST
  API, updating live over SSE. A history list sits beneath the active order.
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

- **Fonts** are self-hosted via `@fontsource` (Barlow, Barlow Condensed, IBM Plex
  Mono), bundled same-origin so no CDN is needed (CSP-safe).
- Remaining Phase-3 work is tracked in the
  [issue tracker](https://github.com/StuartMeeks/ficsit-foreman/issues): a navigable
  Work History drawer, and driving the foreman propose-completion / chat flow
  end-to-end against a live backend.
