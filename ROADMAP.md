# FICSIT Foreman — Roadmap

This roadmap captures the versioned feature plan for each component of FICSIT
Foreman. **These are independent version tracks per component** — the GUI, the
game-data MCP server, and the save-game MCP server each move at their own pace.
They do **not** map onto the project phases in [`SPEC.md`](./SPEC.md); the phases
describe how the product was first built end-to-end, whereas these tracks describe
how each component grows from here.

Items are aspirational and may be reordered. Completed work is removed from this
file rather than ticked off — so everything here is still ahead of us.

---

## GUI

### v1 — Current scope
- Work order panel (north-star fidelity per `SPEC.md` Phase 3).
- Navigable work order history.

### v2 — Settings & Session Persistence
- Settings page with navigation sections:
  - Foreman preferences (personality).
  - Pioneer preferences (pioneer profile).
  - LLM keys.
  - Room for billing/subscription in future.
- Persist and load previous foreman/pioneer chat sessions.
- Load previous work orders across sessions.
- No auth required — session-based.

### v3 — Work Order Intelligence
- **Pre-work order dependency check:** before issuing a work order, the foreman
  checks whether existing automation covers the required materials. If not, it
  issues a pre-work order to establish that automation first (e.g. "automate
  copper sheets before building the coal power plant").
- **In-UI build progress checklist:** pioneers tick off steps and machine counts
  directly in the work order panel — no message to the foreman required per step.
  The foreman is only notified when the order is 100% complete.
- Required materials update as steps are checked off.
- Browse and search previous work orders.

### v4 — Sign-in & Multi-tenancy
- Sign in (auth — required for all v4 features).
- User-scoped data (sessions, work orders, preferences per account).
- Postgres becomes required (replaces SQLite).
- Room for billing/subscription integration.

### v5 — Interactive Map
- View collectibles and points of interest on a map (Mercer Spheres, Somersloops,
  crash sites, power slugs, bonus items).
- Requires map tile data — scope and approach TBD.

---

## MCP: Game Data (`packages/mcp-game-data`)

### v2 — Full Production Line Costing
- Production line from scratch **including logistics**: miners, water extractors,
  splitters, mergers, belts (by mark), pipes.
- New tool: `full_production_line(item, targetPerMinute)` — returns production
  machines + all logistics infrastructure and their build costs.

### v3 — World Locations: bonus pickups
- Extend the world-location dataset to the pickup classes not yet extracted —
  bonus items, helmets, tapes and other customiser/collectible pickups
  (`FGItemPickup_Spawnable`, `BP_UnlockPickup_*`), via the existing CUE4Parse
  extractor in `tools/world-locations/`.
- Surface them through the existing `list_collectibles` / `nearest_collectibles`
  tools (new collectible kinds), with the counts validated like the others.

---

## MCP: Save Game (`packages/mcp-save-game`)

**save file → parser → MCP server.** Exposes the pioneer's actual progress
(location, inventory, unlocks, collectibles) so the foreman can issue orders
grounded in reality rather than assumption. Full technical detail lives in
[`packages/mcp-save-game/SPEC.md`](./packages/mcp-save-game/SPEC.md).

### v2 — Power
- Generators (type, fuel, output, location).
- Power grids (total capacity, total consumption, coverage map).

### v3 — Production
- Active production lines (building, recipe, clock speed, location).
- Per-line production rates (actual vs theoretical).
