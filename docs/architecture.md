# FICSIT Foreman — Architecture

How the system fits together. For the product "why", see [`product.md`](./product.md);
for the work-order feature, [`work-orders.md`](./work-orders.md); for the session/playthrough &
foreman model (design), [`playthroughs.md`](./playthroughs.md); for the parser,
[`packages/game-data-core/PARSER.md`](../packages/game-data-core/PARSER.md).

---

## Services

FICSIT Foreman is a monorepo of npm-workspace packages that run as separate
services under one `foreman` Docker Compose project.

```
┌──────────────────────────────────────────────────────────┐
│                     Web App (React) — packages/client     │
│   Foreman chat (streaming)   ·   Work-order panel + history│
└───────────────────────────────┬──────────────────────────┘
                                │ REST + SSE  (/api proxied by nginx)
┌───────────────────────────────▼──────────────────────────┐
│              Backend (Node/Express) — packages/server      │
│  · LLM proxy (Anthropic or OpenAI-compatible), SSE stream  │
│  · session + work-order persistence (Prisma/SQLite→PG)     │
│  · MCP gateway: merges the tool surfaces of the servers ↓  │
└───────┬───────────────────────────┬───────────────┬──────┘
        │ MCP (Streamable HTTP)      │               │ LLM API
┌───────▼─────────┐   ┌──────────────▼────────┐   ┌──▼─────────────┐
│ mcp-game-data   │   │ mcp-save-game         │   │ Claude / OpenAI │
│ parser + Kùzu   │   │ (optional, SAVE_MCP_  │   │ -compatible     │
│ graph + world   │   │  URL): live save state│   │ foreman persona │
│ locations       │   │ — player, unlocks, …  │   │                 │
└─────────────────┘   └───────────────────────┘   └─────────────────┘
        └── both depend on packages/game-data-core (parser + bundled data) ──┘
```

The **game-data MCP** answers *"how is anything in the game made?"* from static
game data; the **save-game MCP** (optional) answers *"what has this pioneer
actually built/unlocked/collected?"* from their live save. The backend's **MCP
gateway** merges both into one tool surface for the foreman (see
[`packages/server/README.md`](../packages/server/README.md)); with no
`SAVE_MCP_URL` set it runs on game-data alone.

## Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Frontend | React + TypeScript + Vite | Fast dev, strong ecosystem |
| Backend | Node.js + Express + TypeScript | Unified language across the stack |
| MCP servers | TypeScript (official MCP SDK) | Same stack everywhere |
| Graph DB | Kùzu (embedded, in-process) | Recursive production queries are cheap; no daemon/infra |
| App DB | SQLite (dev) → Postgres (prod) | Zero local setup; clean migration path |
| ORM | Prisma | Readable schema, good migrations |
| Auth | Better Auth (self-hosted) | Email+password now, passkeys/TOTP next; HttpOnly-cookie sessions; Prisma adapter |
| Deployment | Docker Compose (local) + Railway/Render (hosted) | Laptop → production with the same images |
| Repo | Monorepo (`game-data-core`, `mcp-game-data`, `mcp-save-game`, `server`, `client`) | Easy to navigate |

## Accounts & identity

Using the app requires an account. Identity is a **user** (email + password as the
first factor), managed by [Better Auth](https://better-auth.com) mounted at
`/api/auth/*` with **HttpOnly-cookie** sessions — no auth token is exposed to client
JavaScript. Every play **session** (and through it its messages and work orders) is
scoped to a `userId`; the API rejects unauthenticated calls (401) and cross-user
access (403). The pioneer's own LLM API key stays **client-side** as before — it is
never sent to or stored by the server beyond the per-request header it authorises.

Better Auth owns four tables (`user`, `account`, `verification`, and its session
table, mapped to **`AuthSession`** so it does not collide with our domain `Session`).
On first sign-in the browser's existing pre-accounts session is **claimed** for the
new user, so anonymous work done before signing up is not lost. Opt-in MFA (passkeys
and TOTP + recovery codes, with a 30-day "trust this device") is the next slice.

## Computed-answers principle

MCP tools return **computed, distilled answers — not raw rows.** The graph exists
to make recursive production queries cheap; the token saving comes from pushing
computation server-side. For example, `ingredient_tree` returns a flat per-minute
requirement list and machine counts, not nested recipe objects the model must
reduce itself. The foreman asks one question and gets one useful answer.

## Game data: source of truth

Satisfactory ships `<install>/CommunityResources/Docs/en-US.json` — machine-readable
data for all items, recipes, buildings, and rates. FICSIT Foreman parses it with a
**purpose-built, hand-written parser** (no third-party parsing libraries), loads it
into Kùzu, and tags it to the detected game version. Bundled copies per release
channel ship with the game-data package so it works out of the box; players can
also point at a local install. Version support is additive. The full parser design
is in [`packages/game-data-core/PARSER.md`](../packages/game-data-core/PARSER.md).

## Graph schema (Kùzu)

Node tables:

| Node | Key fields |
|---|---|
| `Item` | className, displayName, form (solid/liquid/gas), stackSize, sinkPoints, isResource |
| `Recipe` | className, displayName, isAlternate, durationSeconds, power |
| `Building` | className, displayName, category, powerConsumption, maxPowerConsumption, powerProduction |
| `Schematic` | className, displayName, type (milestone/mam/awesome_shop/hard_drive), tier |

Relationship tables: `PRODUCES` / `CONSUMES` (Recipe→Item, with amount + perMinute),
`PRODUCED_IN` (Recipe→Building), `BUILD_COST` (Building→Item), and
`UNLOCKS_RECIPE` / `UNLOCKS_BUILDING` / `UNLOCKS_ITEM` (Schematic→…). `perMinute` is
computed at ingest (`amount * 60 / durationSeconds`) and stored on the relationship.

## Tool surface

The full, authoritative MCP tool reference lives with each package:
[`packages/mcp-game-data/README.md`](../packages/mcp-game-data/README.md) (recipes,
ingredient trees, raw inputs, alternates, schematics, buildings, world-location
queries, and a guarded `cypher_query`) and
[`packages/mcp-save-game/README.md`](../packages/mcp-save-game/README.md)
(player state, unlocks, milestones, storage, remaining collectibles). Name
resolution (displayName or className) is transparent — the foreman never needs
internal class names.

## Work orders

Work orders are application state owned by `packages/server` (not an MCP server):
stateful, auditable records with a plan/execution split, revision snapshots, an
audit trail, and parent/child relationships. The canonical design is
[`work-orders.md`](./work-orders.md).

## Deployment

- **Local (recommended):** `docker compose up -d --build` from the repo root runs
  the whole stack (see the root [`README.md`](../README.md) for the quick start and
  the [`.env.example`](../.env.example) for configuration).
- **Bare metal:** Node.js 22+ / npm 10+, `npm install && npm run dev`.
- **Hosted:** Railway/Render — the same images, Postgres in place of SQLite,
  environment variables in place of `.env`.

## Status / history

Built in phases: **1** (game-data MCP) and **2** (backend & foreman chat) are
complete; **3** (web UI) is in progress; the **save-game MCP** (originally Phase 4)
shipped v1 early. Live, per-component work is tracked in the
[issue tracker](https://github.com/StuartMeeks/ficsit-foreman/issues).
