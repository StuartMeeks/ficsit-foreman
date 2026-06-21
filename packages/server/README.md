# @foreman/server

The FICSIT Foreman backend — the Express service that sits between the web client
and the LLM provider. It runs the foreman persona, streams chat responses, calls
the Phase 1 MCP server for accurate game data, and persists sessions and work
orders.

It runs as the `server` service in the `foreman` Docker Compose project,
alongside the `mcp` service.

## What it does

- **Chat proxy.** Streams the foreman's responses over Server-Sent Events while
  running the tool-use loop server-side: the model calls MCP game-data tools and
  work-order tools, and the server feeds the results back until the foreman
  produces a final answer.
- **Multiple providers.** Native Anthropic, or any OpenAI-compatible API
  (OpenAI, OpenRouter, Gemini-compat, Azure) via a base URL — see the provider
  seam below. `LLM_PROVIDER` selects the default; a client can override per
  request.
- **Foreman persona.** Loads `SYSTEM_PROMPT.md` once at startup and substitutes
  the session's `{{PERSONALITY}}` and `{{PIONEER_PROFILE}}` per request.
- **Two key tiers.** Free tier — the client passes its own provider key in the
  `x-anthropic-api-key` header (and may pick provider/model in the chat body).
  Hosted tier — the server uses its own `LLM_API_KEY`. The header wins when both
  are present.
- **Work orders.** The foreman issues and closes orders via the `create_work_order`
  and `complete_work_order` tools; the same records are also exposed over REST.
  Sequence numbers are per-session and monotonic (WO-001, WO-002, …) and only one
  order is `active` at a time — issuing a new one supersedes (abandons) the
  current one.
- **Windowed history.** Only the most recent N messages (default 20) are sent
  with each request.

## API

All routes are under `/api`. The session id is a client-held UUID.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/sessions` | Create a session (optionally seed personality/profile). |
| `GET` | `/api/sessions/:id` | Fetch a session. |
| `PATCH` | `/api/sessions/:id` | Update personality and/or pioneer profile (effective next message). |
| `POST` | `/api/sessions/:id/chat` | Send a message; streams the response over SSE. |
| `POST` | `/api/sessions/:id/work-orders` | Create a work order (supersedes the active one). |
| `GET` | `/api/sessions/:id/work-orders` | Full work-order history. |
| `GET` | `/api/sessions/:id/work-orders/active` | The current active order (404 if none). |
| `GET` | `/api/sessions/:id/work-orders/:woId` | A single order. |
| `PATCH` | `/api/sessions/:id/work-orders/:woId` | Update — complete, abandon, add adaptations or feedback. |
| `GET` | `/health` | Liveness + model/MCP/game-version info. |

### Chat SSE events

The chat endpoint streams named events: `text` (`{ delta }`), `tool_use`
(`{ name }`), `work_order` (the full order, when one is created or closed),
`done` (`{ ok }`), and `error` (`{ message }`).

## Configuration

See the root [`.env.example`](../../.env.example) for the full list. Key
variables: `ANTHROPIC_API_KEY` (optional hosted key), `ANTHROPIC_MODEL`
(default `claude-sonnet-4-6`), `MCP_URL` (default `http://127.0.0.1:8723/mcp`),
`DATABASE_URL` (default `file:./dev.db`), `PORT` (default `8724`),
`HISTORY_WINDOW` (default `20`).

## Running

### With Docker Compose (recommended)

From the repo root, the `server` service builds and runs alongside `mcp`:

```bash
docker compose up -d --build
```

The backend listens on `http://localhost:8724`; the MCP server on `:8723`.

### Bare metal

```bash
# from the repo root
npm install
npm run db:migrate -w @foreman/server     # create the local SQLite database
npm run dev:server                         # start with hot reload on :8724
```

The MCP server must be reachable at `MCP_URL` (run `npm run dev:mcp` with
`MCP_TRANSPORT=http`, or the mcp container).

## Database

Prisma + SQLite for local dev (`DATABASE_URL=file:./dev.db`); the same schema
migrates to Postgres for hosted deployment. Complex work-order fields (arrays,
nested objects) are stored as JSON-encoded TEXT so the schema is portable across
both providers without change.

- `npm run db:migrate -w @foreman/server` — create/apply a dev migration.
- `npm run db:deploy -w @foreman/server` — apply pending migrations (used by the
  container at startup).

### Data persistence across upgrades

In Docker, the database lives in the `foreman-db` **named volume** (mounted at
`/data`), which has a lifecycle independent of the container. Your sessions and
work orders therefore survive upgrades:

| Action | Data |
|---|---|
| `docker compose pull` then `up -d` (recreate on a new image) | safe |
| `docker compose stop` / `start` / `restart` | safe |
| `docker compose down` | safe — named volumes are not removed |
| `docker compose down -v`, or removing the volume | **deleted** |

On startup the container runs `prisma migrate deploy`, which applies only pending
migrations to the existing database in place — additive, never destructive. So a
new release migrates your live data forward without loss; the only way to lose it
is the explicit `-v`.

**Prefer a folder you control?** Swap the named volume for a host bind mount in
`compose.yaml` (`- ./data:/data`); the database then lives in `./data` next to the
compose file.

**Back up** the volume any time:

```bash
docker run --rm -v foreman-db:/data -v "$PWD:/backup" busybox \
  tar czf /backup/foreman-db.tgz /data
```

## LLM providers

The chat loop is provider-agnostic. It speaks the neutral types in
`src/llm/types.ts` and depends only on the `LlmProvider` interface
(`src/llm/provider.ts`); each adapter translates to and from its own wire
format:

- `src/llm/anthropic.ts` — native Anthropic (streaming + tool_use blocks).
- `src/llm/openai.ts` — any OpenAI Chat Completions-compatible API; the base URL
  selects the concrete provider. `consumeOpenAiStream` assembles streamed
  tool-call fragments.
- `src/llm/factory.ts` — `createProvider(config)` picks the adapter.

To add a provider, implement `LlmProvider` and wire it into `createProvider`.
The chat loop, summariser, and routes need no changes.

## Testing

```bash
npm run test -w @foreman/server
```

Tests run against an isolated temporary SQLite database and inject a fake
`LlmProvider` and a fake MCP gateway — no SDKs, live API calls, or network
needed. `test/openai-stream.test.ts` unit-tests the OpenAI tool-call assembly.
