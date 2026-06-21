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

### 5. Save Game Awareness *(Phase 4)*
Players can upload their save file. The foreman parses it to understand what's actually been built, what resources are available, and what milestones have been unlocked — giving orders that reflect reality rather than assumption.

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
| Repo structure | Monorepo (`packages/client`, `packages/server`, `packages/mcp`) | Easy for contributors to navigate |

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
| `Building` | className, displayName, category, powerConsumption |
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
| `cypher_query(query)` | Guarded read-only escape hatch; rejects mutating keywords (CREATE/DELETE/SET/MERGE/DROP/…) |

Name resolution (displayName or className) is handled transparently — the foreman never needs to know internal class names.

---

## Work Order Schema

Work orders are structured data, not prose. This keeps generation cheap and rendering consistent.

Work orders are numbered sequentially (WO-001, WO-002, …) so the history list is human-readable at a glance. When a work order is completed, the foreman writes a short `completionSummary` and captures the pioneer's feedback on what they enjoyed and what they didn't. This feedback is carried forward as influence on future work orders — the foreman uses it to shape the character of what it assigns next.

```typescript
interface WorkOrder {
  id: string;
  sequenceNumber: number;      // Display as WO-001, WO-002, etc.
  status: 'active' | 'completed' | 'abandoned';
  version: string;             // Game version this order was built for
  issuedAt: string;            // ISO timestamp
  completedAt?: string;        // Set when status → completed or abandoned

  title: string;               // e.g. "Establish Iron Ingot Line"
  objective: string;           // One sentence. What done looks like.

  tier: number;                // Satisfactory milestone tier (0–9)
  estimatedDuration: string;   // e.g. "20–30 minutes"

  requiredItems: LineItem[];   // What the player needs to have on hand
  buildSteps: string[];        // Ordered, plain-language instructions

  expectedOutput: {
    item: string;
    perMinute: number;
  }[];

  notes?: string;              // Optional foreman commentary issued with the order
  adaptations?: string[];      // Logged mid-order changes (power crisis, bottleneck, etc.)
  completionSummary?: string;  // Written by the foreman on close-out. What was actually achieved.

  pioneerFeedback?: {
    enjoyedAspects: string[];  // What the pioneer found fun — captured at close-out
    didNotEnjoy: string[];     // What felt tedious, frustrating, or unfun
    freeformNotes?: string;    // Optional open-ended comment from the pioneer
  };
}

interface LineItem {
  item: string;
  quantity: number;
  unit: string;                // "units", "per minute", etc.
}
```

### Pioneer Feedback

When closing out a work order, the foreman asks the pioneer two simple questions: what did you enjoy about that, and what didn't you enjoy? The answers are stored on the work order and carried forward as context when the foreman plans the next assignment.

This is not a rating system. It is qualitative input — free-form, low friction. The foreman uses it to notice patterns over time: if the pioneer consistently flags logistics work as unfun, the foreman deprioritises belt-shuffling tasks where it has a choice. If the pioneer lights up every time they explore, the foreman finds reasons to send them out.

The feedback mechanism also gives the pioneer a moment to reflect at the end of each session, which reinforces the sense of progress and accomplishment that combats burnout.

### History View Requirements

The UI must support navigating the full work order history. The history list shows: sequence number, title, status, and completion date. Selecting a completed work order displays the full order detail including `completionSummary`, any logged `adaptations`, and the pioneer's feedback. This gives the player a readable record of their playthrough — what was built, when, what went sideways, and how it felt.

Only one work order is `active` at a time. The active order is always visible in the main UI panel without navigation.

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

- [ ] Does `en-US.json` include alt recipe unlock status, or is that save-state only?
- [ ] User accounts or session-only for v1? (session-only is simpler; accounts needed for cross-device and Patreon gating)
- [ ] What's the right conversation history window size? (needs testing)
- [ ] Save game parser: build from scratch or adopt `etothepii4/satisfactory-file-parser`?

---

## Licence & Attribution

**Licence:** Apache 2.0. Use it, fork it, build on it.

This project is community-first and unbranded. It exists to serve Satisfactory players, not to promote any individual or company.

**Built by:** Stu ([GitHub](https://github.com/StuartMeeks) · [Reddit](https://www.reddit.com/user/sherman384))

Contributions welcome. If you want to help, start with the open questions or check the issue tracker.

---

*For pioneers who just want to build something great.*
