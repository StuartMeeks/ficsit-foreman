# Foreman — Claude Code Bootstrap Prompt

Read `SPEC.md` and `PARSER.md` in full before writing any code. Every architectural decision in this prompt traces back to those documents.

---

## What We're Building

**Foreman** is an AI companion web app for the game Satisfactory. It reduces cognitive load for players by acting as an AI foreman: issuing structured work orders, answering game questions accurately, and adapting to what's happening on the factory floor.

The foreman's personality is fully configurable by the player during onboarding — tone, character, and communication style are all player-defined and embedded into the system prompt. There is no hardcoded personality.

The app runs locally via Docker Compose and can be self-hosted or deployed to a cloud provider. Local install must be simple: prerequisites documented, setup is one command.

---

## Monorepo Structure

Scaffold this exact structure:

```
foreman/
  packages/
    client/           ← React + TypeScript + Vite frontend
    server/           ← Node.js + Express + TypeScript backend
    mcp/              ← TypeScript MCP server (game data + graph DB)
  docker-compose.yml
  docker-compose.prod.yml
  .env.example
  SPEC.md
  PARSER.md
  README.md
  package.json        ← workspace root (npm workspaces)
  tsconfig.base.json
```

Use **npm workspaces**. Each package has its own `package.json` and `tsconfig.json` extending `tsconfig.base.json`.

---

## Phase 1 Scope — What to Build Now

Phase 1 is the MCP server, parser, and graph layer only. Do not scaffold the client or server packages beyond empty placeholders with a `README.md` explaining their future purpose.

### `packages/mcp`

Build the complete MCP server with:

#### 1. Parser
See `PARSER.md` for the full technical design. Follow it exactly. This is the most important thing to get right.

#### 2. Graph Database (Kùzu)
Load the parsed `GameData` into an embedded Kùzu graph database. See `PARSER.md` for the schema and graph load architecture.

**Core principle: tools return computed, distilled answers — not raw rows.** The graph exists to make recursive production queries cheap server-side. The token saving comes from pushing computation into the graph layer, not leaving it for the model to do.

Kùzu is embedded and in-process — import it as a Node.js package. No daemon, no network, no external infra.

#### 3. MCP Tools
Expose the following tools using the official MCP TypeScript SDK (`@modelcontextprotocol/sdk`). Tool descriptions should be tight and model-facing — they appear in the system context on every request:

```
get_item(name: string): Item
  Resolve by displayName or className. Returns item details including form and sink points.

get_recipe(name: string): Recipe
  Resolve by displayName or className. Returns full recipe with ingredients, products, machine, and per-minute rates.

recipes_for(item: string): Recipe[]
  All recipes that produce the named item, including alternates. Flags which is the standard recipe.

ingredient_tree(item: string, targetPerMinute: number, recipeChoices?: Record<string, string>): IngredientTree
  Returns a FLAT list of per-minute requirements and machine counts for every tier of production.
  Does NOT return nested recipe objects. The graph does the recursion; the tool returns the answer.

total_raw_inputs(item: string, targetPerMinute: number): RawInputs[]
  Leaf raw resources only — iron ore, water, crude oil, etc. What the player actually needs to mine/extract.

what_consumes(item: string): Recipe[]
  All recipes that use this item as an ingredient.

compare_alternates(item: string): AlternateComparison
  Side-by-side cost and throughput comparison for all recipes that produce this item.

buildable_with(resources: string[]): string[]
  Given a list of raw resource names, returns all items that are producible from them.

list_schematics(tier?: number): Schematic[]
  All milestones and MAM nodes, optionally filtered by tier.

get_schematic(name: string): Schematic
  Returns a single schematic with unlock list.

cypher_query(query: string): unknown
  Guarded escape hatch. Executes a read-only Cypher query against the Kùzu graph.
  Rejects any query containing mutating keywords (CREATE, DELETE, SET, MERGE, DROP).
```

#### 4. Game Data Loading
On startup, path resolution priority:
- `SATISFACTORY_DOCS_PATH` env var — full path to `en-US.json`
- `SATISFACTORY_GAME_DIR` env var — game install root; server constructs `CommunityResources/Docs/en-US.json`
- Falls back gracefully with a warning and empty data if neither is set

#### 5. Version Tagging
All tool responses include the game data version string.

---

## Stack

| Layer | Choice |
|---|---|
| Language | TypeScript throughout |
| MCP SDK | `@modelcontextprotocol/sdk` (official) |
| Graph DB | Kùzu (embedded Node.js package — `kuzu`) |
| Runtime | Node.js 20+ |
| Test runner | Vitest |
| Linting | ESLint + Prettier |

No third-party parsing libraries. The parser is hand-written per `PARSER.md`.

---

## Docker Setup

Provide two Compose files:

**`docker-compose.yml`** (local dev):
```yaml
# Players mount their Satisfactory install as a read-only volume.
# SATISFACTORY_GAME_DIR is set in .env
volumes:
  - "${SATISFACTORY_GAME_DIR}:/game:ro"
environment:
  - SATISFACTORY_GAME_DIR=/game
  - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
```

