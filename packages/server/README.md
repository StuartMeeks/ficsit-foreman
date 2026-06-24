# @foreman/server

The FICSIT Foreman backend — the Express service that sits between the web client
and the LLM provider. It runs the foreman persona, streams chat responses, calls
the game-data (and optional save-game) MCP server for accurate game data, and
persists sessions and work orders.

It runs as the `server` service in the `foreman` Docker Compose project,
alongside `mcp-game-data` (and optionally `mcp-save-game`).

## What it does

- **Chat proxy.** Streams the foreman's responses over Server-Sent Events while
  running the tool-use loop server-side: the model calls MCP game-data tools and
  work-order tools, and the server feeds the results back until the foreman
  produces a final answer.
- **Multiple providers.** Native Anthropic, or any OpenAI-compatible API
  (OpenAI, OpenRouter, Gemini-compat, Azure) via a base URL — see the provider
  seam below. `LLM_PROVIDER` selects the default; a client can override per
  request.
- **Accounts.** Using the app requires an account. [Better Auth](https://better-auth.com)
  (mounted at `/api/auth/*`) provides email + password with HttpOnly-cookie sessions;
  every play session and its data is scoped to a user. The pioneer's own LLM key still
  stays client-side. See `BETTER_AUTH_*` in `.env.example`.
- **Foreman persona.** Loads `SYSTEM_PROMPT.md` once at startup and substitutes
  the session's `{{PERSONALITY}}` and `{{PIONEER_PROFILE}}` per request.
- **Two key tiers.** Free tier — the client passes its own provider key in the
  `x-anthropic-api-key` header (and may pick provider/model in the chat body).
  Hosted tier — the server uses its own `LLM_API_KEY`. The header wins when both
  are present.
- **Work orders (v2).** Stateful, auditable records with a plan/execution split —
  see the canonical [`docs/work-orders.md`](../../docs/work-orders.md). The foreman
  drives the plan via tools (`create_work_order`, `revise_work_order`,
  `block`/`unblock`/`supersede`, `create_child_work_order`) and may only
  `propose_completion` — **completion is Pioneer-only** (via REST/UI). Creating an
  order no longer abandons the current one; supersession is explicit. Sequence
  numbers are per-session and monotonic (WO-001, …); at most one order is `active`
  at a time, though non-terminal orders may coexist (a blocked parent + an active
  child). Plan edits write acknowledged **revision snapshots**; execution changes
  (checklists, machine counts, hours) append to an **audit trail**.
- **Windowed history.** Only the most recent N messages (default 20) are sent
  with each request.

## API

All routes are under `/api`. **Authentication is required** — Better Auth owns
`/api/auth/*` (email + password; HttpOnly-cookie sessions), and every
`/api/sessions*` route rejects unauthenticated requests with 401. Sessions are
owned by a user: reads/updates of a session you don't own return 403. Send requests
with credentials (cookies) included.

| Method | Path | Purpose |
|---|---|---|
| `POST`/`GET` | `/api/auth/*` | Better Auth: sign-up/sign-in (email), sign-out, session. |
| `POST` | `/api/sessions` | Create a session owned by the caller (optionally seed personality/profile). |
| `GET` | `/api/sessions` | List the caller's own sessions. |
| `GET` | `/api/sessions/:id` | Fetch a session you own. |
| `POST` | `/api/sessions/:id/claim` | Claim a pre-accounts anonymous session on first login. |
| `PATCH` | `/api/sessions/:id` | Update personality and/or pioneer profile (effective next message). |
| `POST` | `/api/sessions/:id/chat` | Send a message; streams the response over SSE. |
| `POST` | `/api/sessions/:id/work-orders` | Create a work order (starts in `new`; does not abandon others). |
| `GET` | `/api/sessions/:id/work-orders` | Full work-order history. |
| `GET` | `/api/sessions/:id/work-orders/active` | The current active order (404 if none). |
| `GET` | `/api/sessions/:id/work-orders/:woId` | A single order (also `/children`, `/parent`). |
| `PATCH` | `…/work-orders/:woId/plan` | Foreman plan edit (writes a revision). |
| `POST` | `…/work-orders/:woId/transitions` | Lifecycle action: start/pause/resume/block/unblock/complete/force-complete/cancel/supersede. |
| `PATCH` | `…/work-orders/:woId/materials\|steps\|machines/:itemId` | Pioneer execution updates (check/uncheck, built count). |
| `POST` | `…/work-orders/:woId/hours` · `/acknowledge` · `/revert` | Log hours, acknowledge a revision, revert to a revision. |
| `GET` | `…/work-orders/:woId/audit` · `/revisions` · `/revisions/diff` | Audit trail, revision history, field-level diff. |
| `GET` | `/health` | Liveness + model/MCP/game-version info. |

The full work-order surface (every transition, required fields, and actor rules)
is specified in [`docs/work-orders.md`](../../docs/work-orders.md).

### Chat SSE events

The chat endpoint streams named events: `text` (`{ delta }`), `tool_use`
(`{ name }`), `work_order` (the full order, whenever the foreman creates, revises,
or otherwise changes one), `done` (`{ ok }`), and `error` (`{ message }`).

## Configuration

See the root [`.env.example`](../../.env.example) for the full, commented list.
Key variables: `LLM_PROVIDER` (`anthropic` default, or `openai`), `LLM_API_KEY`
(optional hosted key; `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` honoured too),
`LLM_MODEL` (default `claude-sonnet-4-6`), `LLM_BASE_URL` (OpenAI-compatible
endpoint), `MCP_URL` (default `http://127.0.0.1:8723/mcp`), `SAVE_MCP_URL`
(optional — merges the save-game MCP's tools so the foreman can read player
location and remaining collectibles), `DATABASE_URL` (default `file:./dev.db`;
set a `postgresql://` URL and switch the schema's datasource provider for prod),
`BETTER_AUTH_SECRET` (signs session cookies — **set this in any real deployment**),
`PORT` (default `8724`), `HISTORY_WINDOW` (default `20`).

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
