# Contributing to Foreman

Thanks for helping out. This is a community-first project — contributions of
code, docs, and game-data updates are all welcome.

## Conventions

Commit, branch, and pull-request conventions are documented in
[`CLAUDE.md`](./CLAUDE.md) (see **Git, Commit & PR Conventions**). In short:

- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`type(scope): subject`) with a body explaining what and why.
- **Branches** are prefixed `feature/`, `bugfix/`, or `hotfix/` with a kebab-case slug.
- **Pull requests** are one logical change each, squash-merged, with a complete
  description written at creation time.

## Development

```bash
npm install
npm run build      # type-check / build packages/mcp
npm run lint       # ESLint + Prettier
npm test           # Vitest (runs on hand-crafted fixtures)
```

CI (`build` + `lint` + `test`) runs on every PR and must pass before merge.

## Supplying game data (`en-US.json`)

The MCP server can read game data from a local install, but it also ships
**bundled game data per release channel** so it works out of the box. At most two
channels are kept — the latest **stable** and the latest **experimental** build:

```
packages/mcp/data/
  stable/        en-US.json + meta.json
  experimental/  en-US.json + meta.json
```

`meta.json` describes the data:

```json
{ "gameVersion": "1.2.3.0", "build": 493833, "channel": "stable" }
```

When you contribute game data (a new channel snapshot or an update to one),
follow this rule — it is enforced by the **Validate game data** CI check:

> **One channel per PR.** The pull request must contain **only** the two files
> under a single `packages/mcp/data/<channel>/` directory — its `en-US.json` and
> `meta.json` — and nothing else (no code, no docs, no other channel).

The check also requires that `meta.channel` matches the directory, `build` is a
positive integer, and `build` is **strictly greater** than that channel's current
value (so a channel only ever moves forward). Different channels are independent.

Why: the file is large, it changes wholesale between game versions, and keeping
each update isolated makes data PRs trivial to review.

How to prepare one:

1. Copy `CommunityResources/Docs/en-US.json` from a game install on the relevant
   channel (it is UTF-16 LE — leave the encoding as-is; the parser handles it).
2. Place it at `packages/mcp/data/<channel>/en-US.json` (`<channel>` =
   `stable` or `experimental`).
3. Add `packages/mcp/data/<channel>/meta.json` with the `gameVersion`, `build`
   (from the in-game build number) and `channel`.
4. Commit **only** those two files, e.g.:

   ```bash
   git checkout -b feature/update-stable-game-data
   git add packages/mcp/data/stable/en-US.json packages/mcp/data/stable/meta.json
   git commit -m "chore(data): update stable game data to 1.2.3.0 (build 493833)"
   ```

5. Open a PR containing only that commit.

> **Note:** `en-US.json` is Satisfactory game data © Coffee Stain Studios.
> Only the bundled channel copies under `packages/mcp/data/` are tracked; a local
> working copy under `game-data/` is gitignored and must not be committed.