**`docker-compose.prod.yml`** (hosted deployment):
- Postgres instead of SQLite
- No game directory mount (server operator provides the parsed data separately)
- Suitable for Railway/Render deployment

**`.env.example`** must document every required and optional variable with a comment explaining what it does and what values are valid.

---

## README.md (Root)

The root README is the project's front door. It must cover:

1. **What Foreman is** — one short paragraph
2. **Prerequisites** — listed clearly by platform (Windows/Mac/Linux), Docker path and bare-metal path separately
3. **Quick start (Docker)** — numbered steps, copy-pasteable commands
4. **Quick start (Bare Metal)** — numbered steps, copy-pasteable commands
5. **Pointing at your game install** — how to set `SATISFACTORY_GAME_DIR`, with example paths for Steam and Epic on Windows and Linux
6. **Configuration** — table of all env vars
7. **Contributing** — one paragraph pointing to open questions in `SPEC.md`
8. **Licence** — Apache 2.0
9. **Attribution** — "Built by Stu · GitHub · Reddit" — present but not the headline

Keep it factual and useful. No hype, no marketing copy.

---

## Code Standards

- Always use curly braces, even for single-line if/else/loops
- Explicit return types on all exported functions
- No `any` — use `unknown` and narrow it
- Errors are logged with context, never silently swallowed
- All parser warnings collected into `parseWarnings[]`, not thrown
- British English in all comments and documentation

---

## Licence

Apache 2.0. Include a `LICENSE` file in the repo root.

---

## What to Produce

1. Full monorepo scaffold with workspace config
2. `docker-compose.yml`, `docker-compose.prod.yml`, `.env.example`
3. `LICENSE` (Apache 2.0)
4. `packages/mcp` — complete and working:
   - Parser per `PARSER.md`
   - Kùzu graph load per `PARSER.md`
   - All MCP tools listed above
   - Unit tests covering parser edge cases and known-good production values
   - `README.md` explaining standalone use (e.g. wiring to Claude Desktop)
5. `packages/client/README.md` — placeholder only. Note that Phase 3 requires: a work order history view (full navigable list of all past orders), an active work order panel (always visible, no navigation required), and a foreman chat interface with streaming.
6. `packages/server/README.md` — placeholder only. Note that Phase 2 requires: work order persistence with the full schema from `SPEC.md` (including `sequenceNumber`, `status`, `completionSummary`, `adaptations`), sequential numbering (WO-001, WO-002, …), and enforcement that only one work order is `active` at a time.
7. Root `README.md` — per spec above

---

## Definition of Done for Phase 1

- [ ] `docker compose up` starts the MCP server cleanly from a fresh clone
- [ ] Bare-metal `npm run dev` also works from `packages/mcp`
- [ ] Pointed at a real Satisfactory install, all tools return accurate data
- [ ] `ingredient_tree` returns correct flat requirements for Reinforced Iron Plate and Turbo Motor
- [ ] `total_raw_inputs` correctly terminates at raw resource leaf nodes
- [ ] Fluid amounts display in m³/min, not raw integer units
- [ ] Alternate recipes are preserved and surfaced by `recipes_for` and `compare_alternates`
- [ ] Parser warnings surface cleanly without crashing
- [ ] All unit tests pass
- [ ] MCP server can be wired to Claude Desktop independently of the rest of the app

---

## Dev Environment Note

Development happens on a Proxmox VM via SSH. The Satisfactory game files 
are not directly accessible from the VM. The game data file (en-US.json) 
is copied manually from the Windows host using SCP and placed at 
game-data/en-US.json (gitignored). 

SATISFACTORY_DOCS_PATH should point to this local copy.
Do not assume the game directory is mounted or accessible at runtime.

---

## Git, Commit & PR Conventions

### Commits — Conventional Commits, body required
- Format: `type(optional-scope): subject` — imperative mood, lowercase subject,
  no trailing full stop. e.g. `feat(mcp): add HTTP transport`.
- Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`,
  `build`, `ci`, `chore`, `revert`.
- **A commit body is required** — explain *what* changed and *why* (wrap ~72 cols).
- Breaking changes: `type!: subject` plus a `BREAKING CHANGE:` footer.
- Keep the `Co-Authored-By: Claude …` trailer on Claude-authored commits.

### Branches
- Prefix by work type: `feature/<slug>`, `bugfix/<slug>`, `hotfix/<slug>`.
- `<slug>`: lowercase, words joined by `-`, drop filler words
  (a, an, the, to, of, for, with, and, using, …). e.g. `feature/http-transport`.
- Never commit directly to `main` — branch first (also enforced by the repo ruleset).

### Pull Requests
- One logical change per PR; keep it small (aim < ~500 changed lines).
- Squash-merge so `main` history stays linear; the squash commit message must
  follow the commit convention above.
- Update a branch from `main` with **rebase**, not a merge commit.
- Title: use the Conventional Commit summary (e.g. `feat: add HTTP transport`).
- Write the **complete** description at creation time, not in a later edit.
- **AI-generated PRs must begin the body with this exact line:**
  `🤖 AI-generated PR — Please review carefully.`
  (Keep the `🤖 Generated with Claude Code` trailer at the end as well.)

Commit titles follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).
