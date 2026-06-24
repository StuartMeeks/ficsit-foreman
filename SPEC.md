# FICSIT Foreman — AI Companion for Satisfactory

> *Reduce cognitive load. Stay in the game. Build something you're proud of.*

---

## The Problem

Satisfactory is a deep, rewarding factory-building game — but it has a burnout problem.

Players start strong, grind through early milestones, and then hit a wall somewhere in the mid-tiers. Production chains get complex. The maths gets brutal. And YouTube is full of content creators with 500-hour megafactories, perfectly ratioed and beautifully lit. The comparison kills motivation. Players stop, uninstall, and never find out how good the late game actually is.

The problem isn't that Satisfactory is too hard. It's that:

1. **The cognitive load is unassisted.** Players are expected to manually calculate recipes, ratios, and resource requirements. This is fun for some, exhausting for many.
2. **There's no collaborator in the loop.** The game gives you goals but no guidance. You're alone with a wiki and a spreadsheet.
3. **Progress feels invisible.** Without a structure to reflect back what you've accomplished, it's easy to feel like you're not getting anywhere — even when you are.

---

## The Vision

**FICSIT Foreman** is an AI companion that lives alongside Satisfactory. It knows the game. It knows where you are in it. And it gives you a human-scaled next step — not an overwhelming blueprint.

It takes the role of your on-site foreman — with a personality you choose. It issues work orders. It tracks what you've completed. It adapts when things go sideways. And it keeps the maths off your plate so you can stay in the game.

The goal isn't to play the game *for* you. It's to keep you playing.

---

## Core Features

### 1. Foreman Chat
A persistent AI conversation interface. The player talks to their foreman, describes what's happening on the factory floor, asks questions, raises problems. The foreman responds in character — personality configured by the player — with real knowledge of the game.

### 2. Work Orders
The foreman issues structured work orders: a specific, achievable task with build costs, expected inputs/outputs, and a clear success condition. The current active work order is always visible in the UI. Completed orders are logged.

Work orders are designed to be:
- **Achievable within a session** — no overwhelming epics
- **Accurate** — built from real game data, not hallucinated ratios
- **Cheap to generate** — structured schema, not free-form prose

### 3. Game Data Backbone (MCP Server)
A locally-run MCP server backed by an embedded graph database (Kùzu). It parses the player's actual game install (`en-US.json` from `CommunityResources/Docs/`), loads the data into the graph, and exposes it as queryable MCP tools.

The graph makes recursive production queries — "what raw inputs do I need for this item, all the way down?" — cheap and fast to compute server-side, keeping tool responses compact and token-efficient.

The MCP server is version-aware: data is tagged to the game version detected from the install.

### 4. Onboarding & Personalisation
Before the foreman issues the first order, the player answers a short set of questions: play style, current game state, time available, goals, and foreman personality. These shape the foreman's approach — not just the first session, but ongoing.

Foreman personality is fully configurable. Players choose the tone and character of their foreman — examples might include gruff old-school supervisor, cheerful corporate optimist, dry efficiency obsessive, or drill sergeant — but the system is open-ended. The chosen personality is embedded into the foreman's system prompt and colours every interaction.

Personality is not locked at onboarding. The player can adjust it at any time through a settings panel. Changes take effect immediately — the foreman's next message reflects the updated personality. This allows the experience to evolve naturally: a player who wanted a drill sergeant at the start might want something more collaborative once the factory gets complex.

#### Pioneer Profile Elicitation

Alongside personality, onboarding captures three questions about the pioneer themselves. These are stored separately and injected into the system prompt as `{{PIONEER_PROFILE}}` — distinct from `{{PERSONALITY}}`. The foreman's character doesn't change based on the pioneer profile, but how it applies that character does.

**1. Experience level** — "How familiar are you with Satisfactory?"
- First playthrough — explain what things are, don't assume knowledge
- Returning player — assume familiarity, skip the basics
- Veteran — I know the game, just help me think

