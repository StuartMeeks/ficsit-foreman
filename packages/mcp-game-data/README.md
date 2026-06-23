# @foreman/mcp-game-data

The FICSIT Foreman game-data MCP server. It parses Satisfactory's `en-US.json` game data, loads it
into an embedded [Kùzu](https://kuzudb.com) graph database, and exposes it as a set
of computed, token-efficient [Model Context Protocol](https://modelcontextprotocol.io)
tools.

It runs standalone and can be wired directly into Claude Desktop — no other part of
FICSIT Foreman is required.

> **Core principle:** tools return computed, distilled answers — not raw rows. The
> graph makes recursive production queries cheap server-side, so the model asks one
> question and gets one ready-to-use answer.

---

## Prerequisites

- Node.js 22+
- A copy of Satisfactory's `en-US.json` (ships at
  `<game install>/CommunityResources/Docs/en-US.json`). The file is UTF-16 LE — the
  parser handles that for you.

## Install & build

From the repository root (npm workspaces):

```bash
npm install
npm run build -w @foreman/mcp-game-data
```

## Pointing it at game data

The server resolves the docs file in this priority order:

| Priority | Source | Meaning |
|---|---|---|
| 1 | `SATISFACTORY_DOCS_PATH` | Full path directly to `en-US.json`. Highest priority. |
| 2 | `SATISFACTORY_GAME_DIR` | Game install root; the server appends `CommunityResources/Docs/en-US.json` (falling back to the pre-1.0 `Docs.json`). |
| 3 | Bundled channel | Committed game data under `packages/game-data-core/data/<channel>/`, where `<channel>` is `stable` or `experimental`. Selected by `SATISFACTORY_GAME_CHANNEL` (default `stable`; falls back to the other channel if absent). Supplied via PRs — see [CONTRIBUTING.md](../../CONTRIBUTING.md). |

If none of these resolve, the server starts with an empty dataset and logs a
warning (it never crashes). A leading `~` is expanded to your home directory.

`SATISFACTORY_GAME_CHANNEL` (`stable` | `experimental`, default `stable`) chooses
which bundled channel to load — the hook the future UI's stable/experimental
toggle will use.

## Running

```bash
# Development (watch mode, runs TypeScript directly):
SATISFACTORY_DOCS_PATH=/path/to/en-US.json npm run dev -w @foreman/mcp-game-data

# Production (after build):
SATISFACTORY_DOCS_PATH=/path/to/en-US.json npm run start -w @foreman/mcp-game-data
```

By default the server speaks MCP over **stdio** — there is no network port; the client
spawns it as a child process and talks over stdin/stdout. All logging goes to stderr;
stdout is reserved for the protocol. Startup echoes the loaded docs path, game version
and entity counts.

### HTTP transport (opt-in)

To listen on a network port instead, set `MCP_TRANSPORT=http`. This uses the MCP
Streamable HTTP transport (stateless) and serves on `/mcp`, with a `/health` endpoint.

```bash
SATISFACTORY_DOCS_PATH=/path/to/en-US.json \
MCP_TRANSPORT=http MCP_HTTP_HOST=0.0.0.0 MCP_HTTP_PORT=8723 \
  npm run start -w @foreman/mcp-game-data
# → [foreman-mcp] Listening on http://0.0.0.0:8723/mcp (health: /health)
#   (when bound to 0.0.0.0 it also logs each reachable LAN address)
```

| Variable | Default | Meaning |
|---|---|---|
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http`. |
| `MCP_HTTP_HOST` | `0.0.0.0` | Bind host for http mode. |
| `MCP_HTTP_PORT` | `8723` | Port for http mode. |

> **Security:** the HTTP transport has **no authentication**. Only run it on a trusted
> localhost/LAN, or put an authenticating proxy in front of it.

### Docker

A container image (`ghcr.io/stuartmeeks/foreman-mcp-game-data`) ships the bundled stable game data
and defaults to HTTP on `:8723`. See [Run with Docker](../../README.md#run-with-docker) in
the root README.

## Inspecting without an MCP client

A small CLI exercises any tool directly (it prints to stdout):

```bash
npm run inspect -w @foreman/mcp-game-data                                  # summary + tool list
npm run inspect -w @foreman/mcp-game-data ingredient_tree '{"item":"Reinforced Iron Plate","targetPerMinute":5}'
npm run inspect -w @foreman/mcp-game-data total_raw_inputs '{"item":"Turbo Motor","targetPerMinute":1}'
npm run inspect -w @foreman/mcp-game-data compare_alternates '{"item":"Reinforced Iron Plate"}'
```

## Wiring into Claude Desktop

Build first (`npm run build -w @foreman/mcp-game-data`), then add this to your Claude Desktop
config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "foreman": {
      "command": "node",
      "args": ["/absolute/path/to/foreman/packages/mcp-game-data/dist/index.js"],
      "env": {
        "SATISFACTORY_DOCS_PATH": "/absolute/path/to/en-US.json"
      }
    }
  }
}
```

Restart Claude Desktop; the FICSIT Foreman tools appear in the tool list. Every response is
tagged with the detected game version.

---

## Tools

| Tool | Description |
|---|---|
| `get_item(name)` | Resolve an item by display name or class name; returns form and sink points. |
| `get_recipe(name)` | Full recipe: ingredients, products, machine, per-minute rates. |
| `recipes_for(item)` | All recipes that produce an item, including alternates; flags the standard. |
| `ingredient_tree(item, targetPerMinute, recipeChoices?)` | Flat per-minute requirements + machine counts for every tier. |
| `total_raw_inputs(item, targetPerMinute)` | Leaf raw resources only — what to mine/extract. |
| `what_consumes(item)` | All recipes that use an item as an ingredient. |
| `compare_alternates(item)` | Side-by-side cost/throughput of every recipe producing an item. |
| `buildable_with(resources)` | Items producible from a set of raw resources (transitive closure). |
| `list_schematics(tier?)` | Milestones/MAM/shop/hard-drive schematics, optionally by tier. |
| `get_schematic(name)` | A single schematic with its full unlock list. |
| `cypher_query(query)` | Guarded read-only Cypher escape hatch (rejects mutating keywords). |
| `list_collectibles(type?)` | World totals per collectible kind; full coordinate list for one kind when `type` is given. |
| `nearest_collectibles(coord, type?, n?)` | Collectibles nearest a location, with distance — "what can I grab near me?". |
| `nearest_resource_nodes(coord, resource?, purity?, n?)` | Resource nodes nearest a location, with resource type, purity and distance. |

Name resolution (display name, case-insensitive, or exact class name) is transparent —
the foreman never needs to know internal class names.

### World locations

`list_collectibles`, `nearest_collectibles` and `nearest_resource_nodes` are
backed by a static, first-party **world-location dataset** bundled in
`@foreman/game-data-core` (`data/<channel>/world-locations.json`) — every fixed
collectible (Mercer Spheres, Somersloops, power slugs, hard-drive drop pods) and
resource extraction point (ore/fluid nodes, fracking satellites and cores,
geothermal geysers) with coordinates, resource type and purity. It is loaded
straight into memory (a flat point list plus a distance sort) rather than into
the graph. Coordinates are Unreal world units (centimetres), matching the save
game, so a pioneer's position is directly comparable. Override the dataset path
with `WORLD_LOCATIONS_PATH`.

The dataset was extracted from the packaged Satisfactory level files with
[CUE4Parse](https://github.com/FabianFG/CUE4Parse) using the `FactoryGame.usmap`
mappings Coffee Stain ships in `CommunityResources/`. Only factual coordinates
are stored — no game assets are redistributed. Collectible counts are validated
in CI against the known fixed world totals.

## Architecture

```
src/
  parser/    en-US.json → clean GameData (UTF-16, Unreal string encodings, fluids, …)
  graph/     GameData → in-memory Kùzu graph + query layer
  tools/     MCP tool registration (zod schemas, version-tagged responses)
  config.ts  docs-path resolution
  logger.ts  stderr-only logging
  index.ts   server entry (stdio transport)
```

**Where recursion happens.** `ingredient_tree`, `total_raw_inputs` and `buildable_with`
need a *weighted* roll-up: demand multiplies along each production edge, recipe choice
branches per item, and shared sub-components must sum. That is not expressible cleanly
in recursive Cypher, so the graph supplies the structure (producing recipes and their
consume edges, fetched with parameterised queries) and the weighted accumulation is done
in TypeScript over a topologically-ordered subgraph. Raw resources are always treated as
leaves — the game has Converter recipes that *produce* ores, but `total_raw_inputs`
correctly terminates at what the player mines.

## Testing

```bash
npm run test -w @foreman/mcp-game-data
```

Tests run against hand-crafted fixtures (`test/fixtures/`), never the real game file.
They cover UTF-16/BOM decoding, the custom ingredient encoding (including fluids and
byproducts), class-name resolution, recipe extraction (alternates, machines), and the
graph production queries against known-good values (Reinforced Iron Plate → 60 Iron
Ore/min, etc.).