**2. Session style** — "How do you like to play?"
- Goal-oriented — clear task, let me get on with it
- Exploratory — I like to wander and discover things
- Mixed — direction when I need it, freedom when I don't

**3. Involvement** — "How much do you want the foreman involved?"
- Hands-on — check in often, lots of guidance
- Light touch — issue the order and trust me to execute
- On demand — I'll ask when I need you

Like the personality string, the generated pioneer profile is editable freeform text. The questions seed it; the pioneer owns it. The generated string is injected into the foreman's system prompt at `{{PIONEER_PROFILE}}`.

The interaction between the two blocks is intentional: a gruff foreman with a first-time player should still be gruff, but shouldn't assume knowledge. A warm mentor with a veteran can engage peer-to-peer. Personality sets the voice; pioneer profile sets the register.

### 5. Save Game Awareness
The save-game MCP server (`packages/mcp-save-game`, v1 shipped) parses a Satisfactory `.sav` to expose the pioneer's live state — location, inventory, unlocked recipes, milestones, and which collectibles remain. When the backend is pointed at it (`SAVE_MCP_URL`), the foreman reads that state so orders and opportunities reflect reality rather than assumption. Richer save-driven UX (in-app upload, verification) is ongoing — tracked in the [issue tracker](https://github.com/StuartMeeks/ficsit-foreman/issues).

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Web App (React)                  │
│  ┌─────────────────┐  ┌───────────────────────────┐ │
│  │   Foreman Chat  │  │  Work Order Panel         │ │
│  │   (streaming)   │  │  (active + history)       │ │
│  └─────────────────┘  └───────────────────────────┘ │
└──────────────────────────┬──────────────────────────┘
                           │ REST / WebSocket
┌──────────────────────────▼──────────────────────────┐
│                 Backend (Node/Express)               │
│  - API key proxy (user-supplied or subscription)    │
│  - Session & work order persistence                 │
│  - Save game parser (Phase 4)                       │
└──────────┬───────────────────────────┬──────────────┘
           │ MCP                       │ Anthropic API
┌──────────▼──────────┐   ┌────────────▼─────────────┐
│   MCP Server        │   │   Claude (claude-sonnet)  │
│   (TypeScript)      │   │                           │
│  - Parses en-US.json│   │   Foreman persona +       │
│  - Kùzu graph DB    │   │   MCP game data tools     │
│  - Computed answers │   │                           │
└─────────────────────┘   └───────────────────────────┘
```

### Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Frontend | React + TypeScript + Vite | Fast dev, strong ecosystem, Claude Code handles it well |
| Backend | Node.js + Express + TypeScript | Unified language across stack, simple to deploy |
| MCP Server | TypeScript (official MCP SDK) | Keeps stack unified; same pattern as the rest |
| Graph DB | Kùzu (embedded, in-process) | Recursive production queries are cheap; no daemon, no infra |
| App DB | SQLite (dev) → Postgres (prod) | Zero setup locally; straightforward migration path |
| ORM | Prisma | Human-readable schema, good migrations |
| Deployment | Docker Compose (local) + Railway/Render (hosted) | Simple path from laptop to production |
| Repo structure | Monorepo (`packages/client`, `packages/server`, `packages/mcp-game-data`, `packages/mcp-save-game`) | Easy for contributors to navigate |

### Computed Answers Principle

MCP tools return **computed, distilled answers — not raw rows.** The graph exists to make recursive production queries cheap; the token saving comes from pushing computation server-side.

For example: `ingredient_tree` returns a flat per-minute requirement list and machine counts. It does not return nested recipe objects that the model has to reduce itself. The foreman asks one question and gets one useful answer.

---

## Game Data: Source of Truth

Satisfactory ships a file at:
```
<game install>/CommunityResources/Docs/en-US.json
```

This file contains machine-readable data for all items, recipes, buildings, and production rates — the same source used by community wiki and calculator tools. In versions prior to 1.0, this file was named `Docs.json`; the 1.0 release split it into per-locale files.

**FICSIT Foreman parses this file directly using its own purpose-built parser.** No third-party parsing libraries are used. Players point the app at their game install directory during onboarding. The MCP server loads the parsed data into an embedded Kùzu graph database and tags it to the detected game version.

This means:
- Data is always accurate for the player's actual installed version
- No hand-curated datasets that go stale after updates
- No dependency on external tools that may lag behind game updates
- Multiple game versions can coexist in the index

**Supported versions:** Starting with the latest release (1.x). Version support is additive — older versions are not removed.

See `PARSER.md` for the full technical design of the parser.

---

## Graph Database Schema

Kùzu node tables:

| Node | Key fields |
|---|---|
| `Item` | className, displayName, form (solid/liquid/gas), stackSize, sinkPoints, isResource |
| `Recipe` | className, displayName, isAlternate, durationSeconds, power |
| `Building` | className, displayName, category, powerConsumption, maxPowerConsumption, powerProduction |
| `Schematic` | className, displayName, type (milestone/mam/awesome_shop/hard_drive), tier |

Kùzu relationship tables:

| Relationship | From → To | Properties |
|---|---|---|
| `PRODUCES` | Recipe → Item | amount, perMinute |
| `CONSUMES` | Recipe → Item | amount, perMinute |
| `PRODUCED_IN` | Recipe → Building | — |
| `BUILD_COST` | Building → Item | amount |
| `UNLOCKS_RECIPE` | Schematic → Recipe | — |
| `UNLOCKS_BUILDING` | Schematic → Building | — |
| `UNLOCKS_ITEM` | Schematic → Item | — |

Note: `perMinute` is computed at ingest time as `amount * 60 / durationSeconds`. It is stored on the relationship, not recalculated at query time.

---

## MCP Tools

Tools are high-level and return computed answers. The dataset is tiny (~hundreds of items, ~300 recipes); computation is cheap.

| Tool | Description |
|---|---|
| `get_item(name)` | Resolve by displayName or className, return item details |
| `get_recipe(name)` | Resolve by displayName or className, return full recipe |
| `recipes_for(item)` | All recipes that produce an item, including alternates |
| `ingredient_tree(item, targetPerMinute, recipeChoices?)` | Flattened per-minute requirements + machine counts for all tiers |
| `total_raw_inputs(item, targetPerMinute)` | Leaf raw resources only — what you actually need to mine/extract |
| `what_consumes(item)` | All recipes that use this item as an ingredient |
| `compare_alternates(item)` | Side-by-side cost and throughput comparison of alternate recipes |
| `buildable_with(resources)` | What items are producible from a given set of raw resources |
| `list_schematics(tier?)` | All milestones/MAM/shop/hard-drive schematics, optionally filtered by tier |
| `get_schematic(name)` | Resolve a single schematic by displayName or className; returns its full unlock list |
| `get_building(name)` | Resolve a building/machine; returns power draw (or max for variable machines), build cost, and — for generators — MW output with per-fuel burn, water and byproduct rates |
| `list_power_generators()` | Every power generator with MW output and full fuel/water/byproduct rates per fuel option |
| `list_collectibles(type?)` | Counts (and, for one type, positions) of world collectibles — Mercer Spheres, Somersloops, power slugs, hard-drive pods |
| `nearest_collectibles(origin, type?, n?)` | The N collectibles nearest a world position, by straight-line distance |
| `nearest_resource_nodes(origin, …)` | The N resource nodes nearest a position, with purity, optionally filtered by resource |
| `cypher_query(query)` | Guarded read-only escape hatch; rejects mutating keywords (CREATE/DELETE/SET/MERGE/DROP/…) |

Name resolution (displayName or className) is handled transparently — the foreman never needs to know internal class names.

The world-location tools (`list_collectibles`, `nearest_*`) are backed by a static, first-party dataset bundled with the game-data package; see [`packages/game-data-core/data/README.md`](./packages/game-data-core/data/README.md). A **second MCP server**, `packages/mcp-save-game`, exposes this save/player's live state (location, inventory, unlocked recipes, milestones, *remaining* collectibles); see [`packages/mcp-save-game/README.md`](./packages/mcp-save-game/README.md). The backend merges both servers into one tool surface for the foreman.

---

## Work Orders

Work orders are structured, stateful, auditable records — not prose. The complete
design (data model, state machine, revisions, audit trail, parent/child orders,
opportunities) is the canonical **[`WORK_ORDER_SPEC.md`](./WORK_ORDER_SPEC.md)**;
this section is a summary.

Key properties:

- **Sequential numbering** (WO-001, WO-002, …) for a human-readable history.
- **A state machine** — `new → active → completed`, plus `paused`, `blocked`, and
  the terminal `cancelled` / `superseded`. At most one order is `active` at a time.
- **Plan vs execution are separate.** The Foreman owns the plan (goal, build steps,
  materials, machines, recipes, expected outputs, opportunities); the Pioneer owns
  execution (checklists, machine built counts, logged hours). Plan edits are
  snapshotted as **revisions** the Pioneer acknowledges; execution history lives in
  an append-only **audit trail**. Reverting restores a plan without discarding
  progress.
- **Discriminated expected output** — a power plant leads with megawatts, not its
  coal/water throughput.
- **Completion is Pioneer-only** — the Foreman may *propose* completion but never
  closes an order itself.
- **Parent/child relationships** — e.g. a prerequisite hard-drive hunt that, on
  completion, auto-unblocks its blocked parent.

### Pioneer feedback

Completion optionally captures what the pioneer enjoyed and what felt tedious —
qualitative, low-friction input the Foreman carries forward to shape later orders
(de-prioritising belt-shuffling for someone who flags logistics as unfun; finding
reasons to send an explorer out). It is not a rating system; it is a moment to
reflect that reinforces the sense of progress that combats burnout.

### History view

The UI navigates the full order history (sequence number, title, state, completion
date); selecting an order shows its detail, revisions, and audit trail — a readable
record of the playthrough. The active order is always visible without navigation.

---

## Deployment

### Local (Docker Compose — recommended)

The primary local experience. One command, everything runs.

```bash
git clone https://github.com/stu-globe/foreman
cd foreman
cp .env.example .env
# Edit .env: set ANTHROPIC_API_KEY and SATISFACTORY_GAME_DIR
docker compose up
```

The Compose file mounts the player's Satisfactory install directory as a read-only volume so the MCP server can read `en-US.json` directly:

```yaml
volumes:
  - "${SATISFACTORY_GAME_DIR}:/game:ro"
```

**Prerequisites:** Docker Desktop (Windows/Mac) or Docker Engine (Linux). Nothing else.

### Local (Bare Metal)

For players who prefer not to use Docker:

**Prerequisites:**
- Node.js 22+
- npm 10+

```bash
git clone https://github.com/stu-globe/foreman
cd foreman
npm install
cp .env.example .env
# Edit .env: set ANTHROPIC_API_KEY and SATISFACTORY_GAME_DIR
npm run dev
```

### Self-Hosted / VM / Proxmox

Run the Docker Compose path inside your VM. No special configuration needed — the game directory mount path is the only platform-specific value and is set via `.env`.

### Hosted (Production)

Deployed to Railway or Render. Environment variables replace the `.env` file. Postgres replaces SQLite. The Docker image is the same; only the compose target changes.

---

## Monetisation Model

FICSIT Foreman is free to use. Sustainability is funded through:

| Tier | Access | API Cost |
|---|---|---|
| **Free** | Full feature access | Player supplies their own Anthropic API key |
| **Supporter** (Patreon / subscription) | Full feature access + no key needed + priority support | Absorbed by FICSIT Foreman |

Advertising is intentionally excluded. The Satisfactory community will support a tool they love through Patreon before they'll tolerate ads. Ads also conflict with the focused, distraction-free UX the product needs.

The subscription tier may later include additional features (richer work order templates, save game analysis, multi-save management) as the feature set matures.

---

## Phase Plan

> **Status:** Phases 1 (game-data MCP) and 2 (backend & foreman chat) are complete
> and merged. Phase 3 (web UI) is in progress. The save-game MCP from Phase 4 has
> shipped v1 ahead of schedule. The [issue tracker](https://github.com/StuartMeeks/ficsit-foreman/issues)
> tracks live, per-component work; the phases below are the original sequencing.

### Phase 1 — MCP Server & Graph Data Layer
- Parse `en-US.json` from local game install
- Load into embedded Kùzu graph database
- Expose MCP tools (see tool table above)
- Version detection and tagging
- Works standalone — can be wired to Claude Desktop independently of the rest of the app
- Docker Compose for local dev

### Phase 2 — Backend & Foreman Chat
- Node/Express backend with Anthropic API proxy
- Foreman system prompt (persona, game knowledge, work order authority)
- Streaming chat with MCP tool use
- Work order generation endpoint (structured schema)
- SQLite persistence (sessions, work orders)

### Phase 3 — Web UI
- React frontend
- Foreman chat interface (streaming)
- Work order panel (active order always visible)
- Work order history log
- Onboarding flow (player personalisation + foreman personality)
- API key input for free tier

### Phase 4 — Save Game Integration
- Save file upload and parsing
- Inventory, milestone, and build state extraction
- Foreman references actual game state in work orders

> The save-file parser and its MCP tools live in their own package,
> `packages/mcp-save-game` (a second MCP server alongside `packages/mcp-game-data`).
> Its full technical design — architecture, the v1 Pioneer Progress tools, and the
> save-file-format / parser build-vs-adopt tradeoffs — is in
> [`packages/mcp-save-game/SPEC.md`](./packages/mcp-save-game/SPEC.md). See also
> the [issue tracker](https://github.com/StuartMeeks/ficsit-foreman/issues) for its versioned plan.

### Phase 5 — Production Readiness
- Postgres migration
- Deploy to Railway/Render
- Patreon/subscription integration
- User accounts (optional — may stay session-based)

---

## Token Optimisation Strategy

LLM cost is a real constraint, especially for free-tier users on their own API keys:

1. **Tools return computed answers, not raw data.** The graph does the reduction server-side. The model gets a flat, ready-to-use result.
2. **Work orders are generated once and stored.** The foreman references the stored object; it doesn't regenerate on every message.
3. **System prompt is tight.** The foreman persona and instructions are compact. Game knowledge comes from MCP tool calls, not embedded context.
4. **Conversation history is windowed.** Only the last N messages are sent with each request. Completed work orders are summarised, not replayed in full.

---

## Open Questions

Open design questions are tracked as [`question`-labelled issues](https://github.com/StuartMeeks/ficsit-foreman/issues?q=is%3Aissue+is%3Aopen+label%3Aquestion) in the issue tracker.

*(Resolved: alt-recipe unlock status is save-state, surfaced by the save-game MCP's `get_unlocked_recipes`; the save parser adopted `@etothepii4/satisfactory-file-parser` — see [`packages/mcp-save-game/SPEC.md`](./packages/mcp-save-game/SPEC.md).)*

---

## Licence & Attribution

**Licence:** Apache 2.0. Use it, fork it, build on it.

This project is community-first and unbranded. It exists to serve Satisfactory players, not to promote any individual or company.

**Built by:** Stu ([GitHub](https://github.com/StuartMeeks) · [Reddit](https://www.reddit.com/user/sherman384))

Contributions welcome. If you want to help, start with the open questions or check the issue tracker.

---

*For pioneers who just want to build something great.*
